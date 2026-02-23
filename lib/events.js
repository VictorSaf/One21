const { addDocument } = require('./vectorstore');

/**
 * Log an admin event to the vector store. Fire-and-forget.
 */
function logEvent(type, summary, metadata = {}) {
  setImmediate(() => {
    addDocument('admin_events', summary, {
      type,
      ts: new Date().toISOString(),
      ...metadata,
    }).catch(() => {});
  });
}

module.exports = { logEvent };
