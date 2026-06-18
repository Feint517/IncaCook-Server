import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { stripeConfig } from '@config/stripe.config';

import type { PrismaService } from '@infrastructure/database/prisma.service';
import type { StripeService } from '@infrastructure/stripe/stripe.service';

import { OnboardingService } from './onboarding.service';

import type { ConfigType } from '@nestjs/config';

/**
 * Unit coverage for the Stripe Connect onboarding error mapping: a raw Stripe
 * API failure (e.g. "you haven't signed up for Connect") must surface as a
 * clean 503 — NOT a bare 500 (INCACOOK_UNKNOWN) — while our own HttpExceptions
 * (NotFound) pass through untouched. Prisma + Stripe are mocked (no network).
 */
describe('OnboardingService — Stripe error mapping', () => {
  let findUnique: ReturnType<typeof vi.fn>;
  let accountsCreate: ReturnType<typeof vi.fn>;
  let accountLinksCreate: ReturnType<typeof vi.fn>;
  let driverUpdate: ReturnType<typeof vi.fn>;
  let service: OnboardingService;

  const cfg = {
    onboardingReturnUrl: 'https://app.example/return',
    onboardingRefreshUrl: 'https://app.example/refresh',
    connectAccountCountry: 'FR',
  } as unknown as ConfigType<typeof stripeConfig>;

  const driverUser = {
    id: 'driver-1',
    email: 'driver@example.com',
    role: 'DRIVER',
    sellerProfile: null,
    driverProfile: { userId: 'driver-1', stripeConnectAccountId: null as string | null },
  };

  beforeEach(() => {
    findUnique = vi.fn();
    accountsCreate = vi.fn();
    accountLinksCreate = vi.fn();
    driverUpdate = vi.fn().mockResolvedValue({});

    const prisma = {
      db: {
        user: { findUnique },
        driverProfile: { update: driverUpdate },
        sellerProfile: { update: vi.fn() },
      },
    } as unknown as PrismaService;

    const stripe = {
      client: {
        accounts: { create: accountsCreate },
        accountLinks: { create: accountLinksCreate },
      },
    } as unknown as StripeService;

    service = new OnboardingService(prisma, stripe, cfg);
  });

  it('maps "Connect not enabled" Stripe error to 503 (not a raw 500)', async () => {
    findUnique.mockResolvedValue(driverUser);
    accountsCreate.mockRejectedValue(
      Stripe.errors.StripeError.generate({
        type: 'invalid_request_error',
        message:
          "You can only create new accounts if you've signed up for Connect, which you can do at https://dashboard.stripe.com/connect.",
      } as never),
    );

    await expect(service.createAccountLink('sub-driver')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('lets our own HttpExceptions pass through (user not found → 404, not 503)', async () => {
    findUnique.mockResolvedValue(null);
    await expect(service.createAccountLink('sub-missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns the account link on success', async () => {
    findUnique.mockResolvedValue({
      ...driverUser,
      driverProfile: { userId: 'driver-1', stripeConnectAccountId: 'acct_existing' },
    });
    accountLinksCreate.mockResolvedValue({ url: 'https://connect.stripe/link', expires_at: 1234 });

    const result = await service.createAccountLink('sub-driver');

    expect(result).toEqual({ url: 'https://connect.stripe/link', expiresAt: 1234 });
    expect(accountsCreate).not.toHaveBeenCalled(); // reused existing account
  });
});
