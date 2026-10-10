import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { handler, ok, created, noContent, parseBody } from '../lib/http.js';
import { runWithContext } from '../lib/context.js';
import { authRateLimiter, rateLimit } from '../middleware/index.js';
import {
  authenticate,
  changePassword,
  clientIp,
  login,
  loginSchema,
  logout,
  logoutEverywhere,
  refresh,
} from '../modules/auth/service.js';
import { assertPasswordAcceptable } from '../modules/auth/service.js';
import { hashPassword } from '../modules/auth/service.js';
import { allPermissions, ROLE_PERMISSIONS, SYSTEM_ROLES } from '@monopos/shared';

/**
 * Authentication routes.
 *
 * `refresh` and `logout` are deliberately reachable WITHOUT a bearer token:
 * the refresh token is an httpOnly cookie, so there is no Authorization header
 * to present, and the cookie itself is the credential. Everything else
 * requires a valid session.
 */

export const authRouter = Router();

/**
 * The refresh endpoint is the one a broken client can loop on (a 401 there
 * triggers the SPA's refresh-and-retry), so it carries its own cap. Keyed by
 * the cookie's hash, not mere presence: a looping client presenting one dead
 * or stable cookie then burns only its OWN bucket, while every tab of a
 * legitimately signed-in browser shares that browser's live cookie and keeps
 * its own budget. Rotation changes the cookie, which starts a fresh budget —
 * bounded separately by the rotation-velocity guard in the service.
 */
const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 60,
  key: (req) => {
    const cookie = req.cookies?.monopos_refresh as string | undefined;
    const id = cookie
      ? createHash('sha256').update(cookie).digest('hex').slice(0, 16)
      : 'anonymous';
    return `${req.ip}:${id}`;
  },
});

// --- Public ----------------------------------------------------------------

authRouter.post(
  '/login',
  authRateLimiter,
  handler(async (req, res) => {
    const input = parseBody(loginSchema, req);
    const session = await login(input, {
      ip: clientIp(req),
      userAgent: req.header('user-agent'),
    });

    // The refresh token is the ONLY thing that must not live in JS, so it goes
    // out as an httpOnly cookie while the short-lived access token is returned
    // in the body for the SPA to hold in memory.
    res.cookie('monopos_refresh', session.refreshToken, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    ok(res, {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      user: session.user,
      business: session.business,
    });
  }),
);

authRouter.post(
  '/refresh',
  refreshRateLimiter,
  handler(async (req, res) => {
    const token = req.cookies?.monopos_refresh as string | undefined;
    if (!token) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'No active session' } });
      return;
    }

    let session;
    try {
      session = await refresh(token);
    } catch (error) {
      // A token the server has rejected is dead: stop handing it back on
      // every retry. Clearing the cookie here is what silences a client stuck
      // re-presenting a rotated-away or deleted token — without it the retry
      // loop re-triggers revocation handling forever.
      const code = (error as { code?: string }).code;
      if (code === 'TOKEN_EXPIRED' || code === 'UNAUTHENTICATED') {
        res.clearCookie('monopos_refresh', { path: '/api/v1/auth' });
      }
      throw error;
    }

    res.cookie('monopos_refresh', session.refreshToken, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    ok(res, {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      user: session.user,
      business: session.business,
    });
  }),
);

// --- Authenticated ---------------------------------------------------------

authRouter.post(
  '/logout',
  handler(async (req, res) => {
    const token = req.cookies?.monopos_refresh as string | undefined;
    if (token) {
      try {
        const session = await refresh(token);
        await logout(session.sessionId, session.user.businessId);
      } catch {
        // The refresh token may already be dead; clearing the cookie is still
        // the correct response to a logout request.
      }
    }
    res.clearCookie('monopos_refresh', { path: '/api/v1/auth' });
    noContent(res);
  }),
);

authRouter.get(
  '/me',
  handler(async (req, res) => {
    await authenticate(req);
    const ctx = req.ctx!;

    const [user, business] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: ctx.userId },
        select: { id: true, email: true, firstName: true, lastName: true, locale: true, isSuperAdmin: true, branchIds: true },
      }),
      prisma.business.findUniqueOrThrow({
        where: { id: ctx.businessId },
        select: {
          id: true, name: true, currency: true, timezone: true,
          defaultLanguage: true, logoUrl: true, country: true,
        },
      }),
    ]);

    ok(res, {
      user: { ...user, businessId: ctx.businessId, permissions: [...ctx.permissions] },
      business,
    });
  }),
);

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10, 'Password must be at least 10 characters'),
});

authRouter.patch(
  '/password',
  handler(async (req, res) => {
    await authenticate(req);
    const input = parseBody(passwordSchema, req);
    assertPasswordAcceptable(input.newPassword);

    await changePassword(req.ctx!.userId, input.currentPassword, input.newPassword);
    res.clearCookie('monopos_refresh', { path: '/api/v1/auth' });
    ok(res, { message: 'Password changed. Please sign in again.' });
  }),
);

authRouter.post(
  '/logout-everywhere',
  handler(async (req, res) => {
    await authenticate(req);
    const count = await logoutEverywhere(req.ctx!.userId, req.ctx!.businessId);
    res.clearCookie('monopos_refresh', { path: '/api/v1/auth' });
    ok(res, { revokedSessions: count });
  }),
);

// --- Permission catalogue (readable while signed in, needed to build the UI) --

export const metaRouter = Router();

metaRouter.get(
  '/permissions',
  handler(async (req, res) => {
    await authenticate(req);
    ok(res, {
      permissions: allPermissions(),
      systemRoles: SYSTEM_ROLES.map((role) => ({
        role,
        permissions: ROLE_PERMISSIONS[role],
      })),
    });
  }),
);

/** Users the signed-in user may act as (managers can open a session for staff). */
metaRouter.get(
  '/whoami',
  handler(async (req, res) => {
    await authenticate(req);
    const ctx = req.ctx!;
    const business = await prisma.business.findUniqueOrThrow({
      where: { id: ctx.businessId },
      select: { id: true, name: true, currency: true, timezone: true, defaultLanguage: true },
    });
    ok(res, {
      user: {
        id: ctx.userId,
        email: ctx.email,
        permissions: [...ctx.permissions],
        branchIds: ctx.branchIds,
      },
      business,
    });
  }),
);
