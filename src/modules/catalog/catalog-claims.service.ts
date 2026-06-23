import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { StripeService } from '@infrastructure/stripe/stripe.service';

import { NotificationsService } from '@modules/notifications/notifications.service';

import {
  CatalogClaimActionDto,
  CatalogClaimRefundDto,
  CreateCatalogClaimDto,
} from './dto/catalog-claim.dto';

import type { CatalogClaim } from '@prisma/client';

/** After-sales (SAV) claim window — sellers can report a catalog issue for 14 days. */
const CLAIM_WINDOW_DAYS = 14;
const CLAIM_WINDOW_MS = CLAIM_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Open-ish statuses that block a second claim of the same type. */
const OPEN_CLAIM_STATUSES = ['OPEN', 'ADMIN_REVIEW', 'REPLACEMENT_REQUESTED'];

/**
 * Kitchen catalog after-sales service. Sellers open claims (never-received /
 * defective / wrong item) within 14 days of purchase; admins handle them
 * manually (refund / replacement / reject / resolve). The partner is
 * responsible, but the platform may advance the refund first via Stripe.
 */
@Injectable()
export class CatalogClaimsService {
  private readonly logger = new Logger(CatalogClaimsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------
  // Seller
  // ---------------------------------------------------------------------

  /** Opens a claim on the seller's own catalog order, within the 14-day window. */
  async createClaim(
    supabaseId: string,
    orderId: string,
    dto: CreateCatalogClaimDto,
  ): Promise<CatalogClaim> {
    const seller = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!seller) throw new NotFoundException('User profile not found');

    const order = await this.prisma.db.catalogOrder.findUnique({
      where: { id: orderId },
      select: { id: true, sellerId: true, status: true, paidAt: true, createdAt: true },
    });
    if (!order) throw new NotFoundException('Commande catalogue introuvable');
    if (order.sellerId !== seller.id) {
      throw new ForbiddenException('Cette commande catalogue ne vous appartient pas');
    }
    // Only a successfully paid order is eligible (the only "purchased" state).
    if (order.status !== 'PAID') {
      throw new BadRequestException('Commande catalogue non éligible à une réclamation');
    }
    // 14-day window from payment (fall back to creation).
    const start = order.paidAt ?? order.createdAt;
    if (Date.now() - start.getTime() > CLAIM_WINDOW_MS) {
      throw new BadRequestException('La fenêtre de réclamation de 14 jours est dépassée');
    }
    // One open claim per (order, type).
    const existing = await this.prisma.db.catalogClaim.findFirst({
      where: { catalogOrderId: orderId, type: dto.type, status: { in: OPEN_CLAIM_STATUSES } },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('Une réclamation est déjà ouverte pour cette commande');
    }

    const claim = await this.prisma.db.catalogClaim.create({
      data: {
        id: generateUlid(),
        catalogOrderId: orderId,
        sellerId: seller.id,
        type: dto.type,
        status: 'OPEN',
        description: dto.description,
        photoUrls: dto.photoUrls ?? [],
      },
    });
    this.logger.log(`[CatalogSAV] claim created orderId=${orderId} type=${dto.type}`);

    // Confirm to the seller; admins are notified via the log (no push target).
    await this.safeNotify(seller.id, {
      title: 'Réclamation enregistrée',
      body: 'Votre réclamation SAV a bien été transmise à notre équipe.',
      data: { type: 'catalog_claim', claimId: claim.id, status: 'OPEN' },
    });
    return claim;
  }

  /** The seller's own claims (newest first) — drives status badges in-app. */
  async listMyClaims(supabaseId: string): Promise<CatalogClaim[]> {
    const seller = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!seller) throw new NotFoundException('User profile not found');
    return this.prisma.db.catalogClaim.findMany({
      where: { sellerId: seller.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------

  /** Admin: filtered list of catalog claims. */
  async adminList(filters: {
    status?: string;
    type?: string;
    search?: string;
  }): Promise<CatalogClaim[]> {
    const where: Prisma.CatalogClaimWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.type) where.type = filters.type;
    const search = filters.search?.trim();
    if (search) {
      where.OR = [{ id: search }, { catalogOrderId: search }, { sellerId: search }];
    }
    return this.prisma.db.catalogClaim.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Admin: one claim enriched with its catalog order (items) + seller. */
  async adminGet(id: string): Promise<{
    claim: CatalogClaim;
    order: unknown | null;
    seller: { id: string; name: string; email: string } | null;
  }> {
    const claim = await this.getClaimOrThrow(id);
    const [order, seller] = await Promise.all([
      this.prisma.db.catalogOrder.findUnique({
        where: { id: claim.catalogOrderId },
        include: { items: true },
      }),
      this.prisma.db.user.findUnique({
        where: { id: claim.sellerId },
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
    ]);
    return {
      claim,
      order,
      seller: seller
        ? {
            id: seller.id,
            name: `${seller.firstName} ${seller.lastName}`.trim(),
            email: seller.email,
          }
        : null,
    };
  }

  /**
   * Admin refund: refunds the catalog order's Stripe payment (idempotent) and
   * marks the claim REFUNDED. Avoids double refunds via the claim/order
   * `stripeRefundId` + a Stripe idempotency key.
   */
  async adminRefund(
    id: string,
    adminId: string,
    dto: CatalogClaimRefundDto,
  ): Promise<CatalogClaim> {
    const claim = await this.getClaimOrThrow(id);
    // Idempotent: already refunded → return as-is (no second refund).
    if (claim.status === 'REFUNDED' || claim.stripeRefundId) return claim;

    const order = await this.prisma.db.catalogOrder.findUnique({
      where: { id: claim.catalogOrderId },
      select: { id: true, status: true, totalCents: true, stripePaymentIntentId: true },
    });
    if (!order) throw new NotFoundException('Commande catalogue introuvable');
    if (order.status === 'REFUNDED') {
      throw new BadRequestException('Cette commande a déjà été remboursée');
    }

    const amountCents = dto.refundAmountCents ?? order.totalCents;

    // Catalog purchases are always Stripe-backed; the no-PI branch is defensive.
    if (!order.stripePaymentIntentId) {
      this.logger.warn(
        `[CatalogSAV] refund pending — no Stripe payment intent claimId=${id} (TODO: manual refund)`,
      );
      return this.prisma.db.catalogClaim.update({
        where: { id },
        data: {
          status: 'ADMIN_REVIEW',
          refundAmountCents: amountCents,
          adminNotes: this.appendNote(claim.adminNotes, dto.notes, 'REFUND_PENDING (manuel)'),
        },
      });
    }

    const refund = await this.stripe.client.refunds.create(
      { payment_intent: order.stripePaymentIntentId, amount: amountCents },
      { idempotencyKey: `catalog_refund_${claim.id}` },
    );

    await this.prisma.db.catalogOrder.update({
      where: { id: order.id },
      data: { status: 'REFUNDED', stripeRefundId: refund.id },
    });
    const updated = await this.prisma.db.catalogClaim.update({
      where: { id },
      data: {
        status: 'REFUNDED',
        refundAmountCents: amountCents,
        stripeRefundId: refund.id,
        adminNotes: dto.notes ?? claim.adminNotes,
        resolvedAt: new Date(),
      },
    });
    this.logger.log(`[CatalogSAV] refund approved claimId=${id} by=${adminId}`);
    await this.notifyDecision(claim.sellerId, claim, 'Réclamation remboursée', 'REFUNDED');
    return updated;
  }

  /** Admin: request a replacement from the partner — marks REPLACEMENT_REQUESTED. */
  async adminRequestReplacement(
    id: string,
    adminId: string,
    dto: CatalogClaimActionDto,
  ): Promise<CatalogClaim> {
    const claim = await this.getClaimOrThrow(id);
    const updated = await this.prisma.db.catalogClaim.update({
      where: { id },
      data: {
        status: 'REPLACEMENT_REQUESTED',
        replacementNotes: dto.replacementNotes ?? dto.notes ?? claim.replacementNotes,
        adminNotes: dto.notes ?? claim.adminNotes,
      },
    });
    this.logger.log(`[CatalogSAV] replacement requested claimId=${id} by=${adminId}`);
    await this.notifyDecision(
      claim.sellerId,
      claim,
      'Remplacement demandé',
      'REPLACEMENT_REQUESTED',
    );
    return updated;
  }

  /** Admin: reject the claim — marks REJECTED. */
  async adminReject(
    id: string,
    adminId: string,
    dto: CatalogClaimActionDto,
  ): Promise<CatalogClaim> {
    const claim = await this.getClaimOrThrow(id);
    const updated = await this.prisma.db.catalogClaim.update({
      where: { id },
      data: {
        status: 'REJECTED',
        adminNotes: dto.notes ?? claim.adminNotes,
        resolvedAt: new Date(),
      },
    });
    this.logger.log(`[CatalogSAV] rejected claimId=${id} by=${adminId}`);
    await this.notifyDecision(claim.sellerId, claim, 'Réclamation rejetée', 'REJECTED');
    return updated;
  }

  /** Admin: close the claim — marks RESOLVED. */
  async adminResolve(
    id: string,
    adminId: string,
    dto: CatalogClaimActionDto,
  ): Promise<CatalogClaim> {
    const claim = await this.getClaimOrThrow(id);
    const updated = await this.prisma.db.catalogClaim.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        adminNotes: dto.notes ?? claim.adminNotes,
        resolvedAt: new Date(),
      },
    });
    this.logger.log(`[CatalogSAV] resolved claimId=${id} by=${adminId}`);
    await this.notifyDecision(claim.sellerId, claim, 'Réclamation résolue', 'RESOLVED');
    return updated;
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  private async getClaimOrThrow(id: string): Promise<CatalogClaim> {
    const claim = await this.prisma.db.catalogClaim.findUnique({ where: { id } });
    if (!claim) throw new NotFoundException('Réclamation introuvable');
    return claim;
  }

  private appendNote(existing: string | null, note: string | undefined, tag: string): string {
    return [existing, note, tag].filter(Boolean).join(' · ');
  }

  /** Best-effort seller notification of an admin decision. */
  private async notifyDecision(
    sellerId: string,
    claim: CatalogClaim,
    title: string,
    status: string,
  ): Promise<void> {
    await this.safeNotify(sellerId, {
      title,
      body: 'Votre réclamation SAV catalogue a été mise à jour.',
      data: { type: 'catalog_claim', claimId: claim.id, status },
    });
  }

  private async safeNotify(
    userId: string,
    notification: { title: string; body: string; data?: Record<string, string> },
  ): Promise<void> {
    try {
      await this.notifications.sendToUsers([userId], notification);
    } catch {
      // best-effort — never block the claim flow on a push failure
    }
  }
}
