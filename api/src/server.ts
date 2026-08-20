import cors from 'cors';
import express from 'express';
import { config, hasAdmin, hasDatabase, hasGasWallet, hasPrivy, hasVision } from './config.js';
import { query } from './db.js';
import { evidenceRouter } from './routes/evidence.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { identityRouter } from './routes/identity.js';
import { withdrawRouter } from './routes/withdraw.js';
import { storageIsEphemeral } from './storage.js';
import { attachRealtime, realtimeStatus } from './realtime.js';
import { chainStatus } from './chain.js';
import { relayerStatus } from './relayer.js';

const app = express();

/**
 * No ETags, and nothing cached.
 *
 * Express adds an ETag to every JSON response. The browser then sends
 * If-None-Match on the next request and gets a 304 with an empty body — which
 * for an API means the client has a successful-looking response containing no
 * data. That is exactly what happened to /auth/me: writes returned 200 and
 * every read came back 304, so the app could save a username and then never
 * read it back.
 *
 * Caching is wrong here regardless of the parsing problem. These responses are
 * scoped to whoever holds the bearer token, and a cache keyed only on the URL
 * cannot tell two people apart.
 */
app.set('etag', false);
app.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));

/**
 * One line per request log.
 *
 * Not decoration: the app and the API are separate processes, so when the
 * client reports "nothing saved" the first question is always whether the
 * request arrived at all. Without this, a request that never left the browser
 * and one that was rejected look exactly the same from here.
 */
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    const flag = res.statusCode >= 400 ? ' <-- FAILED' : '';
    console.log(
      `${req.method.padEnd(6)} ${req.originalUrl.padEnd(28)} ${res.statusCode} ` +
        `${Date.now() - started}ms${flag}`,
    );
  });
  next();
});

/**
 * Reports what is actually wired up rather than a bare "ok".
 *
 * Every optional dependency here degrades quietly by design — a missing
 * ANTHROPIC_API_KEY skips the relevance check, a missing DATABASE_URL runs the
 * gate without recording it — and quiet degradation is exactly the kind of
 * thing that goes unnoticed in a deployed service until someone asks why
 * nothing was ever checked. This endpoint makes it visible in one request.
 */
app.get('/health', async (_req, res) => {
  let database: 'connected' | 'unreachable' | 'not_configured' = 'not_configured';
  if (hasDatabase()) {
    try {
      await query('SELECT 1');
      database = 'connected';
    } catch {
      database = 'unreachable';
    }
  }

  res.json({
    ok: true,
    database,
    realtime: realtimeStatus(),
    chain: await chainStatus(),
    relayer: await relayerStatus(),
    auth: hasPrivy() ? 'privy' : 'not_configured',
    admin: hasAdmin() ? 'password_set' : 'not_configured',
    vision: hasVision() ? 'configured' : 'not_configured',
    storage: storageIsEphemeral ? 'disk (development only — files are lost on deploy)' : 'object',
    thresholds: {
      sharpness: config.sharpness,
      exposure: config.exposure,
      geo: config.geo,
      maxAttempts: config.maxAttempts,
    },
  });
});

app.use('/auth', authRouter);
app.use('/admin', adminRouter);
app.use('/identity', identityRouter);
app.use('/withdraw', withdrawRouter);
app.use('/evidence', evidenceRouter);

// Local media serving so a checked file can be looked at during development.
// Not a production path — see storage.ts.
if (storageIsEphemeral) {
  app.use('/media', express.static(config.storageDir));
}

app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

const server = app.listen(config.port, () => {
  console.log(`ask-nearby api on :${config.port}`);
  if (!hasDatabase()) console.log('  DATABASE_URL unset — checks run but nothing is recorded');
  if (!hasPrivy()) console.log('  PRIVY_APP_ID/SECRET unset — every request is unauthenticated');
  if (!hasAdmin()) console.log('  ADMIN_PASSWORD_HASH unset — the review desk is unreachable');
  if (!hasGasWallet()) console.log('  GAS_WALLET_PRIVATE_KEY unset — withdrawals are disabled');
  if (!hasVision()) console.log('  ANTHROPIC_API_KEY unset — relevance check will be skipped');
  if (storageIsEphemeral) console.log('  disk storage — development only');
});

// Shares the HTTP server, so realtime needs no second port and no second
// Railway service — one deploy, one domain, one thing to keep alive.
attachRealtime(server);
