import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReportReason, ReportStatus, SellerCategory } from '@prisma/client';

import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { CreateReportDto } from './dto/create-report.dto';
import { ListReportsQueryDto } from './dto/list-reports.query.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';

import type { Report } from '@prisma/client';

const TARGET_LISTING = 'LISTING';
const TARGET_SELLER = 'SELLER';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Buyer/user files a moderation report. */
  async create(
    supabaseId: string,
    dto: CreateReportDto,
  ): Promise<{ id: string; status: ReportStatus }> {
    const reporter = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!reporter) throw new NotFoundException('User profile not found');

    // Resolve the polymorphic target.
    let targetType: string;
    let targetId: string;
    if (dto.listingId) {
      targetType = TARGET_LISTING;
      targetId = dto.listingId;
    } else if (dto.sellerId) {
      targetType = TARGET_SELLER;
      targetId = dto.sellerId;
    } else {
      throw new BadRequestException('Un listingId ou sellerId est requis.');
    }

    // "Non fait maison" only applies to FAIT_MAISON listings.
    if (dto.type === ReportReason.NON_FAIT_MAISON) {
      if (!dto.listingId) {
        throw new BadRequestException('« Non fait maison » nécessite un plat (listingId).');
      }
      const listing = await this.prisma.db.listing.findUnique({
        where: { id: dto.listingId },
        select: { category: true },
      });
      if (!listing) throw new NotFoundException('Plat introuvable.');
      if (listing.category !== SellerCategory.FAIT_MAISON) {
        throw new BadRequestException(
          "« Non fait maison » ne s'applique qu'aux plats Le Bon Fait Maison.",
        );
      }
    } else if (dto.listingId) {
      // Any other type targeting a listing: just make sure it exists.
      const exists = await this.prisma.db.listing.findUnique({
        where: { id: dto.listingId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Plat introuvable.');
    }

    // Duplicate-spam guard: same reporter + target + type while still PENDING.
    const dup = await this.prisma.db.report.findFirst({
      where: {
        reporterId: reporter.id,
        targetId,
        reason: dto.type,
        status: ReportStatus.PENDING,
      },
      select: { id: true },
    });
    if (dup) {
      throw new ConflictException('Vous avez déjà signalé cet élément.');
    }

    const report = await this.prisma.db.report.create({
      data: {
        id: generateUlid(),
        reporterId: reporter.id,
        targetType,
        targetId,
        reason: dto.type,
        description: dto.reason ?? null,
        status: ReportStatus.PENDING,
      },
      select: { id: true, status: true },
    });
    return report;
  }

  /** Admin: paginated reports (newest first), optionally filtered. */
  async list(query: ListReportsQueryDto): Promise<{
    items: EnrichedReport[];
    limit: number;
    offset: number;
    hasMore: boolean;
  }> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const rows = await this.prisma.db.report.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { reason: query.type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      skip: offset,
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items: await this.enrich(items), limit, offset, hasMore };
  }

  /** Admin: resolve or reject a report. */
  async updateStatus(
    id: string,
    dto: UpdateReportStatusDto,
    reviewerSupabaseId: string,
  ): Promise<{ id: string; status: ReportStatus }> {
    if (dto.status !== ReportStatus.RESOLVED && dto.status !== ReportStatus.REJECTED) {
      throw new BadRequestException('status doit être RESOLVED ou REJECTED.');
    }
    const existing = await this.prisma.db.report.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Signalement introuvable.');

    const reviewer = await this.prisma.db.user.findUnique({
      where: { supabaseId: reviewerSupabaseId },
      select: { id: true },
    });

    const updated = await this.prisma.db.report.update({
      where: { id },
      data: {
        status: dto.status,
        adminNote: dto.adminNote ?? null,
        reviewedBy: reviewer?.id ?? null,
      },
      select: { id: true, status: true },
    });
    return updated;
  }

  /** Batched enrichment of reporter + listing + seller for the admin list. */
  private async enrich(reports: Report[]): Promise<EnrichedReport[]> {
    const reporterIds = [...new Set(reports.map((r) => r.reporterId))];
    const listingIds = [
      ...new Set(reports.filter((r) => r.targetType === TARGET_LISTING).map((r) => r.targetId)),
    ];

    const reporters = reporterIds.length
      ? await this.prisma.db.user.findMany({
          where: { id: { in: reporterIds } },
          select: { id: true, email: true, firstName: true, lastName: true },
        })
      : [];
    const reporterMap = new Map(reporters.map((u) => [u.id, u]));

    const listings = listingIds.length
      ? await this.prisma.db.listing.findMany({
          where: { id: { in: listingIds } },
          select: { id: true, name: true, sellerId: true, category: true },
        })
      : [];
    const listingMap = new Map(listings.map((l) => [l.id, l]));

    const sellerUserIds = [
      ...new Set([
        ...reports.filter((r) => r.targetType === TARGET_SELLER).map((r) => r.targetId),
        ...listings.map((l) => l.sellerId),
      ]),
    ];
    const sellers = sellerUserIds.length
      ? await this.prisma.db.user.findMany({
          where: { id: { in: sellerUserIds } },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            sellerProfile: { select: { displayName: true, category: true } },
          },
        })
      : [];
    const sellerMap = new Map(sellers.map((u) => [u.id, u]));

    return reports.map((r) => {
      const reporter = reporterMap.get(r.reporterId);
      const listing = r.targetType === TARGET_LISTING ? listingMap.get(r.targetId) : undefined;
      const sellerUserId = r.targetType === TARGET_SELLER ? r.targetId : listing?.sellerId;
      const seller = sellerUserId ? sellerMap.get(sellerUserId) : undefined;
      return {
        id: r.id,
        type: r.reason,
        status: r.status,
        description: r.description,
        targetType: r.targetType,
        targetId: r.targetId,
        adminNote: r.adminNote,
        createdAt: r.createdAt,
        reporter: reporter
          ? {
              id: reporter.id,
              email: reporter.email,
              name: `${reporter.firstName} ${reporter.lastName}`.trim(),
            }
          : null,
        listing: listing
          ? { id: listing.id, name: listing.name, category: listing.category }
          : null,
        seller: seller
          ? {
              id: seller.id,
              email: seller.email,
              name:
                seller.sellerProfile?.displayName ||
                `${seller.firstName} ${seller.lastName}`.trim(),
            }
          : null,
      };
    });
  }
}

export interface EnrichedReport {
  id: string;
  type: ReportReason;
  status: ReportStatus;
  description: string | null;
  targetType: string;
  targetId: string;
  adminNote: string | null;
  createdAt: Date;
  reporter: { id: string; email: string; name: string } | null;
  listing: { id: string; name: string; category: SellerCategory } | null;
  seller: { id: string; email: string; name: string } | null;
}
