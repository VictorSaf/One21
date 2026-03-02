// tests/test_client_logic.js — Static analysis tests for client-side logic
// Tests 6 (DM auto-redirect), 7 (image compression), 9 (scroll threshold)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CHAT_JS_PATH = path.join(__dirname, '..', 'public', 'js', 'chat.js');
const chatSource = fs.readFileSync(CHAT_JS_PATH, 'utf8');

describe('Test 6: DM Auto-Redirect (Client Logic)', () => {
  it('socket.on message handler contains DM auto-redirect logic', () => {
    // Look for the pattern: when a message arrives for a different room
    // and the room type is 'direct', call selectRoom()
    assert.ok(
      chatSource.includes("room.type === 'direct'") || chatSource.includes("room.type==='direct'"),
      'chat.js should check room.type === "direct" for DM auto-redirect'
    );
    assert.ok(
      chatSource.includes('selectRoom(msg.room_id)') || chatSource.includes('selectRoom(msg.room_id);'),
      'chat.js should call selectRoom(msg.room_id) for DM redirect'
    );
  });

  it('auto-redirect only fires when message is in a DIFFERENT room', () => {
    assert.ok(
      chatSource.includes('msg.room_id !== currentRoomId'),
      'DM redirect should only activate when msg.room_id !== currentRoomId'
    );
  });

  it('auto-redirect excludes own messages (sender_id check)', () => {
    assert.ok(
      chatSource.includes('msg.sender_id !== user.id'),
      'DM redirect should not fire for own messages'
    );
  });

  it('auto-redirect does NOT fire when already in the DM room', () => {
    // The condition msg.room_id !== currentRoomId already handles this
    const pattern = /msg\.room_id\s*!==\s*currentRoomId/;
    assert.ok(
      pattern.test(chatSource),
      'Condition msg.room_id !== currentRoomId prevents redirect when already in DM'
    );
  });
});

describe('Test 7: Image Compression (Client Logic)', () => {
  it('compressImage function exists with maxDimension=1280 default', () => {
    assert.ok(
      chatSource.includes('compressImage') && chatSource.includes('1280'),
      'compressImage function should exist with 1280 as max dimension'
    );
  });

  it('compression uses canvas resizing', () => {
    assert.ok(
      chatSource.includes('canvas') && chatSource.includes('drawImage'),
      'Image compression should use canvas and drawImage'
    );
  });

  it('compression outputs JPEG via toBlob', () => {
    assert.ok(
      chatSource.includes("'image/jpeg'") || chatSource.includes('"image/jpeg"'),
      'Compression should output image/jpeg'
    );
    assert.ok(
      chatSource.includes('toBlob'),
      'Should use canvas.toBlob for compression'
    );
  });

  it('GIF files are excluded from compression', () => {
    assert.ok(
      chatSource.includes('.gif') || chatSource.includes('isGif'),
      'GIFs should be identified and excluded'
    );
    // The pattern should be: if isImage AND NOT isGif, then compress
    assert.ok(
      chatSource.includes('isImage && !isGif'),
      'Compression condition should be isImage && !isGif'
    );
  });

  it('small images (both dimensions <= 1280) are not compressed', () => {
    // The function should return the original file when no resize is needed
    assert.ok(
      chatSource.includes('width <= maxDimension && height <= maxDimension'),
      'Should skip compression when image fits within maxDimension'
    );
  });

  it('logs before/after compression sizes to console', () => {
    assert.ok(
      chatSource.includes('[Compress]') || chatSource.includes('Compress'),
      'Should log compression results'
    );
  });
});

describe('Test 9: Scroll-to-Bottom Threshold (Client Logic)', () => {
  it('uses 150px threshold for near-bottom detection', () => {
    assert.ok(
      chatSource.includes('< 150'),
      'Near-bottom threshold should be 150px'
    );
  });

  it('auto-scrolls only when near bottom', () => {
    // Pattern: const nearBottom = ... < 150; ... if (nearBottom) scrollToBottom()
    const hasNearBottomCheck = chatSource.includes('nearBottom') && chatSource.includes('scrollToBottom');
    assert.ok(hasNearBottomCheck, 'Should check nearBottom before calling scrollToBottom on new message');
  });

  it('scrollToBottom function uses scrollTo with smooth behavior', () => {
    assert.ok(
      chatSource.includes('scrollTo') && chatSource.includes('smooth'),
      'scrollToBottom should use scrollTo with smooth behavior'
    );
  });

  it('does NOT force-scroll when user is scrolled up', () => {
    // The nearBottom variable gates scrollToBottom. If nearBottom is false
    // (i.e., user scrolled up more than 150px), scrollToBottom is not called.
    const pattern = /if\s*\(\s*nearBottom\s*\)\s*scrollToBottom/;
    assert.ok(
      pattern.test(chatSource),
      'scrollToBottom should be gated by nearBottom check'
    );
  });
});
