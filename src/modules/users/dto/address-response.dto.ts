import type { Address } from '@prisma/client';

import { SavedAddressType } from '@common/enums/saved-address-type.enum';

export class AddressResponseDto {
  id!: string;
  type!: SavedAddressType | null;
  customLabel!: string | null;
  fullAddress!: string;
  city!: string;
  postalCode!: string;
  apartment!: string | null;
  floor!: string | null;
  digicode!: string | null;
  deliveryNotes!: string | null;
  // Extracted from the PostGIS point column via raw SQL. Null when no
  // coordinates have been geocoded yet.
  lat!: number | null;
  lng!: number | null;

  static from(address: Address, coords: { lat: number; lng: number } | null): AddressResponseDto {
    return {
      id: address.id,
      type: (address.type as SavedAddressType | null) ?? null,
      customLabel: address.customLabel,
      fullAddress: address.fullAddress,
      city: address.city,
      postalCode: address.postalCode,
      apartment: address.apartment,
      floor: address.floor,
      digicode: address.digicode,
      deliveryNotes: address.deliveryNotes,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
    };
  }
}
