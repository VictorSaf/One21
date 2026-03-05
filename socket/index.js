// socket/index.js
'use strict';

const jwt = require('jsonwebtoken');
const { getDb, getDbDriver, getPgPool } = require('../db');
const config = require('../config');
const { isTokenRevoked } = require('../lib/jwt-revoke');

const presenceHandlers = require('./handlers/presence');
const roomHandlers     = require('./handlers/rooms');
const messageHandlers  = require('./handlers/messages');

function initSocket(io) {
  // Auth middleware Socket.IO
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const payload = jwt.verify(token, config.jwt.secret);
      if (isTokenRevoked(payload)) {
        return next(new Error('Token revoked'));
      }
      socket.user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const driver = getDbDriver();
    const ctx = driver === 'postgres'
      ? { driver, pool: getPgPool() }
      : { driver, db: getDb() };

    presenceHandlers.register(io, socket, ctx);
    roomHandlers.register(io, socket, ctx);
    messageHandlers.register(io, socket, ctx);
  });
}

module.exports = { initSocket };
