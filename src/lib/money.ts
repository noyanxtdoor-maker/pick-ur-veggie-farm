export const DISCOUNT = 0.10; // 10% off prevailing retail

/**
 * Rounds half-up to 2 decimal places.
 * E.g., 55.485 -> 55.49
 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function farmPerKg(retail: number): number {
  return round2(retail * (1 - DISCOUNT));
}

export function lineTotal(weightKg: number, retail: number): number {
  return round2(weightKg * farmPerKg(retail));
}

export function retailLine(weightKg: number, retail: number): number {
  return round2(weightKg * retail);
}

export function change(cash: number, saleTotalAmt: number): number {
  return round2(cash - saleTotalAmt);
}

export function formatPeso(n: number): string {
  const rounded = round2(n);
  const isNegative = rounded < 0;
  const absFormatted = Math.abs(rounded).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return isNegative ? `(₱${absFormatted})` : `₱${absFormatted}`;
}

export function gross(daysWorked: number, dailyRate: number): number {
  return round2(daysWorked * dailyRate);
}

export function net(grossAmt: number, caDeducted: number): number {
  return round2(grossAmt - caDeducted);
}

export function netSales(retailSales: number, wholesaleSales: number): number {
  return round2(retailSales + wholesaleSales);
}

export function grossProfit(netSalesAmt: number, totalCOGS: number): number {
  return round2(netSalesAmt - totalCOGS);
}

export function netIncome(grossProfitAmt: number, totalOpEx: number): number {
  return round2(grossProfitAmt - totalOpEx);
}

export function netMargin(netIncomeAmt: number, netSalesAmt: number): number {
  if (netSalesAmt === 0) return 0;
  return netIncomeAmt / netSalesAmt;
}
