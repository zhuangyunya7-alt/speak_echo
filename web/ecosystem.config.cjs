/**
 * PM2 config for production (`web/` directory).
 * Usage on server (from this folder): pm2 start ecosystem.config.cjs
 * Requires: npm ci && npm run build and .env.production (or env vars).
 */
const path = require("path");

module.exports = {
  apps: [
    {
      name: "speakecho-web",
      cwd: __dirname,
      script: path.join(__dirname, "node_modules", "next", "dist", "bin", "next"),
      args: "start",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
