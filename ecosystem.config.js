module.exports = {
  apps: [
    {
      name: 'absensi-bignet',
      script: 'server.ts',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      kill_timeout: 8000,
      listen_timeout: 10000,
      env_production: {
        NODE_ENV: 'production',
        TZ: 'Asia/Jakarta',
        PORT: 3000,
        HOST: '127.0.0.1',
      },
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
