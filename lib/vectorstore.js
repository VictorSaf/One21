const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data', 'vectorstore');
fs.mkdirSync(DATA_DIR, { recursive: true });

let _embeddings = null;
let _stores = {};

function sanitizeCollectionPart(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getCollectionPath(collection) {
  return path.join(DATA_DIR, collection);
}

function getCollectionMetaPath(collection) {
  return path.join(getCollectionPath(collection), 'meta.json');
}

function getCollectionLogPath(collection) {
  return path.join(getCollectionPath(collection), 'docs.jsonl');
}

function appendCollectionLog(collection, text, metadata) {
  const storePath = getCollectionPath(collection);
  fs.mkdirSync(storePath, { recursive: true });
  const logPath = getCollectionLogPath(collection);
  const line = JSON.stringify({
    text,
    metadata: metadata || {},
  });
  fs.appendFileSync(logPath, `${line}\n`, 'utf8');
}

function readCollectionLog(collection) {
  const logPath = getCollectionLogPath(collection);
  if (!fs.existsSync(logPath)) return [];
  const raw = fs.readFileSync(logPath, 'utf8');
  if (!raw.trim()) return [];
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

function writeCollectionLog(collection, docs) {
  const storePath = getCollectionPath(collection);
  fs.mkdirSync(storePath, { recursive: true });
  const logPath = getCollectionLogPath(collection);
  const payload = docs.map((d) => JSON.stringify(d)).join('\n');
  fs.writeFileSync(logPath, payload ? `${payload}\n` : '', 'utf8');
}

function readCollectionMeta(collection) {
  const metaPath = getCollectionMetaPath(collection);
  if (!fs.existsSync(metaPath)) {
    return {
      collection,
      doc_count: 0,
      last_write_at: null,
      created_at: null,
    };
  }
  try {
    const raw = fs.readFileSync(metaPath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return {
      collection,
      doc_count: 0,
      last_write_at: null,
      created_at: null,
    };
  }
}

function writeCollectionMeta(collection, nextMeta) {
  const storePath = getCollectionPath(collection);
  fs.mkdirSync(storePath, { recursive: true });
  const metaPath = getCollectionMetaPath(collection);
  fs.writeFileSync(metaPath, JSON.stringify(nextMeta, null, 2), 'utf8');
}

function touchCollectionMetaOnInsert(collection) {
  const now = new Date().toISOString();
  const current = readCollectionMeta(collection);
  const next = {
    ...current,
    collection,
    doc_count: Number.isInteger(current.doc_count) ? current.doc_count + 1 : 1,
    last_write_at: now,
    created_at: current.created_at || now,
  };
  writeCollectionMeta(collection, next);
}

function isExpiredByTtl(metadata, ttlDays) {
  if (!ttlDays || ttlDays <= 0) return false;
  const ts = metadata && metadata.ts ? Date.parse(metadata.ts) : NaN;
  if (Number.isNaN(ts)) return false;
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  return Date.now() - ts > ttlMs;
}

function matchesMetadataFilters(metadata, filters) {
  if (!filters) return true;
  const entries = Object.entries(filters);
  for (const [key, value] of entries) {
    if (value === undefined || value === null || value === '') continue;
    if (metadata[key] !== value) return false;
  }
  return true;
}

let _xenovaPipe = null;
async function getXenovaPipe() {
  if (_xenovaPipe) return _xenovaPipe;
  const mod = await import('@xenova/transformers');
  _xenovaPipe = await mod.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  return _xenovaPipe;
}

function meanPoolEmbedding(output) {
  if (!output || !output.dims || !output.data) return null;
  const dims = output.dims;
  if (!Array.isArray(dims) || dims.length !== 3) return null;
  const batch = Number(dims[0]);
  const tokens = Number(dims[1]);
  const width = Number(dims[2]);
  if (batch !== 1 || tokens <= 0 || width <= 0) return null;

  const data = output.data;
  const sum = new Array(width).fill(0);
  for (let t = 0; t < tokens; t++) {
    const base = t * width;
    for (let i = 0; i < width; i++) sum[i] += data[base + i];
  }
  const denom = Math.max(1, tokens);
  return sum.map((v) => v / denom);
}

async function embedText(text) {
  const pipe = await getXenovaPipe();
  const out = await pipe(String(text || ''), { pooling: 'none', normalize: true });
  const pooled = meanPoolEmbedding(out);
  if (!pooled) throw new Error('Failed to compute embedding');
  return pooled;
}

async function getEmbeddings() {
  if (_embeddings) return _embeddings;

  _embeddings = {
    embedDocuments: async (texts) => {
      const arr = Array.isArray(texts) ? texts : [];
      const out = [];
      for (const t of arr) out.push(await embedText(t));
      return out;
    },
    embedQuery: async (text) => {
      return embedText(text);
    },
  };

  return _embeddings;
}

async function getStore(collection) {
  if (_stores[collection]) return _stores[collection];
  const { HNSWLib } = await import('@langchain/community/vectorstores/hnswlib');
  const storePath = getCollectionPath(collection);
  const embeddings = await getEmbeddings();

  if (fs.existsSync(path.join(storePath, 'hnswlib.index'))) {
    _stores[collection] = await HNSWLib.load(storePath, embeddings);
  } else {
    _stores[collection] = await HNSWLib.fromTexts(['_init'], [{ type: '_init' }], embeddings);
    await _stores[collection].save(storePath);
  }
  return _stores[collection];
}

/**
 * Add a document to a collection. Fire-and-forget safe.
 */
async function addDocument(collection, text, metadata = {}) {
  try {
    const store = await getStore(collection);
    const { Document } = await import('@langchain/core/documents');
    await store.addDocuments([new Document({ pageContent: text, metadata })]);
    const storePath = getCollectionPath(collection);
    await store.save(storePath);
    appendCollectionLog(collection, text, metadata);
    touchCollectionMetaOnInsert(collection);
  } catch (err) {
    console.error(`[VectorStore] addDocument error (${collection}):`, err.message);
  }
}

/**
 * Semantic search across a collection.
 */
async function search(collection, query, k = 10) {
  try {
    const store = await getStore(collection);
    const results = await store.similaritySearchWithScore(query, k);
    return results
      .filter(([doc]) => doc.metadata.type !== '_init')
      .map(([doc, score]) => ({ text: doc.pageContent, metadata: doc.metadata, score }));
  } catch (err) {
    console.error(`[VectorStore] search error (${collection}):`, err.message);
    return [];
  }
}

function agentMemoryCollection(agentUsername) {
  const safe = sanitizeCollectionPart(agentUsername);
  return `agent_${safe}_memory`;
}

async function addAgentMemory(agentUsername, text, metadata = {}) {
  const collection = agentMemoryCollection(agentUsername);
  const payload = {
    ...metadata,
    agent_username: agentUsername,
    ts: metadata.ts || new Date().toISOString(),
    memory_type: metadata.memory_type || 'message',
  };
  await addDocument(collection, text, payload);
}

async function searchAgentMemory(agentUsername, query, options = {}) {
  const {
    k = 10,
    filters = null,
    ttl_days = 0,
  } = options;
  const collection = agentMemoryCollection(agentUsername);
  const results = await search(collection, query, k);
  return results.filter((r) => {
    if (!matchesMetadataFilters(r.metadata || {}, filters)) return false;
    if (isExpiredByTtl(r.metadata || {}, ttl_days)) return false;
    return true;
  });
}

function listAgentMemoryStats() {
  if (!fs.existsSync(DATA_DIR)) return [];
  const dirs = fs.readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('agent_') && d.name.endsWith('_memory'))
    .map((d) => d.name);
  return dirs.map((collection) => {
    const meta = readCollectionMeta(collection);
    const indexPath = path.join(getCollectionPath(collection), 'hnswlib.index');
    return {
      collection,
      agent_username: collection.replace(/^agent_/, '').replace(/_memory$/, ''),
      doc_count: meta.doc_count || 0,
      last_write_at: meta.last_write_at || null,
      has_index: fs.existsSync(indexPath),
    };
  });
}

async function rebuildCollectionFromDocs(collection, docs) {
  const { HNSWLib } = await import('@langchain/community/vectorstores/hnswlib');
  const embeddings = await getEmbeddings();
  const storePath = getCollectionPath(collection);

  delete _stores[collection];
  fs.rmSync(storePath, { recursive: true, force: true });
  fs.mkdirSync(storePath, { recursive: true });

  let store;
  if (!docs.length) {
    store = await HNSWLib.fromTexts(['_init'], [{ type: '_init' }], embeddings);
  } else {
    const texts = docs.map((d) => d.text);
    const metadatas = docs.map((d) => d.metadata || {});
    store = await HNSWLib.fromTexts(texts, metadatas, embeddings);
  }
  await store.save(storePath);
  writeCollectionLog(collection, docs);

  const now = new Date().toISOString();
  writeCollectionMeta(collection, {
    collection,
    doc_count: docs.length,
    last_write_at: now,
    created_at: now,
  });
  _stores[collection] = store;
}

async function pruneAgentMemory(options = {}) {
  const {
    agent_username = null,
    ttl_days = 30,
    max_docs_per_agent = 5000,
    dry_run = false,
  } = options;

  const stats = listAgentMemoryStats();
  const targetCollections = stats
    .filter((s) => !agent_username || s.agent_username === sanitizeCollectionPart(agent_username))
    .map((s) => s.collection);

  const report = [];
  for (const collection of targetCollections) {
    const docs = readCollectionLog(collection);
    const before = docs.length;
    let retained = docs.filter((d) => !isExpiredByTtl(d.metadata || {}, ttl_days));
    if (max_docs_per_agent > 0 && retained.length > max_docs_per_agent) {
      retained = retained.slice(retained.length - max_docs_per_agent);
    }
    const removed = before - retained.length;

    if (!dry_run && removed > 0) {
      await rebuildCollectionFromDocs(collection, retained);
    }

    report.push({
      collection,
      before_docs: before,
      after_docs: retained.length,
      removed_docs: removed,
      changed: removed > 0,
    });
  }

  return {
    dry_run,
    ttl_days,
    max_docs_per_agent,
    targets: targetCollections.length,
    collections: report,
    removed_docs_total: report.reduce((acc, item) => acc + item.removed_docs, 0),
  };
}

module.exports = {
  addDocument,
  search,
  addAgentMemory,
  searchAgentMemory,
  listAgentMemoryStats,
  pruneAgentMemory,
};
