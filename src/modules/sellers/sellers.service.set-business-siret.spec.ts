import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserRole } from '@common/enums/user-role.enum';

import type { PrismaService } from '@infrastructure/database/prisma.service';

import { SellersService } from './sellers.service';

/** A real 14-digit, Luhn-valid SIRET (732 829 320 00074). */
const VALID_SIRET = '73282932000074';

/**
 * SIRET is required ONLY for Sauve Ton Panier (RESTAURANT); it is optional for
 * Traiteur and never collected for Le Bon Fait Maison (no business profile).
 * Prisma is mocked.
 */
describe('SellersService.setBusiness — SIRET rule by category', () => {
  let userFindUnique: ReturnType<typeof vi.fn>;
  let profileFindUnique: ReturnType<typeof vi.fn>;
  let upsert: ReturnType<typeof vi.fn>;
  let transaction: ReturnType<typeof vi.fn>;
  let service: SellersService;

  function setCategory(category: string) {
    profileFindUnique.mockResolvedValue({ category });
  }

  beforeEach(() => {
    userFindUnique = vi.fn().mockResolvedValue({
      id: 'seller-1',
      role: UserRole.Seller,
      sellerProfile: { userId: 'seller-1' },
    });
    profileFindUnique = vi.fn().mockResolvedValue({ category: 'TRAITEUR' });
    upsert = vi.fn(async ({ create }: { create: Record<string, unknown> }) => ({
      userId: 'seller-1',
      ...create,
    }));
    transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        sellerBusiness: { upsert },
        sellerOpeningHours: {
          deleteMany: vi.fn().mockResolvedValue({}),
          createMany: vi.fn().mockResolvedValue({}),
          findMany: vi.fn().mockResolvedValue([]),
        },
      }),
    );

    const prisma = {
      $transaction: transaction,
      db: {
        user: { findUnique: userFindUnique },
        sellerProfile: { findUnique: profileFindUnique },
      },
    } as unknown as PrismaService;

    service = new SellersService(prisma, {} as never);
  });

  const dto = (siret?: string) => ({ businessName: 'Chez Test', siret, openingHours: [] }) as never;

  it('Traiteur without SIRET → accepted (stored null)', async () => {
    setCategory('TRAITEUR');
    await service.upsertBusiness('sup-1', dto(undefined));
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ siret: null }) }),
    );
  });

  it('Traiteur with empty-string SIRET → accepted (stored null)', async () => {
    setCategory('TRAITEUR');
    await service.upsertBusiness('sup-1', dto(''));
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ siret: null }) }),
    );
  });

  it('Le Bon Fait Maison → no business profile (400), SIRET never needed', async () => {
    setCategory('FAIT_MAISON');
    await expect(service.upsertBusiness('sup-1', dto(undefined))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it('Sauve Ton Panier without SIRET → refused with the submit message', async () => {
    setCategory('RESTAURANT');
    await expect(service.upsertBusiness('sup-1', dto(undefined))).rejects.toThrow(
      'Veuillez renseigner votre SIRET pour continuer.',
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it('Sauve Ton Panier with a valid SIRET → accepted', async () => {
    setCategory('RESTAURANT');
    await service.upsertBusiness('sup-1', dto(VALID_SIRET));
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ siret: VALID_SIRET }) }),
    );
  });

  it('rejects a non-empty but Luhn-invalid SIRET for any category', async () => {
    setCategory('TRAITEUR');
    await expect(service.upsertBusiness('sup-1', dto('12345678901234'))).rejects.toThrow('Luhn');
    expect(upsert).not.toHaveBeenCalled();
  });
});
