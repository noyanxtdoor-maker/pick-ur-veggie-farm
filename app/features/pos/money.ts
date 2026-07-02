// Client money display helpers (ported from the prototype src/lib/money.ts — the workflow-logic authority).
// DISPLAY ONLY: the server (pos_record_sale) is the price authority and recomputes every amount (B2 NUMERIC).
// P2-M2E: the CHARGED price for weighed produce is the FARM price = retail × (1 − DISCOUNT); the server mirrors
// this constant. Bulk wholesale lines are cashier-negotiated flat prices (the only client-priced path, mock parity).

export const DISCOUNT = 0.1; // 10% off prevailing retail (prototype src/lib/money.ts constant)

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function farmPerKg(retail: number): number {
  return round2(retail * (1 - DISCOUNT));
}

export function lineTotal(weightKg: number, pricePerKg: number): number {
  return round2(weightKg * pricePerKg);
}

export function retailLine(weightKg: number, retail: number): number {
  return round2(weightKg * retail);
}

export function formatPeso(n: number): string {
  const rounded = round2(n);
  const neg = rounded < 0;
  const abs = Math.abs(rounded).toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  return neg ? `(₱${abs})` : `₱${abs}`;
}
