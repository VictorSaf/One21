// tests/helpers.js — Shared test utilities
'use strict';

const http = require('http');
const { io: ioClient } = require('socket.io-client');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3737';

/**
 * Make an HTTP request and return { status, headers, body }.
 * body is parsed as JSON when Content-Type is application/json.
 */
function request(method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { ...headers },
    };

    if (body && typeof body === 'object' && !(body instanceof Buffer)) {
      const json = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(json);
      const req = http.request(opts, handler);
      req.on('error', reject);
      req.write(json);
      req.end();
    } else {
      const req = http.request(opts, handler);
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    }

    function handler(res) {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    }
  });
}

/**
 * Multipart form-data upload helper for file uploads.
 */
function uploadFile(path, token, filename, content, mimeType) {
  return new Promise((resolve, reject) => {
    const boundary = '----TestBoundary' + Date.now();
    const url = new URL(path, BASE_URL);

    const bodyParts = [];
    bodyParts.push(`--${boundary}\r\n`);
    bodyParts.push(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`);
    bodyParts.push(`Content-Type: ${mimeType}\r\n\r\n`);
    bodyParts.push(content);
    bodyParts.push(`\r\n--${boundary}--\r\n`);

    const bodyBuffer = Buffer.concat(bodyParts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p)));

    const opts = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuffer.length,
        'Authorization': `Bearer ${token}`,
      },
    };

    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

/**
 * Login and return { token, user }.
 */
async function login(username, password) {
  const res = await request('POST', '/api/auth/login', {
    body: { username, password },
  });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/**
 * Authenticated GET/POST/PUT/DELETE.
 */
function authRequest(method, path, token, body) {
  return request(method, path, {
    body,
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Create a Socket.IO client connected and authenticated.
 * Returns the socket; caller must disconnect when done.
 */
function createSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(BASE_URL, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(err));
    setTimeout(() => reject(new Error('Socket connect timeout')), 5000);
  });
}

/**
 * Wait for a specific event on a socket, with timeout.
 */
function waitForEvent(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for '${event}'`)), timeoutMs);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

module.exports = {
  BASE_URL,
  request,
  uploadFile,
  login,
  authRequest,
  createSocket,
  waitForEvent,
};
