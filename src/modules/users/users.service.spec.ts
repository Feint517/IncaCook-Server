import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorCodes } from '@common/constants/error-codes.constants';

import type { PrismaService } from '@infrastructure/database/prisma.service';
import type { SupabaseAdminService } from '@infrastructure/supabase/supabase-admin.service';

import { UsersService, type UserAggregate } from './users.service';

import type { CreateUserDto } from './dto/create-user.dto';

/**
 * Unit coverage for the OAuth-sync surface: `syncFromJwt` (profile lookup +
 * email resolution + duplicate-email guard) and `createFromJwt`'s email
 * fallback (jwt → user_metadata → identity_data → verified) so Facebook
 * identities without a top-level email claim still resolve one. Prisma and the
 * Supabase admin client are mocked so these run without a DB / network.
 */
describe('UsersService — OAuth email resolution + sync', () => {
  let findUnique: ReturnType<typeof vi.fn>;
  let findFirst: ReturnType<typeof vi.fn>;
  let getUserById: ReturnType<typeof vi.fn>;
  let service: UsersService;

  // Minimal Supabase auth-user shape pickEmail inspects.
  const authUser = (overrides: Record<string, unknown> = {}) => ({
    email: null,
    email_confirmed_at: null,
    phone: null,
    phone_confirmed_at: null,
    user_metadata: {},
    identities: [] as Array<{ identity_data?: Record<string, unknown> }>,
    ...overrides,
  });

  beforeEach(() => {
    findUnique = vi.fn();
    findFirst = vi.fn();
    getUserById = vi.fn().mockResolvedValue({ data: { user: authUser() } });
    const prisma = { db: { user: { findUnique, findFirst } } } as unknown as PrismaService;
    const admin = {
      client: { auth: { admin: { getUserById } } },
    } as unknown as SupabaseAdminService;
    service = new UsersService(prisma, admin);
  });

  const identity = { supabaseId: 'sb-new', email: 'taken@example.com' };

  describe('syncFromJwt', () => {
    it('resolves the jwt email and reports no profile / no email needed', async () => {
      findUnique.mockResolvedValue(null);
      findFirst.mockResolvedValue(null);

      const result = await service.syncFromJwt(identity);

      expect(result).toEqual({
        hasProfile: false,
        aggregate: null,
        email: 'taken@example.com',
        needsEmail: false,
      });
    });

    it('falls back to user_metadata.email when the jwt has none', async () => {
      findUnique.mockResolvedValue(null);
      findFirst.mockResolvedValue(null);
      getUserById.mockResolvedValue({
        data: { user: authUser({ user_metadata: { email: 'meta@example.com' } }) },
      });

      const result = await service.syncFromJwt({ supabaseId: 'sb-x' });

      expect(result.needsEmail).toBe(false);
      expect(result.email).toBe('meta@example.com');
    });

    it('needsEmail=true when no email exists anywhere (Facebook no-email)', async () => {
      findUnique.mockResolvedValue(null);
      getUserById.mockResolvedValue({ data: { user: authUser() } });

      const result = await service.syncFromJwt({ supabaseId: 'sb-x' });

      expect(result).toEqual({
        hasProfile: false,
        aggregate: null,
        email: null,
        needsEmail: true,
      });
      expect(findFirst).not.toHaveBeenCalled(); // no email → no collision check
    });

    it('returns hasProfile=true with the aggregate for a returning user', async () => {
      findUnique.mockResolvedValue({ id: 'u1' });
      const aggregate = { user: { id: 'u1', email: 'a@b.com' } } as unknown as UserAggregate;
      vi.spyOn(service, 'findBySupabaseId').mockResolvedValue(aggregate);

      const result = await service.syncFromJwt({ supabaseId: 'sb-existing', email: 'a@b.com' });

      expect(result).toEqual({
        hasProfile: true,
        aggregate,
        email: 'a@b.com',
        needsEmail: false,
      });
    });

    it('throws Conflict when a DIFFERENT Supabase identity already owns the email', async () => {
      findUnique.mockResolvedValue(null);
      findFirst.mockResolvedValue({ id: 'other-user' });

      await expect(service.syncFromJwt(identity)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('createFromJwt email resolution', () => {
    it('throws EMAIL_REQUIRED when no email can be resolved', async () => {
      findUnique.mockResolvedValue(null);
      getUserById.mockResolvedValue({ data: { user: authUser() } });

      await expect(
        service.createFromJwt({ supabaseId: 'sb-x' }, {
          role: 'BUYER',
        } as unknown as CreateUserDto),
      ).rejects.toMatchObject({ code: ErrorCodes.EmailRequired });
    });

    it('throws Conflict before creating when the email is owned by another identity', async () => {
      findUnique.mockResolvedValue(null);
      findFirst.mockResolvedValue({ id: 'other-user' });

      await expect(
        service.createFromJwt(identity, { role: 'BUYER' } as unknown as CreateUserDto),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(findFirst).toHaveBeenCalledWith({
        where: { email: identity.email, NOT: { supabaseId: identity.supabaseId } },
        select: { id: true },
      });
    });
  });
});
