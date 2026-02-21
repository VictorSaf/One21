const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const LOG_FILE = path.join(__dirname, 'conversation.json');
let messages = [];

// Load existing messages
if (fs.existsSync(LOG_FILE)) {
  try { messages = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch(e) { messages = []; }
}

function saveMessages() {
  fs.writeFileSync(LOG_FILE, JSON.stringify(messages, null, 2), 'utf8');
}

// API endpoint for Claude to read messages
app.get('/api/messages', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  res.json(messages.filter((m, i) => i >= since));
});

// API endpoint for Claude to send messages
app.post('/api/send', express.json(), (req, res) => {
  const msg = {
    id: messages.length,
    sender: 'Claude',
    text: req.body.text,
    timestamp: new Date().toISOString()
  };
  messages.push(msg);
  saveMessages();
  io.emit('message', msg);
  res.json({ ok: true, id: msg.id });
});

// Serve the chat UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Socket.IO handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('message', (data) => {
    const msg = {
      id: messages.length,
      sender: data.sender,
      text: data.text,
      timestamp: new Date().toISOString()
    };
    messages.push(msg);
    saveMessages();
    io.emit('message', msg);
    console.log(`[${msg.sender}]: ${msg.text.substring(0, 80)}...`);
  });

  socket.on('typing', (data) => {
    socket.broadcast.emit('typing', data);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = 3737;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Chat server running on http://localhost:${PORT}`);
});
