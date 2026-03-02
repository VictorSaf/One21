// socket/index.js
'use strict';

const jwt = require('jsonwebtoken');
const { getDb } = require('../db/init');
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
    const db = getDb();

    presenceHandlers.register(io, socket, db);
    roomHandlers.register(io, socket, db);
    messageHandlers.register(io, socket, db);
  });
}

module.exports = { initSocket };
