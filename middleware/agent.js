const { getDb } = require('../db/init');

const { agent } = require('../config');
const AGENT_API_KEY = agent.apiKey;

function agentMiddleware(req, res, next) {
  const key = req.headers['x-agent-key'];
  if (!key || key !== AGENT_API_KEY) {
    return res.status(401).json({ error: 'Invalid agent API key' });
  }

  const username = req.headers['x-agent-username'];
  if (!username || typeof username !== 'string' || !username.trim()) {
    return res.status(401).json({ error: 'X-Agent-Username required' });
  }

  const db = getDb();
  const user = db.prepare('SELECT id, username, display_name, role FROM users WHERE username = ?').get(username.trim());
  if (!user) {
    return res.status(401).json({ error: 'Agent user not found' });
  }
  if (user.role !== 'agent') {
    return res.status(403).json({ error: 'User is not an agent' });
  }

  req.agentUser = user;
  next();
}

module.exports = { agentMiddleware };
