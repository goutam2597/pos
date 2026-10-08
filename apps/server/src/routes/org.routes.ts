import { Router } from 'express';
import { z } from 'zod';
import { prisma, transaction } from '../db/client.js';
import { handler, ok, created, parseBody, parseQuery, listQuery, page, translateDbError } from '../lib/http.js';
import { context } from '../lib/context.js';
import { AppError, notFound } from '../lib/errors.js';
import { crudRoute } from '../lib/crud.js';
import { assertPasswordAcceptable, hashPassword } from '../modules/auth/service.js';
import { allPermissions, ROLE_PERMISSIONS, SYSTEM_ROLES, isPermission } from '@monopos/shared';
import { EN } from '../lib/default-translations.js';

/**
 * Organisation, access control, settings, audit and localisation.
 */

export const orgRouter = Router();

// ---------------------------------------------------------------------------
// Branches / warehouses / registers
// ---------------------------------------------------------------------------

orgRouter.use(
  '/branches',
  crudRoute({
    path: '/',
    permissions: { create: 'branch:create', update: 'branch:update', delete: 'branch:manage' },
    entityType: 'Branch',
    modelName: 'Branch',
    model: () => prisma.branch,
    createSchema: z.object({
      code: z.string().trim().min(1).max(20),
      name: z.string().trim().min(1).max(150),
      isMain: z.boolean().default(false),
      isActive: z.boolean().default(true),
      address: z.string().max(300).nullish(),
      city: z.string().max(100).nullish(),
      state: z.string().max(100).nullish(),
      postalCode: z.string().max(20).nullish(),
      country: z.string().max(60).nullish(),
      phone: z.string().max(40).nullish(),
      email: z.string().email().nullish(),
      taxNumber: z.string().max(60).nullish(),
      trackBranchAccounting: z.boolean().default(false),
    }),
    updateSchema: z.object({
      name: z.string().trim().min(1).max(150).optional(),
      isActive: z.boolean().optional(),
      address: z.string().max(300).nullish(),
      city: z.string().max(100).nullish(),
      phone: z.string().max(40).nullish(),
      email: z.string().email().nullish(),
      taxNumber: z.string().max(60).nullish(),
      trackBranchAccounting: z.boolean().optional(),
    }),
    select: {
      id: true, code: true, name: true, isMain: true, isActive: true,
      address: true, city: true, country: true, phone: true, email: true, taxNumber: true,
    },
    searchFields: ['name', 'code', 'city'],
    orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
    // Branches are not scoped by the user's branch list — an owner must be able
    // to see and create every branch, including ones they cannot transact in.
    scopeById: () => ({}),
    mapCreate: (input) => input as Record<string, unknown>,
    mapUpdate: (input) => input as Record<string, unknown>,
    beforeDelete: async (record) => {
      const [registers, sales] = await Promise.all([
        prisma.register.count({ where: { branchId: record.id } }),
        prisma.sale.count({ where: { branchId: record.id } }),
      ]);
      if (registers > 0 || sales > 0) {
        throw new AppError('ACCOUNT_IN_USE', 'This branch has registers or sales. Deactivate it instead.');
      }
    },
  }),
);

orgRouter.use(
  '/warehouses',
  crudRoute({
    path: '/',
    permissions: { create: 'warehouse:create', update: 'warehouse:update', delete: 'warehouse:manage' },
    entityType: 'Warehouse',
    modelName: 'Warehouse',
    model: () => prisma.warehouse,
    createSchema: z.object({
      code: z.string().trim().min(1).max(20),
      name: z.string().trim().min(1).max(150),
      branchId: z.string().nullish(),
      type: z.enum(['STORE', 'WAREHOUSE', 'SUPPLY', 'QUARANTINE', 'DAMAGED']).default('STORE'),
      isActive: z.boolean().default(true),
      isRetail: z.boolean().default(false),
      address: z.string().max(300).nullish(),
      city: z.string().max(100).nullish(),
      country: z.string().max(60).nullish(),
      phone: z.string().max(40).nullish(),
    }),
    updateSchema: z.object({
      name: z.string().trim().min(1).max(150).optional(),
      branchId: z.string().nullish(),
      type: z.enum(['STORE', 'WAREHOUSE', 'SUPPLY', 'QUARANTINE', 'DAMAGED']).optional(),
      isActive: z.boolean().optional(),
      isRetail: z.boolean().optional(),
      address: z.string().max(300).nullish(),
      phone: z.string().max(40).nullish(),
    }),
    select: { id: true, code: true, name: true, type: true, isActive: true, isRetail: true, branchId: true, address: true },
    searchFields: ['name', 'code'],
    orderBy: { name: 'asc' },
    mapCreate: (input) => input as Record<string, unknown>,
    mapUpdate: (input) => input as Record<string, unknown>,
    beforeDelete: async (record) => {
      const stock = await prisma.stockLevel.aggregate({
        where: { warehouseId: record.id },
        _sum: { qtyOnHand: true },
      });
      if ((stock._sum.qtyOnHand ?? 0) !== 0) {
        throw new AppError('ACCOUNT_IN_USE', 'This warehouse still holds stock. Transfer it out first.');
      }
    },
  }),
);

