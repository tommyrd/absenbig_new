import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { getDb } from './src/server/db.ts';
import { registerApiRoutes } from './src/server/routes.ts';

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Initialize database & seed data synchronously
  getDb();

  // Register REST + SSE API routes
  registerApiRoutes(app);

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build dist/index.html tidak ditemukan.');
      }
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Absensi BIGNET server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Gagal memulai server Absensi BIGNET:', err);
  process.exit(1);
});
