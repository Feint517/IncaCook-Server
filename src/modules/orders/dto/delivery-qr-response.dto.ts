/**
 * `GET /v1/orders/:orderId/delivery-qr` — the buyer→driver reception proof.
 * The buyer renders [qrData] as a QR; the assigned driver scans it to confirm
 * delivery. [deliveryToken] is the raw secret (also embedded in qrData).
 */
export class DeliveryQrResponseDto {
  orderId!: string;
  deliveryId!: string;
  deliveryToken!: string;
  qrData!: string;
}
