import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { prisma, transaction } from '../../db/client.js';
import { env } from '../../config/env.js';
import { AppError, forbidden, unauthenticated } from '../../lib/errors.js';
import { parsePermissions, SYSTEM_ROLES, allPermissions, type Permission, type SystemRole } from '@monopos/shared';

/**
 * Authentication: password login, JWT access tokens, rotating refresh tokens.
 *
 * Threat model in one paragraph. Passwords are bcrypt-hashed at a cost that is
 * re-evaluated on upgrade. Access tokens are short-lived and stateless. Refresh
 * tokens are opaque, stored only as a SHA-256 hash, and ROTATE on every use: a
 * stolen refresh token is usable once and its reuse revokes the whole family,
 * which is the standard detection for token theft. Login is rate limited and
 * locks the account after repeated failures.
 */

const ACCESS_TOKEN_ISSUER = 'monopos';
const ACCESS_TOKEN_AUDIENCE = 'monopos-web';

export interface AccessTokenClaims {
  sub: string;
  bid: string;
  sid: string;
  email: string;
  /** Snapshot of effective permissions, so authorisation needs no role walk. */
  perms: string[];
  /** Empty array = all branches. */
  branches: string[];
}

export function signAccessToken(claims: AccessTokenClaims): string {
  // `sub` is already a field of the payload; passing `subject` as an option as
  // well makes jsonwebtoken throw, because it refuses to set it twice.
  return jwt.sign(claims, env.jwtSecret, {
    // `env.accessTokenTtl` is a runtime string like "15m"; the type wants the
    // narrower `StringValue` union, which we cannot prove statically.
    expiresIn: env.accessTokenTtl as SignOptions['expiresIn'],
    issuer: ACCESS_TOKEN_ISSUER,
    audience: ACCESS_TOKEN_AUDIENCE,
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const decoded = jwt.verify(token, env.jwtSecret, {
      issuer: ACCESS_TOKEN_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
    });
    if (typeof decoded === 'string') throw new Error('unexpected token payload');
    return decoded as unknown as AccessTokenClaims;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError('TOKEN_EXPIRED', 'Your session has expired — please sign in again', {
        cause: error,
      });
    }
    throw unauthenticated('Invalid session token');
  }
}

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

function newRefreshToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

// --- Passwords -------------------------------------------------------------

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.bcryptRounds);
}

/**
 * Verify a password, tolerating a cost-factor upgrade.
 *
 * If the stored hash was made with a weaker cost than the current setting, the
 * password is re-hashed transparently on successful login, so raising
 * `BCRYPT_ROUNDS` improves security for everyone as they next sign in.
 */
async function verifyAndUpgrade(userId: string, plain: string, stored: string): Promise<boolean> {
  const okPassword = await bcrypt.compare(plain, stored);
  if (!okPassword) return false;

  const cost = Number.parseInt(stored.split('$')[2] ?? '0', 10);
  if (Number.isFinite(cost) && cost < env.bcryptRounds) {
    const upgraded = await hashPassword(plain);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: upgraded } });
  }
  return true;
}

/** In production, reject passwords that are trivially guessable. */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', '12345678', '123456789', 'qwerty123', 'admin123',
  'letmein', 'welcome', 'iloveyou', 'monopos', 'changeme',
]);

export function assertPasswordAcceptable(plain: string): void {
  if (plain.length < 10) {
    throw new AppError('VALIDATION_FAILED', 'Password must be at least 10 characters', {
      details: { password: 'Must be at least 10 characters' },
    });
  }
  if (plain.length > 200) {
    throw new AppError('VALIDATION_FAILED', 'Password must be under 200 characters', {
      details: { password: 'Too long' },
    });
  }
  if (COMMON_PASSWORDS.has(plain.toLowerCase())) {
    throw new AppError('VALIDATION_FAILED', 'That password is too common — choose another', {
      details: { password: 'Too common' },
    });
  }
}

// --- Session issuance ------------------------------------------------------

