// PM2 ecosystem config for Paseo daemon production deployment.
// Usage:
//   npm run prod:start    — start daemon via PM2
//   npm run prod:stop     — stop daemon
//   npm run prod:logs     — tail logs
//   npm run prod:status   — show process status
//
// Requires: npm install -g pm2
// See: packages/server/.env.production.example for required env vars.

module.exports = {
  apps: [
    {
      name: "paseo-daemon",
      script: "packages/server/dist/scripts/supervisor-entrypoint.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 15,
      restart_delay: 1000,
      // Prevent rapid crash-loop flapping from burning through max_restarts.
      // A process must stay up for at least 10s before the restart counts.
      min_uptime: "10s",
      max_memory_restart: "512M",
      // Allow time for the agent fleet to drain cleanly before SIGKILL.
      // Matches the ARCH-014 concern about large agent fleets at shutdown.
      kill_timeout: 30000,
      // Give the process time to bind its port and signal readiness.
      listen_timeout: 30000,
      error_file: "logs/paseo-daemon-error.log",
      out_file: "logs/paseo-daemon-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      env_production: {
        NODE_ENV: "production",
        PASEO_LOG_FORMAT: "json",
      },
    },
  ],
};
