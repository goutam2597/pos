import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { prisma } from './db/client.js';
import {
  bodyLimit,
  errorHandler,
  notFoundHandler,
  rateLimit,
  requirePermission,
  securityHeaders,
} from './middleware/index.js';
import { authMiddleware } from './modules/auth/service.js';
import { authRouter, metaRouter } from './routes/auth.routes.js';
import { catalogRouter } from './routes/catalog.routes.js';
import { uploadRouter } from './routes/upload.routes.js';
import { ensureUploadsDir, uploadsDir } from './lib/uploads.js';
import { inventoryRouter } from './modules/inventory/routes.js';
import { purchasingRouter } from './modules/accounting/purchasing.routes.js';
import { partiesRouter } from './routes/parties.routes.js';
import { salesRouter } from './routes/sales.routes.js';
import { accountingRouter } from './routes/accounting.routes.js';
import { orgRouter, i18nRouter } from './routes/org.routes.js';
import { reportsRouter } from './routes/reports.routes.js';
import { syncRouter } from './routes/sync.routes.js';
import { runWithContext } from './lib/context.js';

/**
 * HTTP application.
 *
 * The shape is deliberately conventional: security headers, CORS, cookie
 * parsing, a global body limit, then auth. `/auth/login` and `/auth/refresh`
 * are the only unauthenticated business routes; everything else requires a
 * valid session.
 */

export function createApp() {
  const app = express();

  ensureUploadsDir();

  // --- Uploaded files -----------------------------------------------------
  // Served without auth because <img> tags cannot send bearer tokens; the
  // filenames are random UUIDs minted by the server, so the directory is not
  // enumerable. Same cache name forever: a new upload is a new name.
  app.use(
    '/uploads',
    express.static(uploadsDir, {
      fallthrough: false,
      maxAge: '30d',
      immutable: true,
    }),
  );

  // Behind a reverse proxy, `req.ip` must come from X-Forwarded-For or every
  // client shares one rate-limit bucket. Only enabled when explicitly asked for.
  app.set('trust proxy', env.trustProxy);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON only; CSP belongs to the web client, which sets it
      // itself. Strict here would break nothing but also protect nothing.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin: env.isProduction ? env.webOrigin : true,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id', 'X-Branch-Id'],
      exposedHeaders: ['Retry-After'],
      maxAge: 600,
    }),
  );

  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(securityHeaders());
  app.use(bodyLimit('1mb', (req) => req.path === '/api/v1/uploads'));

  if (!env.isTest) {
    app.use(
      morgan(env.isProduction ? 'combined' : 'dev', {
        skip: (req) => req.path === '/api/v1/health',
      }),
    );
  }

  // The global per-IP budget covers business API traffic. Credential
  // endpoints are exempt here and carry their own stricter, per-identity
  // limiter instead — a chatty or misbehaving client burning the shared
  // bucket must not also lock the operator out of signing in.
  app.use(
    rateLimit({
      skip: (req) => req.path.startsWith('/api/v1/auth/'),
    }),
  );

  // --- Health -------------------------------------------------------------
  // Checks the database too: a server that answers 200 while Postgres is down
  // is worse than one that fails, because the load balancer keeps sending
  // traffic to it.
  app.get('/api/v1/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', database: 'connected', uptime: process.uptime() });
    } catch (error) {
      res.status(503).json({ status: 'degraded', database: 'unreachable', message: (error as Error).message });
    }
  });

  const api = express.Router();

  // --- Public auth --------------------------------------------------------
  api.use('/auth', authRouter);
  api.use('/', metaRouter);

  // --- Everything else requires a session ---------------------------------
  api.use(authMiddleware({ required: true }), establishContext);

  // Multipart uploads. Requires product create OR update, because today the
  // only consumer is the product image field on the catalogue form.
  api.use(
    '/uploads',
    requirePermission([], ['product:create', 'product:update']),
    uploadRouter,
  );

  // A till that has been offline cannot refresh its access token, so the sync
  // endpoints additionally accept an expired one and re-check the session row.
  api.use('/sync', authMiddleware({ required: true, allowExpired: true }), syncRouter);
  // Inventory reads are defined in their own module beside the stock engine;
  // they must mount BEFORE the catch-all catalog router or `/inventory/stock`
  // would be swallowed by a 404.
  api.use('/inventory', inventoryRouter);
  api.use('/', purchasingRouter);
  api.use('/catalog', catalogRouter);
  api.use('/', catalogRouter); // flat aliases: /products, /categories, ...
  api.use('/parties', partiesRouter);
  api.use('/', partiesRouter);
  api.use('/', salesRouter);
  api.use('/accounting', accountingRouter);
  api.use('/', orgRouter);
  api.use('/i18n', i18nRouter);
  api.use('/', reportsRouter);

  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * Materialise the request context for the lifetime of the request.
 *
 * `enterWith` binds the store to the current async context, so every service
 * call made while handling this request can read the acting user without it
 * being threaded through signatures.
 */
function establishContext(req: express.Request, _res: express.Response, next: express.NextFunction) {
  if (!req.ctx) {
    next(new Error('Authentication middleware did not populate the request context'));
    return;
  }
  runWithContext(req.ctx, () => next());
}