async function loadEffectiveAccess(userId: string): Promise<{ permissions: string[]; branchIds: string[] }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isSuperAdmin: true,
      branchIds: true,
      roles: { select: { role: { select: { permissions: { select: { permission: { select: { resource: true, action: true } } } } } } } },
    },
  });
  if (!user) throw unauthenticated();

  if (user.isSuperAdmin) {
    return { permissions: allPermissions(), branchIds: [] };
  }

  const permissions = new Set<string>();
  for (const userRole of user.roles) {
    for (const rp of userRole.role.permissions) {
      permissions.add(`${rp.permission.resource}:${rp.permission.action}`);
    }
  }
  return { permissions: [...permissions], branchIds: user.branchIds };
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  sessionId: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string | null;
    locale: string;
    businessId: string;
    permissions: string[];
    branchIds: string[];
  };
  business: { id: string; name: string; currency: string; timezone: string; defaultLanguage: string };
}

/**
 * Create a session for a user, optionally binding it to a POS register.
 *
 * Binding matters: a till session and an admin session have very different
 * blast radii if stolen, and the audit log should be able to say which physical
 * terminal a sale came from.
 */
export async function issueSession(
  userId: string,
  meta: { ip?: string; userAgent?: string; registerId?: string },
): Promise<IssuedSession> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { business: true },
  });
  if (!user) throw unauthenticated();
  if (!user.isActive) throw new AppError('ACCOUNT_DISABLED', 'This account has been disabled');

  const { permissions, branchIds } = await loadEffectiveAccess(userId);
  const refreshToken = newRefreshToken();

  const session = await prisma.authSession.create({
    data: {
      businessId: user.businessId,
      userId,
      registerId: meta.registerId ?? null,
      refreshTokenHash: hashToken(refreshToken),
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ip ?? null,
      permissions,
      branchIds,
      expiresAt: new Date(Date.now() + env.refreshTokenTtlDays * 86_400_000),
    },
  });

  const accessToken = signAccessToken({
    sub: user.id,
    bid: user.businessId,
    sid: session.id,
    email: user.email,
    perms: permissions,
    branches: branchIds,
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: env.accessTokenTtl,
    sessionId: session.id,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      locale: user.locale,
      businessId: user.businessId,
      permissions,
      branchIds,
    },
    business: {
      id: user.business.id,
      name: user.business.name,
      currency: user.business.currency,
      timezone: user.business.timezone,
      defaultLanguage: user.business.defaultLanguage,
    },
  };
}

// --- Login / refresh / logout ---------------------------------------------

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
  registerId: z.string().optional(),
});

export async function login(
  input: z.infer<typeof loginSchema>,
  meta: { ip?: string; userAgent?: string },
): Promise<IssuedSession> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Uniform failure for "no such user" and "wrong password" so the endpoint
  // cannot be used to enumerate which emails have accounts.
  const invalid = new AppError('INVALID_CREDENTIALS', 'Email or password is incorrect');

  if (!user) {
    // Still spend the bcrypt time, so response timing does not leak existence.
    await bcrypt.compare(input.password, '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
    throw invalid;
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new AppError('ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${minutes} minute(s).`);
  }

  if (!user.isActive) throw new AppError('ACCOUNT_DISABLED', 'This account has been disabled');

  const passwordOk = await verifyAndUpgrade(user.id, input.password, user.passwordHash);
  if (!passwordOk) {
    const attempts = user.failedLoginAttempts + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil:
          attempts >= env.maxLoginAttempts
            ? new Date(Date.now() + env.lockoutMinutes * 60_000)
            : null,
      },
    });
    throw invalid;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      businessId: user.businessId,
      userId: user.id,
      action: 'LOGIN',
      entityType: 'Session',
      entityId: input.registerId ?? null,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });

  return issueSession(user.id, meta);
}

/**
 * Exchange a refresh token for a new pair.
 *
 * The old token is revoked in the same transaction that issues the new one, so
 * a token cannot be used twice. If a revoked token is presented anyway, that is
 * strong evidence it was captured by someone else, and every session for the
 * user is revoked.
 */
