// Client money display helpers (ported pattern from the V2 prototype src/lib/money.ts — reference only, ODR-001).
// DISPLAY ONLY: the server (pos_record_sale) is the price authority and recomputes every amount (B2 NUMERIC).
// Note: the price book's retail_per_kg IS the charged price (M2B guard-proven). The prototype's dual
// retail/farm-discount pricing is a future price-book field (owner decision) — not faked in the UI.

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function lineTotal(weightKg: number, pricePerKg: number): number {
  return round2(weightKg * pricePerKg);
}

export function formatPeso(n: number): string {
  const rounded = round2(n);
  const neg = rounded < 0;
  const abs = Math.abs(rounded).toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  return neg ? `(₱${abs})` : `₱${abs}`;
}
