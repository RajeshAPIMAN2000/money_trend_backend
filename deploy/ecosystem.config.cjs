module.exports = {
  apps: [
    {
      name: "moneytrend-api",
      cwd: "/var/www/moneytrend/backend",
      script: "app.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: 5001,
      },
      max_memory_restart: "512M",
      time: true,
      error_file: "/var/log/pm2/moneytrend-api-error.log",
      out_file: "/var/log/pm2/moneytrend-api-out.log",
      merge_logs: true,
      autorestart: true,
      watch: false,
      // App loads secrets from /var/www/moneytrend/backend/.env via config/loadEnv.js
      // Do NOT put SMTP_PASS here — keep it only in .env
    },
  ],
};