orgRouter.get(
  '/registers',
  handler(async (req, res) => {
    const ctx = context();
    const where: Record<string, unknown> = { businessId: ctx.businessId };
    if (ctx.branchIds.length > 0) where.branchId = { in: ctx.branchIds };
    if (req.query.branchId) where.branchId = String(req.query.branchId);

    const registers = await prisma.register.findMany({
      where,
      orderBy: [{ branchId: 'asc' }, { code: 'asc' }],
      select: {
        id: true, code: true, name: true, status: true, isActive: true,
        openingFloat: true, lastSeenAt: true, branchId: true,
        branch: { select: { id: true, name: true, code: true } },
        _count: { select: { sales: true, shifts: true } },
      },
    });
    ok(res, registers);
  }),
);

orgRouter.patch(
  '/registers/:id',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(
      z.object({
        name: z.string().trim().min(1).max(100).optional(),
        status: z.enum(['OPEN', 'CLOSED', 'SUSPENDED']).optional(),
        isActive: z.boolean().optional(),
      }),
      req,
    );
    const id = String(req.params.id);
    const result = await prisma.register.updateMany({ where: { id, businessId: ctx.businessId }, data: input });
    if (result.count === 0) throw notFound('Register', id);
    ok(res, await prisma.register.findUniqueOrThrow({ where: { id } }));
  }),
);

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

orgRouter.use(
  '/employees',
  crudRoute({
    path: '/',
    permissions: { create: 'employee:create', update: 'employee:update', delete: 'employee:update' },
    entityType: 'Employee',
    modelName: 'Employee',
    model: () => prisma.employee,
    createSchema: z.object({
      code: z.string().trim().max(20).nullish(),
      firstName: z.string().trim().min(1).max(100),
      lastName: z.string().trim().max(100).nullish(),
      email: z.string().email().nullish(),
      phone: z.string().max(40).nullish(),
      jobTitle: z.string().max(100).nullish(),
      department: z.string().max(100).nullish(),
      hireDate: z.coerce.date().nullish(),
      salary: z.number().int().nonnegative().nullish(),
      isActive: z.boolean().default(true),
    }),
    updateSchema: z.object({
      firstName: z.string().trim().min(1).max(100).optional(),
      lastName: z.string().trim().max(100).nullish(),
      email: z.string().email().nullish(),
      phone: z.string().max(40).nullish(),
      jobTitle: z.string().max(100).nullish(),
      department: z.string().max(100).nullish(),
      isActive: z.boolean().optional(),
    }),
    select: {
      id: true, code: true, firstName: true, lastName: true, email: true, phone: true,
      jobTitle: true, department: true, hireDate: true, salary: true, isActive: true,
    },
    searchFields: ['firstName', 'lastName', 'email', 'code'],
    orderBy: { firstName: 'asc' },
    mapCreate: (input) => input as Record<string, unknown>,
    mapUpdate: (input) => input as Record<string, unknown>,
  }),
);

// ---------------------------------------------------------------------------
// Users & roles
// ---------------------------------------------------------------------------

