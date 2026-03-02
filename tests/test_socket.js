// tests/test_socket.js — Socket.IO event conformance tests
// Tests 1-5 (real-time messaging, edit/delete, typing, reactions, file upload broadcast)
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createSocket, waitForEvent, authRequest } = require('./helpers');
const { getAdmin, getOrCreateTestUser, findSharedRoom } = require('./setup');

let admin, testUser, sharedRoom;
let socketA, socketB;

describe('Socket.IO Event Tests', () => {
  before(async () => {
    admin = await getAdmin();
    testUser = await getOrCreateTestUser();
    sharedRoom = await findSharedRoom(admin.token);

    // Ensure test user is a member of the shared room
    await authRequest('POST', `/api/rooms/${sharedRoom.id}/members`, admin.token, {
      user_id: testUser.user.id,
    });

    socketA = await createSocket(admin.token);
    socketB = await createSocket(testUser.token);

    // Both explicitly join the shared room (in addition to auto-join in presence handler)
    socketA.emit('join_room', sharedRoom.id);
    socketB.emit('join_room', sharedRoom.id);

    // Wait for joined_room confirmations
    await Promise.all([
      waitForEvent(socketA, 'joined_room', 3000).catch(() => {}),
      waitForEvent(socketB, 'joined_room', 3000).catch(() => {}),
    ]);

    // Extra buffer for socket room joins to propagate
    await new Promise(r => setTimeout(r, 500));
  });

  after(() => {
    if (socketA) socketA.disconnect();
    if (socketB) socketB.disconnect();
  });

  // -------------------------------------------------------
  // Test 1: Real-Time Text Messages
  // -------------------------------------------------------
  describe('Test 1: Real-Time Text Messages', () => {
    it('broadcasts text message to room members via socket', async () => {
      const text = 'Socket test message ' + Date.now();
      const msgPromise = waitForEvent(socketB, 'message', 5000);

      socketA.emit('message', {
        room_id: sharedRoom.id,
        text,
        type: 'text',
      });

      const msg = await msgPromise;
      assert.equal(msg.room_id, sharedRoom.id);
      assert.equal(msg.text, text);
      assert.equal(msg.type, 'text');
      assert.ok(msg.sender_username, 'message should include sender_username');
      assert.ok(msg.sender_name, 'message should include sender_name');
      assert.ok(msg.sender_role, 'message should include sender_role');
      assert.ok('sender_color_index' in msg, 'message should include sender_color_index');
      assert.ok(msg.id, 'message should have an id');
      assert.ok(msg.created_at, 'message should have created_at');
    });

    it('message payload matches api-contract.md schema', async () => {
      const msgPromise = waitForEvent(socketB, 'message', 5000);
      socketA.emit('message', { room_id: sharedRoom.id, text: 'Schema test ' + Date.now() });
      const msg = await msgPromise;

      // Required fields per api-contract.md
      const requiredFields = [
        'id', 'room_id', 'sender_id', 'text', 'type',
        'sender_username', 'sender_name', 'sender_role', 'sender_color_index',
        'created_at', 'is_edited',
      ];
      for (const field of requiredFields) {
        assert.ok(field in msg, `Missing contract field: ${field}`);
      }
    });

    it('sender also receives their own message', async () => {
      const text = 'Self receive test ' + Date.now();
      const msgPromise = waitForEvent(socketA, 'message', 5000);
      socketA.emit('message', { room_id: sharedRoom.id, text });
      const msg = await msgPromise;
      assert.equal(msg.text, text);
    });

    it('rejects empty or whitespace-only messages', async () => {
      // Drain any pending messages first
      await new Promise(r => setTimeout(r, 300));

      let whitespaceReceived = false;
      const handler = (msg) => {
        // Only flag if the message is from room and has whitespace text
        if (msg.room_id === sharedRoom.id && msg.text && msg.text.trim() === '') {
          whitespaceReceived = true;
        }
      };
      socketB.on('message', handler);

      socketA.emit('message', { room_id: sharedRoom.id, text: '   ' });
      await new Promise(r => setTimeout(r, 800));

      socketB.off('message', handler);
      assert.equal(whitespaceReceived, false, 'Whitespace-only message should not be broadcast');
    });

    it('rejects messages exceeding 4000 chars', async () => {
      let received = false;
      const handler = () => { received = true; };
      socketB.on('message', handler);

      socketA.emit('message', { room_id: sharedRoom.id, text: 'x'.repeat(4001) });
      await new Promise(r => setTimeout(r, 500));

      socketB.off('message', handler);
      assert.equal(received, false, 'Overlength message should not be broadcast');
    });
  });

  // -------------------------------------------------------
  // Test 2: Message Edit and Delete
  // -------------------------------------------------------
  describe('Test 2: Message Edit and Delete', () => {
    it('broadcasts message_edited event', async () => {
      // Send a message first
      const msgPromise = waitForEvent(socketA, 'message', 5000);
      socketA.emit('message', { room_id: sharedRoom.id, text: 'Edit me ' + Date.now() });
      const original = await msgPromise;

      // Edit it
      const editPromise = waitForEvent(socketB, 'message_edited', 5000);
      socketA.emit('message_edit', { message_id: original.id, text: 'Edited text' });
      const edited = await editPromise;

      assert.equal(edited.message_id, original.id);
      assert.equal(edited.text, 'Edited text');
      assert.equal(edited.room_id, sharedRoom.id);
    });

    it('broadcasts message_deleted event', async () => {
      const msgPromise = waitForEvent(socketA, 'message', 5000);
      socketA.emit('message', { room_id: sharedRoom.id, text: 'Delete me ' + Date.now() });
      const original = await msgPromise;

      const delPromise = waitForEvent(socketB, 'message_deleted', 5000);
      socketA.emit('message_delete', { message_id: original.id });
      const deleted = await delPromise;

      assert.equal(deleted.message_id, original.id);
      assert.equal(deleted.room_id, sharedRoom.id);
    });

    it('rejects edit of message not owned by sender', async () => {
      // Admin sends a message
      const msgPromise = waitForEvent(socketA, 'message', 5000);
      socketA.emit('message', { room_id: sharedRoom.id, text: 'No edit ' + Date.now() });
      const original = await msgPromise;

      // testUser tries to edit
      let editReceived = false;
      const handler = () => { editReceived = true; };
      socketA.on('message_edited', handler);

      socketB.emit('message_edit', { message_id: original.id, text: 'Hijacked' });
      await new Promise(r => setTimeout(r, 500));

      socketA.off('message_edited', handler);
      assert.equal(editReceived, false, 'Should not allow editing another users message');
    });
  });

  // -------------------------------------------------------
  // Test 3: Typing Indicator
  // -------------------------------------------------------
  describe('Test 3: Typing Indicator', () => {
    it('broadcasts typing event to room members (excluding sender)', async () => {
      const typingPromise = waitForEvent(socketB, 'typing', 5000);

      socketA.emit('typing', { room_id: sharedRoom.id });

      const data = await typingPromise;
      assert.equal(data.room_id, sharedRoom.id);
      assert.ok(data.user_id, 'typing event should include user_id');
      assert.ok(data.username, 'typing event should include username');
      assert.ok(data.display_name, 'typing event should include display_name');
    });

    it('typing event is NOT received by sender', async () => {
      let senderReceived = false;
      const handler = () => { senderReceived = true; };
      socketA.on('typing', handler);

      socketA.emit('typing', { room_id: sharedRoom.id });
      await new Promise(r => setTimeout(r, 500));

      socketA.off('typing', handler);
      assert.equal(senderReceived, false, 'Sender should not receive their own typing event');
    });
  });

  // -------------------------------------------------------
  // Test 4: Emoji Reactions
  // -------------------------------------------------------
  describe('Test 4: Emoji Reactions', () => {
    it('broadcasts reaction_update on react', async () => {
      // Create a message
      const msgPromise = waitForEvent(socketA, 'message', 5000);
      socketA.emit('message', { room_id: sharedRoom.id, text: 'React to this ' + Date.now() });
      const msg = await msgPromise;

      // React
      const reactPromise = waitForEvent(socketB, 'reaction_update', 5000);
      socketA.emit('react', { message_id: msg.id, emoji: '\u{1F44D}' });
      const reaction = await reactPromise;

      assert.equal(reaction.message_id, msg.id);
      assert.ok(Array.isArray(reaction.reactions));
      assert.ok(reaction.reactions.length > 0);
      const thumbsUp = reaction.reactions.find(r => r.emoji === '\u{1F44D}');
      assert.ok(thumbsUp, 'Should have thumbs up reaction');
      assert.ok(thumbsUp.count >= 1);
    });

    it('rejects invalid emoji', async () => {
      const msgPromise = waitForEvent(socketA, 'message', 5000);
      socketA.emit('message', { room_id: sharedRoom.id, text: 'Bad emoji test ' + Date.now() });
      const msg = await msgPromise;

      let reactionReceived = false;
      const handler = () => { reactionReceived = true; };
      socketA.on('reaction_update', handler);

      socketA.emit('react', { message_id: msg.id, emoji: '\u{1F4A9}' }); // poop emoji not allowed
      await new Promise(r => setTimeout(r, 500));

      socketA.off('reaction_update', handler);
      assert.equal(reactionReceived, false, 'Invalid emoji should not produce reaction_update');
    });

    it('toggles reaction off on second react with same emoji', async () => {
      const msgPromise = waitForEvent(socketA, 'message', 5000);
      socketA.emit('message', { room_id: sharedRoom.id, text: 'Toggle react ' + Date.now() });
      const msg = await msgPromise;

      // First react
      const r1Promise = waitForEvent(socketA, 'reaction_update', 5000);
      socketA.emit('react', { message_id: msg.id, emoji: '\u2764\uFE0F' });
      const r1 = await r1Promise;
      assert.ok(r1.reactions.length > 0, 'Should have at least one reaction');

      // Second react (toggle off)
      const r2Promise = waitForEvent(socketA, 'reaction_update', 5000);
      socketA.emit('react', { message_id: msg.id, emoji: '\u2764\uFE0F' });
      const r2 = await r2Promise;
      const heartReaction = r2.reactions.find(r => r.emoji === '\u2764\uFE0F');
      assert.ok(!heartReaction, 'Heart reaction should be toggled off');
    });
  });

  // -------------------------------------------------------
  // Test 5: File Upload Socket Broadcast (CRITICAL)
  // NOTE: This test will FAIL if the server was not restarted after
  //       the routes/files.js changes were made. The code on disk
  //       includes the io.to().emit() fix, but the running server
  //       must be restarted to load the new code.
  // -------------------------------------------------------
  describe('Test 5: File Upload Socket Broadcast (CRITICAL)', () => {
    it('routes/files.js emits message event via io.to(room).emit after upload', async () => {
      const { uploadFile } = require('./helpers');
      const fakeImageContent = Buffer.alloc(100, 0xFF);

      // Upload the file via HTTP
      const uploadRes = await uploadFile(
        `/api/rooms/${sharedRoom.id}/upload`,
        admin.token,
        'test-qa.txt',
        fakeImageContent,
        'text/plain',
      );
      assert.equal(uploadRes.status, 200, `Upload should succeed, got ${uploadRes.status}: ${JSON.stringify(uploadRes.body)}`);
      assert.ok(uploadRes.body.file_url, 'Upload response should include file_url');
      assert.ok(uploadRes.body.file_name, 'Upload response should include file_name');

      // Check if socketB receives the broadcast (with short timeout)
      let broadcastReceived = false;
      let broadcastMsg = null;
      const handler = (msg) => {
        if (msg.type === 'file' && msg.room_id === Number(sharedRoom.id)) {
          broadcastReceived = true;
          broadcastMsg = msg;
        }
      };
      socketB.on('message', handler);
      await new Promise(r => setTimeout(r, 2000));
      socketB.off('message', handler);

      // This assertion tests the CRITICAL fix.
      // If it fails, the server needs to be restarted to load the updated routes/files.js.
      assert.ok(broadcastReceived,
        'File upload should broadcast message event to room via Socket.IO. ' +
        'If this fails, restart the server to load the updated routes/files.js code.');

      if (broadcastMsg) {
        assert.equal(broadcastMsg.type, 'file');
        assert.ok(broadcastMsg.file_url, 'Broadcast should include file_url');
        assert.ok(broadcastMsg.file_name, 'Broadcast should include file_name');
        assert.ok(broadcastMsg.sender_name, 'Broadcast should include sender_name');
        assert.ok('sender_color_index' in broadcastMsg, 'Broadcast should include sender_color_index');
        assert.ok(broadcastMsg.sender_username, 'Broadcast should include sender_username');
      }
    });

    it('HTTP upload response includes correct fields per contract', async () => {
      const { uploadFile } = require('./helpers');
      const uploadRes = await uploadFile(
        `/api/rooms/${sharedRoom.id}/upload`,
        admin.token,
        'fields-test.txt',
        Buffer.from('field verification'),
        'text/plain',
      );
      assert.equal(uploadRes.status, 200);
      assert.ok(uploadRes.body.message, 'Response should include message object');
      assert.ok(uploadRes.body.file_url, 'Response should include file_url');
      assert.ok(uploadRes.body.file_name, 'Response should include file_name');
      assert.ok(uploadRes.body.mime, 'Response should include mime type');
      assert.equal(uploadRes.body.message.type, 'file');
      assert.ok(uploadRes.body.message.sender_username, 'message should include sender_username');
      assert.ok(uploadRes.body.message.sender_name, 'message should include sender_name');
    });
  });

  // -------------------------------------------------------
  // Test 8: Upload Progress Bar
  // -------------------------------------------------------
  describe('Test 8: Upload Progress Bar', () => {
    it('broadcasts upload_progress to other room members (excluding sender)', async () => {
      const progressPromise = waitForEvent(socketB, 'upload_progress', 5000);

      socketA.emit('upload_progress', {
        room_id: sharedRoom.id,
        filename: 'test-upload.jpg',
        percent: 50,
      });

      const data = await progressPromise;
      assert.equal(data.room_id, sharedRoom.id);
      assert.ok(data.user_id, 'Should include user_id');
      assert.ok(data.username, 'Should include username');
      assert.equal(data.filename, 'test-upload.jpg');
      assert.equal(data.percent, 50);
    });

    it('clamps percent to 0-100', async () => {
      const progressPromise = waitForEvent(socketB, 'upload_progress', 5000);

      socketA.emit('upload_progress', {
        room_id: sharedRoom.id,
        filename: 'clamp-test.jpg',
        percent: 200,
      });

      const data = await progressPromise;
      assert.equal(data.percent, 100, 'Percent should be clamped to 100');
    });

    it('sender does NOT receive their own upload_progress', async () => {
      let senderReceived = false;
      const handler = () => { senderReceived = true; };
      socketA.on('upload_progress', handler);

      socketA.emit('upload_progress', {
        room_id: sharedRoom.id,
        filename: 'no-self.jpg',
        percent: 25,
      });
      await new Promise(r => setTimeout(r, 500));

      socketA.off('upload_progress', handler);
      assert.equal(senderReceived, false, 'Sender should not get their own upload_progress');
    });
  });

  // -------------------------------------------------------
  // Mark read / message_read event
  // -------------------------------------------------------
  describe('mark_read / message_read events', () => {
    it('emits message_read to other room members', async () => {
      // Create a message from admin
      const msgPromise = waitForEvent(socketA, 'message', 5000);
      socketA.emit('message', { room_id: sharedRoom.id, text: 'Read me ' + Date.now() });
      const msg = await msgPromise;

      // testUser marks it read
      const readPromise = waitForEvent(socketA, 'message_read', 5000);
      socketB.emit('mark_read', { message_id: msg.id });
      const readData = await readPromise;

      assert.equal(readData.message_id, msg.id);
      assert.equal(readData.user_id, testUser.user.id);
    });
  });
});
