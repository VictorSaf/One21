const AGENT_API_KEY = process.env.AGENT_API_KEY || 'agent-dev-key-change-in-prod';

function agentMiddleware(req, res, next) {
  const key = req.headers['x-agent-key'];
  if (!key || key !== AGENT_API_KEY) {
    return res.status(401).json({ error: 'Invalid agent API key' });
  }
  next();
}

module.exports = { agentMiddleware };
