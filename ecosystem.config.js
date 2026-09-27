module.exports = {
  apps: [
    {
      name: 'aero-kino-bot',
      script: 'index.js',
      // Bot qulasa (crash) — avtomatik qayta ishga tushiradi
      autorestart: true,
      // Xotira 300MB dan oshsa ham qayta ishga tushiradi (ehtiyot chorasi)
      max_memory_restart: '300M',
      // Serverni qayta yoqishdan keyin ham ishlab turishi uchun (pm2 startup bilan birga)
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
