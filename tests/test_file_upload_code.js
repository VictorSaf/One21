// tests/test_file_upload_code.js — Test 5 code verification:
// Ensures routes/files.js has the socket broadcast fix
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const FILES_ROUTE_PATH = path.join(__dirname, '..', 'routes', 'files.js');
const filesSource = fs.readFileSync(FILES_ROUTE_PATH, 'utf8');

describe('Test 5 Code Verification: routes/files.js socket broadcast', () => {
  it('accesses io via req.app.get("io")', () => {
    assert.ok(
      filesSource.includes("req.app.get('io')") || filesSource.includes('req.app.get("io")'),
      'files.js should access io instance via req.app.get("io")'
    );
  });

  it('emits message event to the room after upload', () => {
    // Should have: io.to(`room:${roomId}`).emit('message', ...)
    const hasEmit = filesSource.includes(".emit('message'") || filesSource.includes('.emit("message"');
    assert.ok(hasEmit, 'files.js should emit "message" event via Socket.IO');
  });

  it('emits to the correct room channel pattern room:${roomId}', () => {
    assert.ok(
      filesSource.includes('`room:${roomId}`') || filesSource.includes("'room:' + roomId"),
      'files.js should emit to room:${roomId}'
    );
  });

  it('SELECT query includes sender_color_index', () => {
    assert.ok(
      filesSource.includes('sender_color_index'),
      'The SELECT in files.js should include sender_color_index'
    );
  });

  it('SELECT query uses COALESCE for color_index fallback', () => {
    assert.ok(
      filesSource.includes('COALESCE(rmc.color_index') || filesSource.includes('COALESCE'),
      'Should use COALESCE for sender_color_index with fallback to user chat_color_index'
    );
  });

  it('SELECT query includes sender_username and sender_name', () => {
    assert.ok(filesSource.includes('sender_username'), 'Should select sender_username');
    assert.ok(filesSource.includes('sender_name'), 'Should select sender_name');
  });

  it('SELECT query includes sender_role', () => {
    assert.ok(filesSource.includes('sender_role'), 'Should select sender_role');
  });

  it('broadcast happens AFTER DB insert (io.to call is after INSERT statement)', () => {
    const insertIdx = filesSource.indexOf('INSERT INTO messages');
    const emitIdx = filesSource.indexOf(".emit('message'");
    assert.ok(insertIdx > -1, 'Should have INSERT INTO messages');
    assert.ok(emitIdx > -1, 'Should have .emit("message")');
    assert.ok(emitIdx > insertIdx, 'Socket emit should occur AFTER the DB insert');
  });
});
