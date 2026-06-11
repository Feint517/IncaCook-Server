import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { UserRole } from '@common/enums/user-role.enum';
import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { StripeService } from '@infrastructure/stripe/stripe.service';

import { CreateCatalogOrderDto } from './dto/catalog-order.dto';

/**
 * Seller-side catalog: browse active products and purchase them. Every
 * route here is guarded by `@Roles(SELLER)`, so buyers / drivers / the
 * public never see the catalog. Purchases charge the seller's card via a
 * Stripe PaymentIntent (confirmed in-app, like buyer checkout).
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  /** Active, non-deleted products — the seller browse list. */
  async listProducts() {
    return this.prisma.db.catalogProduct.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getProduct(id: string) {
    const product = await this.prisma.db.catalogProduct.findUnique({
      where: { id },
    });
    if (!product || product.deletedAt || !product.isActive) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  /**
   * Creates a PENDING order + Stripe PaymentIntent and returns the client
   * secret for in-app card confirmation. Snapshots name/price per item.
   */
  async createOrder(supabaseId: string, dto: CreateCatalogOrderDto) {
    const seller = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true, email: true, role: true, stripeCustomerId: true },
    });
    if (!seller) throw new NotFoundException('User profile not found');
    if (seller.role !== UserRole.Seller) {
      throw new ForbiddenException('Only sellers can purchase from the catalog');
    }

    // Collapse duplicate productIds, then load + validate.
    const wanted = new Map<string, number>();
    for (const item of dto.items) {
      wanted.set(item.productId, (wanted.get(item.productId) ?? 0) + item.quantity);
    }
    const products = await this.prisma.db.catalogProduct.findMany({
      where: { id: { in: [...wanted.keys()] }, deletedAt: null, isActive: true },
    });
    if (products.length !== wanted.size) {
      throw new BadRequestException('One or more products are unavailable');
    }

    const currencies = new Set(products.map((p) => p.currency));
    if (currencies.size > 1) {
      throw new BadRequestException('Cannot mix products of different currencies');
    }
    const currency = products[0].currency;

    const lineItems = products.map((p) => {
      const quantity = wanted.get(p.id)!;
      return {
        id: generateUlid(),
        productId: p.id,
        nameSnapshot: p.name,
        unitPriceCents: p.priceCents,
        quantity,
        lineTotalCents: p.priceCents * quantity,
      };
    });
    const totalCents = lineItems.reduce((sum, it) => sum + it.lineTotalCents, 0);

    const order = await this.prisma.db.catalogOrder.create({
      data: {
        id: generateUlid(),
        sellerId: seller.id,
        status: 'PENDING',
        totalCents,
        currency,
        items: { create: lineItems },
      },
    });

    const customerId = await this.ensureCustomer(seller.id, seller.email, seller.stripeCustomerId);

    const pi = await this.stripe.client.paymentIntents.create({
      amount: totalCents,
      currency,
      customer: customerId,
      automatic_payment_methods: { enabled: true },
      metadata: { catalogOrderId: order.id, type: 'catalog_order' },
    });

    await this.prisma.db.catalogOrder.update({
      where: { id: order.id },
      data: { stripePaymentIntentId: pi.id },
    });

    return {
      orderId: order.id,
      clientSecret: pi.client_secret,
      totalCents,
      currency,
    };
  }

  /**
   * Server-verified confirm: re-reads the PaymentIntent and flips the order
   * to PAID when Stripe says it succeeded. The webhook is the backstop.
   */
  async confirmPayment(supabaseId: string, orderId: string) {
    const seller = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!seller) throw new NotFoundException('User profile not found');

    const order = await this.prisma.db.catalogOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order || order.sellerId !== seller.id) {
      throw new NotFoundException('Order not found');
    }
    if (order.status === 'PAID') return order; // idempotent
    if (!order.stripePaymentIntentId) {
      throw new BadRequestException('Order has no payment');
    }

    const pi = await this.stripe.client.paymentIntents.retrieve(order.stripePaymentIntentId);
    if (pi.status !== 'succeeded') {
      throw new BadRequestException('Payment not completed');
    }

    return this.prisma.db.catalogOrder.update({
      where: { id: order.id },
      data: { status: 'PAID', paidAt: new Date() },
      include: { items: true },
    });
  }

  /** The seller's own catalog purchases, newest first. */
  async listMyOrders(supabaseId: string) {
    const seller = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!seller) throw new NotFoundException('User profile not found');
    return this.prisma.db.catalogOrder.findMany({
      where: { sellerId: seller.id },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Reuses/validates the seller's Stripe customer (guards stale cus_dev_…). */
  private async ensureCustomer(
    userId: string,
    email: string,
    existing: string | null,
  ): Promise<string> {
    if (existing && !existing.startsWith('cus_dev_')) {
      try {
        const found = await this.stripe.client.customers.retrieve(existing);
        if (!(found as { deleted?: boolean }).deleted) return existing;
      } catch {
        // fall through and create
      }
    }
    const customer = await this.stripe.client.customers.create({
      email,
      metadata: { userId },
    });
    await this.prisma.db.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customer.id },
    });
    return customer.id;
  }
}
