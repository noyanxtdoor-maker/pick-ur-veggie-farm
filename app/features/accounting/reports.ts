// Accounting management reports (P2-M4C) — pure compositions over the EXISTING GL read-functions
// (trial_balance / balance_sheet). No new SQL, no new money-writing path: these just re-shape numbers the
// audited ledger already produced. Deferred in the M4 spec §2 (expense-category P&L, retained-earnings roll-forward),
// now delivered as read-only views. All arithmetic uses round2 to stay penny-honest with the source figures.
import {round2} from '../pos/money';
import type {BalanceSheet, TrialBalanceRow} from '../../types/db';

export interface BreakdownLine {
  code: string;
  name: string;
  amount: number; // net for the account's normal side (expense = debit−credit; revenue = credit−debit)
  pct: number; // share of the section total, 0–100
}
export interface Breakdown {
  lines: BreakdownLine[];
  total: number;
}

/** Group trial-balance rows of one type into a sorted breakdown with per-line % of total. */
export function accountBreakdown(rows: TrialBalanceRow[], type: 'Expense' | 'Revenue'): Breakdown {
  const net = (r: TrialBalanceRow) => (type === 'Expense' ? r.total_debit - r.total_credit : r.total_credit - r.total_debit);
  const lines = rows
    .filter((r) => r.account_type === type)
    .map((r) => ({code: r.account_code, name: r.account_name, amount: round2(net(r))}))
    .filter((l) => l.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
  const total = round2(lines.reduce((s, l) => s + l.amount, 0));
  return {
    total,
    lines: lines.map((l) => ({...l, pct: total > 0 ? round2((l.amount / total) * 100) : 0})),
  };
}

export interface EquityLine {
  label: string;
  amount: number;
  kind: 'add' | 'less' | 'total';
}

/** Statement of Changes in Equity — roll-forward from the balance sheet's own equity figures.
 *  Owner Investment + Retained Earnings (accumulated net income) − Owner's Drawings = Total Equity. */
export function equityRollforward(bs: BalanceSheet): {lines: EquityLine[]; ties: boolean} {
  const computed = round2(bs.owner_investment + bs.retained_earnings - bs.owners_drawings);
  return {
    ties: computed === round2(bs.total_equity),
    lines: [
      {label: 'Owner Investment (contributed capital)', amount: round2(bs.owner_investment), kind: 'add'},
      {label: 'Add: Retained Earnings (accumulated net income)', amount: round2(bs.retained_earnings), kind: 'add'},
      {label: "Less: Owner's Drawings", amount: round2(bs.owners_drawings), kind: 'less'},
      {label: 'Total Owner’s Equity', amount: round2(bs.total_equity), kind: 'total'},
    ],
  };
}
