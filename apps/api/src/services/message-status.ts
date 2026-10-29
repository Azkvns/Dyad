export function messageStatus(
  mine: boolean,
  seq: number,
  peer: { lastDeliveredSeq: number; lastReadSeq: number } | null,
): "sent" | "delivered" | "read" | null {
  if (!mine) return null;
  if (peer && peer.lastReadSeq >= seq) return "read";
  if (peer && peer.lastDeliveredSeq >= seq) return "delivered";
  return "sent";
}