orgRouter.get(
  '/users',
  handler(async (req, res) => {
    const ctx = context();
    const { skip, take } = listQuery(req);
    const q = req.query as Record<string, string | undefined>;

    const where: Record<string, unknown> = { businessId: ctx.businessId };
    if (q.search) {
      where.OR = [
        { email: { contains: q.search, mode: 'insensitive' } },
        { firstName: { contains: q.search, mode: 'insensitive' } },
        { lastName: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    if (q.isActive) where.isActive = q.isActive === 'true';

    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { firstName: 'asc' },
        skip,
        take,
        select: {
          id: true, email: true, firstName: true, lastName: true, locale: true,
          isActive: true, isSuperAdmin: true, branchIds: true, lastLoginAt: true, createdAt: true,
          roles: { select: { role: { select: { id: true, name: true, slug: true, isSystem: true } } } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    // Flatten the role join for a table-friendly payload.
    page(
      res,
      rows.map((u) => ({ ...u, roles: u.roles.map((r) => r.role) })),
      total,
      Number(q.page) || 1,
      Number(q.pageSize) || 25,
    );
  }),
);

const userCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(10, 'Password must be at least 10 characters'),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).nullish(),
  phone: z.string().max(40).nullish(),
  locale: z.string().max(10).default('en'),
  roleIds: z.array(z.string()).default([]),
  /** Empty array = every branch. */
  branchIds: z.array(z.string()).default([]),
});

orgRouter.post(
  '/users',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(userCreateSchema, req);
    assertPasswordAcceptable(input.password);

    try {
      const user = await transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            businessId: ctx.businessId,
            email: input.email,
            passwordHash: await hashPassword(input.password),
            firstName: input.firstName,
            lastName: input.lastName ?? null,
            phone: input.phone ?? null,
            locale: input.locale,
            branchIds: input.branchIds,
            roles: { create: input.roleIds.map((roleId) => ({ roleId })) },
          },
          select: { id: true, email: true, firstName: true, lastName: true },
        });
        return created;
      });
      created(res, user);
    } catch (error) {
      translateDbError(error);
    }
  }),
);

orgRouter.patch(
  '/users/:id',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(
      z.object({
        firstName: z.string().trim().min(1).max(100).optional(),
        lastName: z.string().trim().max(100).nullish(),
        phone: z.string().max(40).nullish(),
        locale: z.string().max(10).optional(),
        isActive: z.boolean().optional(),
        roleIds: z.array(z.string()).optional(),
        branchIds: z.array(z.string()).optional(),
      }),
      req,
    );
    const id = String(req.params.id);

    const target = await prisma.user.findFirst({ where: { id, businessId: ctx.businessId }, select: { id: true } });
    if (!target) throw notFound('User', id);

    await transaction(async (tx) => {
      if (input.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        if (input.roleIds.length > 0) {
          await tx.userRole.createMany({ data: input.roleIds.map((roleId) => ({ userId: id, roleId })) });
        }
      }
      await tx.user.update({
        where: { id },
        data: {
          ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
          ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.locale !== undefined ? { locale: input.locale } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.branchIds !== undefined ? { branchIds: input.branchIds } : {}),
        },
      });

      // A permission change must not wait for the access token to expire.
      if (input.roleIds || input.isActive !== undefined) {
        await tx.authSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    });

    ok(res, await prisma.user.findUniqueOrThrow({ where: { id } }));
  }),
);

orgRouter.post(
  '/users/:id/reset-password',
  handler(async (req, res) => {
    const ctx = context();
    const { password } = parseBody(z.object({ password: z.string().min(10) }), req);
    assertPasswordAcceptable(password);
    const id = String(req.params.id);

    await transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), tokenVersion: { increment: 1 } },
      });
      await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          businessId: ctx.businessId, userId: ctx.userId, action: 'UPDATE', entityType: 'User',
          entityId: id, changes: { passwordReset: true },
        },
      });
    });

    ok(res, { message: 'Password reset. Existing sessions were signed out.' });
  }),
);

orgRouter.get(
  '/roles',
  handler(async (req, res) => {
    const ctx = context();
    const roles = await prisma.role.findMany({
      where: { businessId: ctx.businessId },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: {
        id: true, name: true, slug: true, description: true, isSystem: true,
        permissions: { select: { permission: { select: { resource: true, action: true } } } },
        _count: { select: { users: true } },
      },
    });

    ok(
      res,
      roles.map((role) => ({
        id: role.id,
        name: role.name,
        slug: role.slug,
        description: role.description,
        isSystem: role.isSystem,
        userCount: role._count.users,
        permissions: role.permissions.map((p) => `${p.permission.resource}:${p.permission.action}`),
      })),
    );
  }),
);

const roleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().max(200).nullish(),
  permissions: z.array(z.string()).default([]),
});

orgRouter.post(
  '/roles',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(roleSchema, req);

    const unknown = input.permissions.filter((p) => !isPermission(p));
    if (unknown.length > 0) throw new AppError('VALIDATION_FAILED', `Unknown permissions: ${unknown.join(', ')}`);

    const role = await prisma.role.create({
      data: {
        businessId: ctx.businessId,
        name: input.name,
        slug: input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        description: input.description ?? null,
        isSystem: false,
      },
    });

    await applyRolePermissions(role.id, input.permissions);
    created(res, { ...role, permissions: input.permissions });
  }),
);

