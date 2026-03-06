const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const CULT_UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'cult');

function resolveDocPath(storageKey) {
  return path.join(CULT_UPLOADS_DIR, path.basename(storageKey));
}

function chunkText(text) {
  const cleaned = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];

  const maxLen = 900;
  const overlap = 120;
  const chunks = [];
  let i = 0;
  while (i < cleaned.length) {
    const end = Math.min(cleaned.length, i + maxLen);
    const slice = cleaned.slice(i, end);
    chunks.push(slice.trim());
    if (end >= cleaned.length) break;
    i = Math.max(0, end - overlap);
  }
  return chunks.filter(Boolean);
}

let _embedder = null;
async function getEmbedder() {
  if (_embedder) return _embedder;
  const mod = await import('@xenova/transformers');
  const pipe = await mod.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  _embedder = pipe;
  return _embedder;
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
  const pipe = await getEmbedder();
  const out = await pipe(text, { pooling: 'none', normalize: true });
  const pooled = meanPoolEmbedding(out);
  if (!pooled) return null;
  return `[${pooled.map((v) => Number(v).toFixed(6)).join(',')}]`;
}

async function extractTextFromDocument(doc) {
  const storageKey = doc && doc.storage_key;
  const mime = doc && doc.mime;
  if (!storageKey) throw new Error('Missing storage_key');

  const p = resolveDocPath(storageKey);
  const lower = String(storageKey || '').toLowerCase();

  const isTxt = mime === 'text/plain' || lower.endsWith('.txt');
  if (isTxt) return fs.readFileSync(p, 'utf8');

  const isPdf = mime === 'application/pdf' || lower.endsWith('.pdf');
  if (isPdf) {
    const buf = fs.readFileSync(p);
    const out = await pdfParse(buf);
    return String(out && out.text ? out.text : '').trim();
  }

  const isDocx = mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lower.endsWith('.docx');
  if (isDocx) {
    const buf = fs.readFileSync(p);
    const out = await mammoth.extractRawText({ buffer: buf });
    return String(out && out.value ? out.value : '').trim();
  }

  throw new Error('Unsupported document type for ingest');
}

async function ingestDocumentSqlite({ db, docId, roomId, storageKey, mime }) {
  const raw = await extractTextFromDocument({ storage_key: storageKey, mime });
  const chunks = chunkText(raw);

  db.prepare('DELETE FROM cult_document_chunks WHERE doc_id = ?').run(docId);
  const ins = db.prepare(
    'INSERT OR REPLACE INTO cult_document_chunks (doc_id, room_id, chunk_index, content) VALUES (?, ?, ?, ?)'
  );
  for (let idx = 0; idx < chunks.length; idx++) {
    ins.run(docId, roomId, idx, chunks[idx]);
  }

  return { chunks: chunks.length };
}

async function ingestDocumentPostgres({ client, docId, roomId, storageKey, mime }) {
  const raw = await extractTextFromDocument({ storage_key: storageKey, mime });
  const chunks = chunkText(raw);

  await client.query('DELETE FROM cult_document_chunks WHERE doc_id = $1', [Number(docId)]);
  for (let idx = 0; idx < chunks.length; idx++) {
    const embedding = await embedText(chunks[idx]);
    await client.query(
      `
      INSERT INTO cult_document_chunks (doc_id, room_id, chunk_index, content, embedding)
      VALUES ($1,$2,$3,$4,$5::vector)
      ON CONFLICT (doc_id, chunk_index) DO UPDATE
        SET content = EXCLUDED.content,
            embedding = EXCLUDED.embedding
      `,
      [Number(docId), Number(roomId), idx, chunks[idx], embedding]
    );
  }

  return { chunks: chunks.length };
}

module.exports = {
  chunkText,
  resolveDocPath,
  embedText,
  extractTextFromDocument,
  ingestDocumentSqlite,
  ingestDocumentPostgres,
};