export async function refresh(token: string): Promise<IssuedSession> {
  const hashed = hashToken(token);
  const session = await prisma.authSession.findUnique({
    where: { refreshTokenHash: hashed },
    include: { user: { include: { business: true } } },
  });

  if (!session || session.expiresAt < new Date()) {
    throw new AppError('TOKEN_EXPIRED', 'Your session has expired — please sign in again');
  }

  if (session.revokedAt) {
    // Two tabs sharing one cookie jar race on rotation: the loser presents a
    // token that was rotated away seconds ago. That is a lost race, not a
    // stolen token — cascading on it would sign EVERY tab out on every page
    // load. Only a token revoked longer than the grace window ago is treated
    // as reuse; within the window this session (already revoked) is just
    // refused and the operator signs in again in the tab that lost.
    const REVOCATION_GRACE_MS = 45_000;
    const benignRace = Date.now() - session.revokedAt.getTime() < REVOCATION_GRACE_MS;

    if (!benignRace) {
      await transaction(async (tx) => {
        await tx.authSession.updateMany({
          where: { userId: session.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      });
      await prisma.auditLog.create({
        data: {
          businessId: session.user.businessId,
          userId: session.userId,
          action: 'LOGOUT',
          entityType: 'Session',
          entityId: session.id,
          changes: { reason: 'refresh_token_reuse_detected' },
        },
      });
    }
    throw new AppError('TOKEN_EXPIRED', 'Your session has expired — please sign in again');
  }

  // Rotation-velocity guard. A client stuck in a refresh→replay loop with a
  // live cookie rotates sessions as fast as the event loop allows (observed:
  // ~90k session rows overnight). Each rotation is individually legitimate;
  // the VELOCITY is not. A human rotates a handful of times a minute at most.
  const recentSessions = await prisma.authSession.count({
    where: { userId: session.userId, createdAt: { gt: new Date(Date.now() - 10_000) } },
  });
  if (recentSessions > 20) {
    throw new AppError('RATE_LIMITED', 'Session refresh is being throttled — retry shortly', {
      retryAfter: 5,
    });
  }

  // A password change bumps tokenVersion; compare against the value embedded in
  // the access token at verify time. Here we just refuse stale sessions outright.
  if (!session.user.isActive) throw new AppError('ACCOUNT_DISABLED', 'This account has been disabled');

  const { permissions, branchIds } = await loadEffectiveAccess(session.userId);
  const nextRefresh = newRefreshToken();

  const next = await transaction(async (tx) => {
    await tx.authSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return tx.authSession.create({
      data: {
        businessId: session.userId ? session.user.businessId : session.user.businessId,
        userId: session.userId,
        registerId: session.registerId,
        refreshTokenHash: hashToken(nextRefresh),
        userAgent: session.userAgent,
        ipAddress: session.ipAddress,
        permissions,
        branchIds,
        expiresAt: new Date(Date.now() + env.refreshTokenTtlDays * 86_400_000),
      },
    });
  });

  const accessToken = signAccessToken({
    sub: session.userId,
    bid: session.user.businessId,
    sid: next.id,
    email: session.user.email,
    perms: permissions,
    branches: branchIds,
  });

  return {
    accessToken,
    refreshToken: nextRefresh,
    expiresIn: env.accessTokenTtl,
    sessionId: next.id,
    user: {
      id: session.user.id,
      email: session.user.email,
      firstName: session.user.firstName,
      lastName: session.user.lastName,
      locale: session.user.locale,
      businessId: session.user.businessId,
      permissions,
      branchIds,
    },
    business: {
      id: session.user.business.id,
      name: session.user.business.name,
      currency: session.user.business.currency,
      timezone: session.user.business.timezone,
      defaultLanguage: session.user.business.defaultLanguage,
    },
  };
}

export async function logout(sessionId: string, businessId: string): Promise<void> {
  await prisma.authSession.updateMany({
    where: { id: sessionId, businessId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function logoutEverywhere(userId: string, businessId: string): Promise<number> {
  const result = await prisma.authSession.updateMany({
    where: { userId, businessId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new AppError('INVALID_CREDENTIALS', 'Your current password is incorrect');
  }
  assertPasswordAcceptable(newPassword);
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    throw new AppError('VALIDATION_FAILED', 'The new password must be different from the old one', {
      details: { newPassword: 'Must differ from the current password' },
    });
  }

  await transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(newPassword),
        passwordChangedAt: new Date(),
        // Invalidates every outstanding access token immediately.
        tokenVersion: { increment: 1 },
      },
    });
    await tx.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });
}

// --- Request-level authentication -----------------------------------------

export interface AuthOptions {
  /** Reject when no valid token is present. Defaults to true. */
  required?: boolean;
  /** Ignore an expired token instead of rejecting it, for the sync endpoint. */
  allowExpired?: boolean;
}

export async function authenticate(
  req: Request,
  options: AuthOptions = {},
): Promise<void> {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    if (options.required === false) return;
    throw unauthenticated();
  }

  let claims: AccessTokenClaims;
  try {
    claims = verifyAccessToken(token);
  } catch (error) {
    if (options.allowExpired && error instanceof AppError && error.code === 'TOKEN_EXPIRED') {
      // A till that has been offline for hours cannot refresh its token. The
      // sync endpoint re-verifies the session row below, so accepting an expired
      // *access* token here is safe as long as the session is still alive.
      const decoded = decodeExpired(token);
      if (!decoded) throw error;
      claims = decoded;
    } else {
      throw error;
    }
  }

  const session = await prisma.authSession.findUnique({
    where: { id: claims.sid },
    select: { id: true, businessId: true, userId: true, revokedAt: true, expiresAt: true, permissions: true, branchIds: true, registerId: true },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw new AppError('TOKEN_EXPIRED', 'Your session has ended — please sign in again');
  }
  if (session.userId !== claims.sub || session.businessId !== claims.bid) {
    throw unauthenticated('Invalid session');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, isActive: true, tokenVersion: true },
  });
  if (!user || !user.isActive) throw new AppError('ACCOUNT_DISABLED', 'This account has been disabled');

  req.ctx = {
    userId: user.id,
    businessId: claims.bid,
    email: user.email,
    sessionId: session.id,
    permissions: new Set(parsePermissions(session.permissions as string[])),
    branchIds: session.branchIds,
    ip: req.ip,
    userAgent: req.header('user-agent') ?? undefined,
  };

  const deviceId = req.header('x-device-id');
  if (deviceId) req.ctx.deviceId = deviceId;
}

/** Decode a token without verifying, used only to recover identity on expiry. */
function decodeExpired(token: string): AccessTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    if (typeof payload?.sub !== 'string' || typeof payload?.sid !== 'string') return null;
    return payload as AccessTokenClaims;
  } catch {
    return null;
  }
}

/**
 * Express middleware wrapper around `authenticate`.
 *
 * Keeping the async function separate means the sync endpoint can call it
 * directly with explicit options (`allowExpired`) rather than smuggling those
 * through middleware configuration.
 */
export function authMiddleware(options: AuthOptions = {}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    authenticate(req, options)
      .then(() => next())
      .catch(next);
  };
}

export function clientIp(req: Request): string | undefined {
  if (env.trustProxy) return req.ip;
  return req.socket.remoteAddress ?? undefined;
}

// --- Role helpers ----------------------------------------------------------

export function assertValidPermissions(values: string[]): Permission[] {
  const parsed = parsePermissions(values);
  if (parsed.length !== values.length) {
    const bad = values.filter((v) => !parsePermissions([v]).length);
    throw forbidden(`Unknown permissions: ${bad.join(', ')}`);
  }
  return parsed;
}

export { SYSTEM_ROLES };
export type { SystemRole, Permission };
