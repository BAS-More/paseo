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
      max_restarts: 10,
      restart_delay: 1000,
      max_memory_restart: "512M",
      env_production: {
        NODE_ENV: "production",
        PASEO_LOG_FORMAT: "json",
      },
    },
  ],
};
