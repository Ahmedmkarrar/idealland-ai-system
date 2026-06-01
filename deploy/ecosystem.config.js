// PM2 process config for the IdealLand app.
// Single instance — SQLite doesn't tolerate concurrent writers.
module.exports = {
  apps: [
    {
      name: "idealland",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      cwd: "/home/idealland/idealland-ai-system",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "700M",
      env: {
        NODE_ENV: "production",
      },
      error_file: "/home/idealland/.pm2/logs/idealland-error.log",
      out_file: "/home/idealland/.pm2/logs/idealland-out.log",
      time: true,
      merge_logs: true,
    },
  ],
};
