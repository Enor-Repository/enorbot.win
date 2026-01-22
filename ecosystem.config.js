/**
 * PM2 Configuration for eNorBOT.
 * Auto-restart on crash, production environment.
 */
module.exports = {
  apps: [
    {
      name: 'enorbot',
      script: 'dist/index.js',
      cwd: '/opt/enorbot',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      // Restart delay to prevent rapid restarts
      restart_delay: 5000,
      // Max restarts before stopping
      max_restarts: 10,
      // Time window for max_restarts
      min_uptime: '10s',
      // Log configuration
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
