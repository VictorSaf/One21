// tests/setup.js — Create a second test user for tests requiring two users
'use strict';

const { login, authRequest } = require('./helpers');

const TEST_USER = {
  password: 'qatest123456',
  display_name: 'QA Bot',
};

let _adminAuth = null;
let _testUserAuth = null;

/**
 * Ensure admin is logged in.
 */
async function getAdmin() {
  if (_adminAuth) return _adminAuth;
  _adminAuth = await login('admin', 'admin123');
  return _adminAuth;
}

/**
 * Create a fresh test user via invite flow and return { token, user }.
 * Uses the admin account to create an invite, then registers.
 */
async function getOrCreateTestUser() {
  if (_testUserAuth) return _testUserAuth;

  const admin = await getAdmin();

  // Create invite
  const invRes = await authRequest('POST', '/api/admin/invites', admin.token, {
    note: 'QA test user',
  });
  if (invRes.status !== 200 || !invRes.body.code) {
    throw new Error(`Failed to create invite: ${JSON.stringify(invRes.body)}`);
  }

  // Register (retry on username collision)
  const { request } = require('./helpers');
  const maxAttempts = 5;
  let regRes;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const username = `qabot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    regRes = await request('POST', '/api/auth/register', {
      body: {
        username,
        password: TEST_USER.password,
        display_name: TEST_USER.display_name,
        invite_code: invRes.body.code,
      },
    });

    if (regRes.status === 200 && regRes.body && regRes.body.token) break;

    const errMsg = regRes && regRes.body && regRes.body.error ? String(regRes.body.error) : '';
    const isCollision = regRes && regRes.status === 400 && errMsg.toLowerCase().includes('username already');
    if (!isCollision || attempt === maxAttempts) {
      throw new Error(`Failed to register test user: ${JSON.stringify(regRes.body)}`);
    }
  }

  _testUserAuth = regRes.body;
  return _testUserAuth;
}

/**
 * Find a shared room between admin and another user (group or channel).
 */
async function findSharedRoom(token) {
  const res = await authRequest('GET', '/api/rooms', token);
  if (res.status !== 200) throw new Error('Failed to load rooms');
  const rooms = res.body.rooms || [];
  // Prefer a group or channel room
  return rooms.find(r => r.type === 'group' || r.type === 'channel') || rooms[0];
}

module.exports = {
  TEST_USER,
  getAdmin,
  getOrCreateTestUser,
  findSharedRoom,
};
