import 'dotenv/config';

/**
 * Environment configuration.
 *
 * Parsed and validated once at import time so that a misconfigured deployment
 * fails immediately and loudly at boot, rather than at the first request that
 * happens to touch the broken setting.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function str(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

const NODE_ENV = str('NODE_ENV', 'development');
const isProduction = NODE_ENV === 'production';

if (isProduction) {
  // In production a missing secret must be fatal — falling back to a
  // development constant would let anyone mint a valid session cookie.
  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    const value = process.env[key];
    if (!value || value.length < 32) {
      throw new Error(`${key} must be set to at least 32 characters in production`);
    }
  }
}

export const env = {
  nodeEnv: NODE_ENV,
  isProduction,
  isTest: NODE_ENV === 'test',

  port: int('PORT', 4000),
  host: str('HOST', '0.0.0.0'),

  /** Public origin of the web client, used for CORS and password-reset links. */
  webOrigin: str('WEB_ORIGIN', 'http://localhost:5173'),

  databaseUrl: required('DATABASE_URL'),

  jwtSecret: str('JWT_SECRET', 'dev-only-insecure-jwt-secret-change-me-32chars'),
  jwtRefreshSecret: str(
    'JWT_REFRESH_SECRET',
    'dev-only-insecure-refresh-secret-change-me-32ch',
  ),
  accessTokenTtl: str('ACCESS_TOKEN_TTL', '15m'),
  refreshTokenTtlDays: int('REFRESH_TOKEN_TTL_DAYS', 30),

  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  cookieSecure: bool('COOKIE_SECURE', isProduction),
  cookieSameSite: str('COOKIE_SAME_SITE', 'lax') as 'lax' | 'strict' | 'none',

  /** Trust X-Forwarded-For. Only enable behind a proxy you control. */
  trustProxy: bool('TRUST_PROXY', false),

  rateLimitWindowMs: int('RATE_LIMIT_WINDOW_MS', 60_000),
  rateLimitMax: int('RATE_LIMIT_MAX', 300),
  authRateLimitMax: int('AUTH_RATE_LIMIT_MAX', 10),

  bcryptRounds: int('BCRYPT_ROUNDS', 12),
  maxLoginAttempts: int('MAX_LOGIN_ATTEMPTS', 8),
  lockoutMinutes: int('LOCKOUT_MINUTES', 15),

  /** Maximum rows the offline sync push will accept in one call. */
  syncMaxBatch: int('SYNC_MAX_BATCH', 100),
  syncMaxPullLimit: int('SYNC_MAX_PULL_LIMIT', 500),

  logLevel: str('LOG_LEVEL', isProduction ? 'info' : 'debug'),
} as const;

export type Env = typeof env;
