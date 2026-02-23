const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data', 'vectorstore');
fs.mkdirSync(DATA_DIR, { recursive: true });

let _embeddings = null;
let _stores = {};

async function getEmbeddings() {
  if (_embeddings) return _embeddings;
  const { HuggingFaceTransformersEmbeddings } = await import('@langchain/community/embeddings/huggingface_transformers');
  _embeddings = new HuggingFaceTransformersEmbeddings({
    modelName: 'Xenova/all-MiniLM-L6-v2',
  });
  return _embeddings;
}

async function getStore(collection) {
  if (_stores[collection]) return _stores[collection];
  const { HNSWLib } = await import('@langchain/community/vectorstores/hnswlib');
  const storePath = path.join(DATA_DIR, collection);
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
    const storePath = path.join(DATA_DIR, collection);
    await store.save(storePath);
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

module.exports = { addDocument, search };
