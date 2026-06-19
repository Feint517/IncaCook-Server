/**
 * `GET /v1/sellers/me/orders/:orderId/pickup-qr` — the seller→driver pickup
 * proof. The seller renders [qrData] as a QR; the assigned driver scans it to
 * confirm pickup. [pickupToken] is the raw secret (also embedded in qrData).
 */
export class PickupQrResponseDto {
  orderId!: string;
  deliveryId!: string;
  pickupToken!: string;
  qrData!: string;
}