orgRouter.patch(
  '/roles/:id',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(roleSchema.partial(), req);
    const id = String(req.params.id);

    const role = await prisma.role.findFirst({
      where: { id, businessId: ctx.businessId },
      select: { id: true, isSystem: true },
    });
    if (!role) throw notFound('Role', id);

    // The two permissions that gate the whole permission system itself cannot
    // be edited through the role editor, or a user could grant themselves the
    // ability to grant themselves anything.
    if (role.isSystem && input.permissions) {
      const protectedOnes = new Set(['setting:manage', 'role:manage']);
      const attempted = input.permissions.filter((p) => protectedOnes.has(p));
      if (attempted.length > 0) {
        throw new AppError('FORBIDDEN', 'System permissions cannot be granted through a system role');
      }
    }

    if (input.permissions) await applyRolePermissions(id, input.permissions);

    ok(res, await prisma.role.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
    }));
  }),
);

orgRouter.delete(
  '/roles/:id',
  handler(async (req, res) => {
    const ctx = context();
    const id = String(req.params.id);
    const role = await prisma.role.findFirst({
      where: { id, businessId: ctx.businessId },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw notFound('Role', id);
    if (role.isSystem) throw new AppError('FORBIDDEN', 'System roles cannot be deleted');
    if (role._count.users > 0) {
      throw new AppError('ACCOUNT_IN_USE', `${role._count.users} user(s) still have this role`);
    }

    await prisma.role.delete({ where: { id } });
    res.status(204).end();
  }),
);

async function applyRolePermissions(roleId: string, permissions: string[]): Promise<void> {
  const valid = permissions.filter((p) => isPermission(p));
  // Prisma has no compound-unique `in`, so match each pair with an OR list.
  const records = await prisma.permission.findMany({
    where: {
      OR: valid.map((p) => ({ resource: p.split(':')[0]!, action: p.split(':')[1]! })),
    },
    select: { id: true, resource: true, action: true },
  });

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId } }),
    prisma.rolePermission.createMany({ data: records.map((r) => ({ roleId, permissionId: r.id })) }),
  ]);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

orgRouter.get(
  '/settings',
  handler(async (req, res) => {
    const ctx = context();
    const rows = await prisma.setting.findMany({
      where: { businessId: ctx.businessId, scopeKey: req.query.branchId ? `BRANCH:${req.query.branchId}` : 'GLOBAL' },
      select: { key: true, value: true, label: true, group: true, type: true, scopeKey: true },
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
    });
    ok(res, Object.fromEntries(rows.map((r) => [r.key, r.value])));
  }),
);

orgRouter.put(
  '/settings',
  handler(async (req, res) => {
    const ctx = context();
    const body = parseBody(
      z.object({
        settings: z.record(z.string(), z.unknown()),
        branchId: z.string().nullish(),
      }),
      req,
    );

    const scopeKey = body.branchId ? `BRANCH:${body.branchId}` : 'GLOBAL';

    for (const [key, value] of Object.entries(body.settings)) {
      await prisma.setting.upsert({
        where: { businessId_scopeKey_key: { businessId: ctx.businessId, scopeKey, key } },
        create: { businessId: ctx.businessId, branchId: body.branchId ?? null, scopeKey, key, value: value as never },
        update: { value: value as never },
      });
    }

    ok(res, { updated: Object.keys(body.settings).length });
  }),
);

/** Patch business-level profile fields (name, currency, timezone, ...). */
orgRouter.patch(
  '/business',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(
      z.object({
        name: z.string().trim().min(1).max(150).optional(),
        legalName: z.string().max(200).nullish(),
        email: z.string().email().nullish(),
        phone: z.string().max(40).nullish(),
        address: z.string().max(300).nullish(),
        city: z.string().max(100).nullish(),
        country: z.string().max(60).optional(),
        timezone: z.string().max(60).optional(),
        currency: z.string().max(3).optional(),
        priceIncludesTax: z.boolean().optional(),
        defaultLanguage: z.string().max(10).optional(),
      }),
      req,
    );

    ok(res, await prisma.business.update({ where: { id: ctx.businessId }, data: input }));
  }),
);

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

