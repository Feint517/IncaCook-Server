import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '@infrastructure/database/prisma.service';

import { AuthService } from './auth.service';

/**
 * Public, no-session social-email OTP fallback (Facebook returned no email and
 * no Supabase session was created). Reuses Supabase's email OTP (request +
 * verify); Supabase owns code generation / SMTP / expiry / rate-limit. We add
 * an account-safety conflict guard and never trust the email before verify.
 * Supabase clients + Prisma are mocked.
 */
describe('AuthService — social email OTP fallback', () => {
  let signInWithOtp: ReturnType<typeof vi.fn>;
  let verifyOtp: ReturnType<typeof vi.fn>;
  let userFindFirst: ReturnType<typeof vi.fn>;
  let userUpdate: ReturnType<typeof vi.fn>;
  let service: AuthService;

  function session() {
    return {
      access_token: 'at',
      refresh_token: 'rt',
      expires_at: 123,
      user: { id: 'sb-1', email: 'u@example.com', email_confirmed_at: '2026-01-01' },
    };
  }

  beforeEach(() => {
    signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    verifyOtp = vi.fn().mockResolvedValue({ data: { session: session() }, error: null });
    userFindFirst = vi.fn().mockResolvedValue(null);
    userUpdate = vi.fn().mockResolvedValue({});

    const anon = { client: { auth: { signInWithOtp, verifyOtp } } } as never;
    const admin = {} as never;
    const prisma = {
      db: { user: { findFirst: userFindFirst, update: userUpdate } },
    } as unknown as PrismaService;
    const prelude = {} as never;

    service = new AuthService(anon, admin, prisma, prelude);
  });

  // --- request ------------------------------------------------------------

  it('sends an email OTP (creating the user) for a fresh email', async () => {
    await service.requestSocialEmailOtp('facebook', 'u@example.com');
    expect(signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'u@example.com',
        options: expect.objectContaining({ shouldCreateUser: true }),
      }),
    );
  });

  it('rejects an email already used by another account (409, no OTP sent)', async () => {
    userFindFirst.mockResolvedValue({ id: 'existing' });
    await expect(service.requestSocialEmailOtp('facebook', 'u@example.com')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('rejects an unsupported provider before sending', async () => {
    await expect(service.requestSocialEmailOtp('google', 'u@example.com')).rejects.toThrow(
      'Unsupported social provider',
    );
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  // --- verify -------------------------------------------------------------

  it('verifies the OTP and returns a fresh session', async () => {
    const res = await service.verifySocialEmailOtp('facebook', 'u@example.com', '123456');
    expect(verifyOtp).toHaveBeenCalledWith({
      email: 'u@example.com',
      token: '123456',
      type: 'email',
    });
    expect(res.accessToken).toBe('at');
    expect(res.user.email).toBe('u@example.com');
    // Mirrors emailVerified onto the User row when present.
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { emailVerified: true } }),
    );
  });

  it('rejects a wrong/expired/reused code with a clean 401', async () => {
    verifyOtp.mockResolvedValue({ data: { session: null }, error: { message: 'expired' } });
    await expect(
      service.verifySocialEmailOtp('facebook', 'u@example.com', '000000'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('still returns a session when the User row does not exist yet (P2025)', async () => {
    userUpdate.mockRejectedValue({ code: 'P2025' });
    const res = await service.verifySocialEmailOtp('facebook', 'u@example.com', '123456');
    expect(res.accessToken).toBe('at');
  });
});
