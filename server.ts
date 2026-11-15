import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import toolsRouter from './server/routes/tools.ts';
import filesRouter from './server/routes/files.ts';
import downloadRouter from './server/routes/download.ts';
import qrRouter from './server/routes/qr.ts';
import adminRouter from './server/routes/admin.ts';
import { startTempCleanupLoop } from './server/tempStorage.ts';
import { startQrCleanupLoop } from './server/qrStorage.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';

async function bootstrap() {
  const app = express();
  app.set('trust proxy', 1);

  // Security headers tuned for iframe preview & Firebase popup auth
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Origin check for mutating API requests (CSRF protection)
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const origin = req.headers.origin;
      const host = req.headers.host;
      if (origin && host) {
        try {
          const originHost = new URL(origin).host;
          const isAllowed =
            originHost === host ||
            originHost.endsWith('.run.app') ||
            originHost.includes('localhost') ||
            originHost.includes('127.0.0.1');
          if (!isAllowed) {
            res.status(403).json({ error: 'Blocked cross-origin request.' });
            return;
          }
        } catch {
          res.status(403).json({ error: 'Invalid request origin.' });
          return;
        }
      }
    }
    next();
  });

  // Rate limiting tuned so 100-file batches and downloads never hit false 429s
  const toolsAndDownloadLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 350,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a moment and try again.' },
  });
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a moment and try again.' },
  });
  app.use('/api/tools', toolsAndDownloadLimiter);
  app.use('/api/download', toolsAndDownloadLimiter);
  app.use('/api/qr', toolsAndDownloadLimiter);
  app.use('/api', apiLimiter);

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'rikzen-tools' });
  });

  // API routes
  app.use('/api/tools', toolsRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/download', downloadRouter);
  app.use('/api/qr', qrRouter);
  app.use('/api', adminRouter);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath, { maxAge: '7d' }));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'Endpoint not found.' });
        return;
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  startTempCleanupLoop();
  startQrCleanupLoop();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RIKZEN server listening on http://0.0.0.0:${PORT} (${isProd ? 'production' : 'development'})`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start RIKZEN server:', err);
  process.exit(1);
});
