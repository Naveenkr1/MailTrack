const path = require('path');

module.exports = {
  apps: [
    {
      name: 'mail-track',
      cwd: path.resolve(__dirname, '../..'),
      script: 'server/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 5000,
      max_memory_restart: '450M',
      env: {
        NODE_ENV: 'production',
        PORT: 4000
      }
    }
  ]
};
