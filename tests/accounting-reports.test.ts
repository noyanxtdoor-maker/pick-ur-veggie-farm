// M4C management reports — pure composition over GL reads. Verifies expense/revenue breakdown math + shares,
// and that the equity roll-forward ties to the balance sheet's own total_equity.
import {describe, expect, it} from 'vitest';
import {accountBreakdown, equityRollforward} from '@/app/features/accounting/reports';
import type {BalanceSheet, TrialBalanceRow} from '@/app/types/db';

const tb = (code: string, name: string, account_type: TrialBalanceRow['account_type'], d: number, c: number): TrialBalanceRow => ({
  account_code: code, account_name: name, account_type, normal_balance: account_type === 'Revenue' ? 'credit' : 'debit', total_debit: d, total_credit: c,
});

describe('accountBreakdown', () => {
  const rows: TrialBalanceRow[] = [
    tb('5000', 'COGS', 'Expense', 3000, 0),
    tb('6000', 'Wages', 'Expense', 1000, 0),
    tb('6100', 'Operating Expenses', 'Expense', 1000, 200), // net 800
    tb('4000', 'Sales', 'Revenue', 0, 8000),
    tb('1000', 'Cash', 'Asset', 5000, 0), // ignored
  ];

  it('nets expenses on the debit side, sorts desc, and computes shares', () => {
    const b = accountBreakdown(rows, 'Expense');
    expect(b.total).toBe(4800);
    expect(b.lines.map((l) => l.name)).toEqual(['COGS', 'Wages', 'Operating Expenses']);
    expect(b.lines[0]!.amount).toBe(3000);
    expect(b.lines[2]!.amount).toBe(800);
    // shares sum to ~100
    expect(Math.round(b.lines.reduce((s, l) => s + l.pct, 0))).toBe(100);
  });

  it('nets revenue on the credit side and excludes non-matching types + zero lines', () => {
    const b = accountBreakdown(rows, 'Revenue');
    expect(b.total).toBe(8000);
    expect(b.lines).toHaveLength(1);
    expect(b.lines[0]!.name).toBe('Sales');
    expect(b.lines[0]!.pct).toBe(100);
  });
});

describe('equityRollforward', () => {
  const bs: BalanceSheet = {
    cash: 0, accounts_receivable: 0, raw_materials: 0, finished_goods: 0, equipment: 0, employee_advances: 0, total_assets: 0,
    loans_payable: 0, total_liabilities: 0,
    owner_investment: 10000, owners_drawings: 1500, retained_earnings: 4000, total_equity: 12500,
  };

  it('rolls forward investment + retained − drawings and ties to total_equity', () => {
    const r = equityRollforward(bs);
    expect(r.ties).toBe(true);
    expect(r.lines.find((l) => l.kind === 'total')!.amount).toBe(12500);
  });

  it('flags a non-tying balance sheet (guards against upstream drift)', () => {
    expect(equityRollforward({...bs, total_equity: 9999}).ties).toBe(false);
  });
});