orgRouter.get(
  '/audit',
  handler(async (req, res) => {
    const ctx = context();
    const { skip, take } = listQuery(req);
    const q = req.query as Record<string, string | undefined>;

    const where: Record<string, unknown> = { businessId: ctx.businessId };
    if (q.action) where.action = q.action;
    if (q.entityType) where.entityType = q.entityType;
    if (q.entityId) where.entityId = q.entityId;
    if (q.userId) where.userId = q.userId;
    if (q.deviceId) where.deviceId = q.deviceId;
    if (q.from || q.to) {
      where.createdAt = {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(q.to) } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true, action: true, entityType: true, entityId: true, entityCode: true,
          before: true, after: true, changes: true, ip: true, deviceId: true, createdAt: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    page(res, rows, total, Number(q.page) || 1, Number(q.pageSize) || 50);
  }),
);

// ---------------------------------------------------------------------------
// Localisation — admin-managed languages and translations
// ---------------------------------------------------------------------------

export const i18nRouter = Router();

i18nRouter.get(
  '/languages',
  handler(async (req, res) => {
    const ctx = context();
    const languages = await prisma.language.findMany({
      where: { businessId: ctx.businessId },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true, code: true, name: true, nativeName: true, direction: true,
        isActive: true, isDefault: true, locale: true, sortOrder: true,
        _count: { select: { translations: true } },
      },
    });
    ok(res, languages);
  }),
);

const languageSchema = z.object({
  code: z.string().trim().min(2).max(16),
  name: z.string().trim().min(1).max(80),
  nativeName: z.string().trim().min(1).max(80),
  direction: z.enum(['ltr', 'rtl']).default('ltr'),
  locale: z.string().max(20).nullish(),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

i18nRouter.post(
  '/languages',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(languageSchema, req);

    if (input.isDefault) {
      await prisma.language.updateMany({
        where: { businessId: ctx.businessId, isDefault: true },
        data: { isDefault: false },
      });
    }

    try {
      const language = await prisma.language.create({
        data: { ...input, locale: input.locale ?? null, businessId: ctx.businessId },
      });
      // Seed this language with the English strings so the editor opens with a
      // complete, editable baseline rather than a blank page.
      await prisma.translation.createMany({
        data: Object.entries(EN).map(([key, value]) => ({
          languageId: language.id,
          key,
          value: value as string,
          isCustom: false,
        })),
      });
      created(res, language);
    } catch (error) {
      translateDbError(error);
    }
  }),
);

i18nRouter.patch(
  '/languages/:code',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(languageSchema.omit({ code: true }).partial(), req);
    const code = String(req.params.code);

    if (input.isDefault) {
      await prisma.language.updateMany({
        where: { businessId: ctx.businessId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const result = await prisma.language.updateMany({
      where: { businessId: ctx.businessId, code },
      data: input,
    });
    if (result.count === 0) throw notFound('Language', code);

    ok(res, await prisma.language.findFirstOrThrow({ where: { businessId: ctx.businessId, code } }));
  }),
);

i18nRouter.delete(
  '/languages/:code',
  handler(async (req, res) => {
    const ctx = context();
    const code = String(req.params.code);
    const language = await prisma.language.findFirst({
      where: { businessId: ctx.businessId, code },
      select: { id: true, isDefault: true },
    });
    if (!language) throw notFound('Language', code);
    if (language.isDefault) throw new AppError('FORBIDDEN', 'The default language cannot be deleted');

    await prisma.language.delete({ where: { id: language.id } });
    res.status(204).end();
  }),
);

i18nRouter.get(
  '/:code/translations',
  handler(async (req, res) => {
    const ctx = context();
    const code = String(req.params.code);
    const language = await prisma.language.findFirst({
      where: { businessId: ctx.businessId, code },
      select: { id: true, code: true, name: true, nativeName: true, direction: true },
    });
    if (!language) throw notFound('Language', code);

    const rows = await prisma.translation.findMany({
      where: { languageId: language.id },
      select: { key: true, value: true, isCustom: true, updatedAt: true },
      orderBy: { key: 'asc' },
    });

    // Always ship the English baseline so the editor can show which keys exist
    // but are untranslated for this language.
    const table = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const missing = Object.keys(EN).filter((key) => !table[key]);

    ok(res, { language, translations: table, english: EN, missing });
  }),
);

i18nRouter.put(
  '/:code/translations',
  handler(async (req, res) => {
    const ctx = context();
    const code = String(req.params.code);
    const { translations } = parseBody(z.object({ translations: z.record(z.string(), z.string()) }), req);

    const language = await prisma.language.findFirst({
      where: { businessId: ctx.businessId, code },
      select: { id: true },
    });
    if (!language) throw notFound('Language', code);

    const entries = Object.entries(translations);
    for (const [key, value] of entries) {
      await prisma.translation.upsert({
        where: { languageId_key: { languageId: language.id, key } },
        create: { languageId: language.id, key, value, isCustom: value !== EN[key], updatedById: ctx.userId },
        update: { value, isCustom: value !== EN[key], updatedById: ctx.userId },
      });
    }

    ok(res, { updated: entries.length });
  }),
);

/** The shipped key catalogue, so the editor can add strings for new features. */
i18nRouter.get('/catalogue', handler(async (_req, res) => ok(res, EN)));
