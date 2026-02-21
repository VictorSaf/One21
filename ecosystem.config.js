module.exports = {
  apps: [
    {
      name: 'one21',
      script: 'server.js',
      instances: 1,              // SQLite works best with a single instance
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '512M',

      env: {
        NODE_ENV: 'development',
        PORT: 3737,
      },

      env_production: {
        NODE_ENV: 'production',
        PORT: 3737,
      },

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,

      // Auto-restart config
      min_uptime: '5s',
      max_restarts: 10,
      restart_delay: 2000,
      exp_backoff_restart_delay: 100,
    },
  ],
};
