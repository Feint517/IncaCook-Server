import {
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ulid } from 'ulid';

import { SellerCategory } from '@common/enums/seller-category.enum';
import { UserRole } from '@common/enums/user-role.enum';

import { supabaseConfig } from '@config/supabase.config';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { SupabaseAdminService } from '@infrastructure/supabase/supabase-admin.service';

import { CreateUploadUrlDto, UploadPurpose } from './dto/create-upload-url.dto';
import { UploadUrlResponseDto } from './dto/upload-url-response.dto';

import type { ConfigType } from '@nestjs/config';

/**
 * Maps each upload purpose to a config-bucket key and a role/category
 * gate. Sellers can upload to seller-facades; only sellers/drivers can
 * upload KYC docs; everyone can upload avatars; only sellers can upload
 * listing images.
 */
const PURPOSE_RULES: Record<
  UploadPurpose,
  {
    bucketConfigKey: 'avatars' | 'kyc' | 'listings' | 'sellerFacades';
    allowedRoles: ReadonlySet<UserRole>;
    blockedFor?: (categoryIfSeller: SellerCategory | null) => string | null;
  }
> = {
  [UploadPurpose.Avatar]: {
    bucketConfigKey: 'avatars',
    allowedRoles: new Set([UserRole.Buyer, UserRole.Seller, UserRole.Driver]),
  },
  [UploadPurpose.KycDocument]: {
    bucketConfigKey: 'kyc',
    allowedRoles: new Set([UserRole.Seller, UserRole.Driver]),
    blockedFor: (cat) =>
      cat === SellerCategory.FaitMaison ? 'Fait-maison sellers do not submit KYC' : null,
  },
  [UploadPurpose.ListingImage]: {
    bucketConfigKey: 'listings',
    allowedRoles: new Set([UserRole.Seller]),
  },
  [UploadPurpose.SellerFacade]: {
    bucketConfigKey: 'sellerFacades',
    allowedRoles: new Set([UserRole.Seller]),
    blockedFor: (cat) =>
      cat === SellerCategory.FaitMaison
        ? 'Fait-maison sellers do not have a storefront facade'
        : null,
  },
};

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseAdminService,
    @Inject(supabaseConfig.KEY)
    private readonly cfg: ConfigType<typeof supabaseConfig>,
  ) {}

  /**
   * Issues a signed upload URL for a single file. The client PUTs the
   * file body directly to the URL — the backend never sees the bytes.
   * Path is generated server-side as `<supabaseId>/<ulid>` so the client
   * can't choose a path that collides with another user's namespace.
   */
  async createUploadUrl(
    supabaseId: string,
    dto: CreateUploadUrlDto,
  ): Promise<UploadUrlResponseDto> {
    const rule = PURPOSE_RULES[dto.purpose];

    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: {
        role: true,
        sellerProfile: { select: { category: true } },
      },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }
    if (!rule.allowedRoles.has(user.role as UserRole)) {
      throw new ForbiddenException(
        `Upload purpose ${dto.purpose} is not allowed for role ${user.role}`,
      );
    }
    if (rule.blockedFor) {
      const reason = rule.blockedFor(
        (user.sellerProfile?.category as SellerCategory | null) ?? null,
      );
      if (reason) {
        throw new ForbiddenException(reason);
      }
    }

    const bucket = this.bucketName(rule.bucketConfigKey);
    // Path is bucket-relative. The final stored key is `<bucket>/<path>`.
    const objectPath = `${supabaseId}/${ulid()}`;

    const { data, error } = await this.supabase.client.storage
      .from(bucket)
      .createSignedUploadUrl(objectPath);
    if (error || !data) {
      throw new InternalServerErrorException(
        `Failed to create signed upload URL: ${error?.message ?? 'unknown error'}`,
      );
    }

    // Match the existing *Url column convention: bucket-prefixed path that
    // the seller / kyc services already understand.
    const path = `${bucket}/${objectPath}`;

    return { uploadUrl: data.signedUrl, token: data.token, path, bucket };
  }

  private bucketName(key: 'avatars' | 'kyc' | 'listings' | 'sellerFacades'): string {
    if (key === 'sellerFacades') {
      // `seller-facades` isn't in supabaseConfig.buckets today — hardcode the
      // bucket id. Move to env if the name ever needs to vary by environment.
      return 'seller-facades';
    }
    return this.cfg.buckets[key];
  }
}
