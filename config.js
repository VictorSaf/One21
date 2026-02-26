// config.js
require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

const config = {
  port: parseInt(process.env.PORT, 10) || 3737,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd,

  jwt: {
    secret: process.env.JWT_SECRET || 'one21-dev-secret-change-in-prod',
  },

  cors: {
    origins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3737').split(','),
  },

  agent: {
    apiKey: process.env.AGENT_API_KEY || 'agent-dev-key-change-in-prod',
  },

  join: {
    baseUrl: process.env.JOIN_BASE_URL || `http://localhost:3737/one21/join`,
  },

  vapid: {
    publicKey:  process.env.VAPID_PUBLIC_KEY  || null,
    privateKey: process.env.VAPID_PRIVATE_KEY || null,
  },
};

// Guard: avertizează în producție dacă secretele sunt cele default
if (isProd) {
  const warnings = [];
  if (config.jwt.secret === 'one21-dev-secret-change-in-prod')
    warnings.push('JWT_SECRET folosește valoarea default — schimbă-o!');
  if (config.agent.apiKey === 'agent-dev-key-change-in-prod')
    warnings.push('AGENT_API_KEY folosește valoarea default — schimbă-o!');
  if (warnings.length) {
    warnings.forEach(w => console.error(`[CONFIG] ⚠️  ${w}`));
    process.exit(1);
  }
}

module.exports = config;
