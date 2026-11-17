import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { closeDb, getDb } from './src/server/db.ts';
import { registerApiRoutes } from './src/server/routes.ts';
import { isHttpsRequest } from './src/server/auth.ts';

// Enforce official WIB timezone on server process
process.env.TZ = process.env.TZ || 'Asia/Jakarta';

function parseAllowedOrigins(): Set<string> {
  const raw = process.env.ALLOWED_ORIGINS || '';
  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (process.env.APP_URL && process.env.APP_URL.startsWith('http')) {
    try {
      origins.push(new URL(process.env.APP_URL).origin);
    } catch {
      // Ignore invalid APP_URL placeholder
    }
  }
  return new Set(origins);
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const isProd = process.env.NODE_ENV === 'production';
  const allowedOrigins = parseAllowedOrigins();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Security headers & CORS
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
    if (isProd && isHttpsRequest(req)) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    const origin = req.headers.origin;
    if (origin && (allowedOrigins.size === 0 ? !isProd : allowedOrigins.has(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Initialize database & apply migrations
  getDb();

  // Register REST + SSE API routes
  registerApiRoutes(app);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(
      express.static(distDir, {
        index: false,
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build dist/index.html tidak ditemukan. Jalankan npm run build terlebih dahulu.');
      }
    });
  }

  // Global safe error handler (prevents leaking stack traces in production)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'Format payload JSON tidak valid.' });
      return;
    }
    console.error('[SERVER_ERROR]', err);
    if (res.headersSent) return;
    res.status(500).json({
      error: 'Terjadi kesalahan internal server. Silakan coba lagi atau hubungi administrator.',
      detail: !isProd && err instanceof Error ? err.message : undefined,
    });
  });

  const server = app.listen(port, host, () => {
    console.log(
      `Absensi BIGNET server listening on http://${host}:${port} [${isProd ? 'production' : 'development'}, TZ=${process.env.TZ}]`
    );
  });

  const shutdown = (signal: string) => {
    console.log(`[SERVER] Menerima sinyal ${signal}, menutup koneksi & melakukan checkpoint database...`);
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    setTimeout(() => {
      closeDb();
      process.exit(1);
    }, 8000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

startServer().catch((err) => {
  console.error('Gagal memulai server Absensi BIGNET:', err);
  process.exit(1);
});
