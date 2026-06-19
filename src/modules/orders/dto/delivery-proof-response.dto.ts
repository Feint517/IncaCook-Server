/**
 * `GET /v1/orders/:orderId/delivery-proof` — delivery completion proof for the
 * order's buyer or seller. When [deliveredAsAbsent] is true the order was left
 * at the door with [photoUrl] (a public storage path) + GPS + [takenAt]; for a
 * normal QR delivery the absent-proof fields are null.
 */
export class DeliveryProofResponseDto {
  orderId!: string;
  deliveryId!: string;
  deliveredAsAbsent!: boolean;
  status!: string;
  deliveredAt!: string | null;
  photoUrl!: string | null;
  lat!: number | null;
  lng!: number | null;
  takenAt!: string | null;
  note!: string | null;
  contactAttemptedAt!: string | null;
}
