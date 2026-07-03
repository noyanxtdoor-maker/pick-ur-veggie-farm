// M9A customers seam (mock mode): customer master upsert, and read-only AR standing derived from unpaid invoices
// attributed to a customer. Server-side tenant/permission isolation + non-money attribution is proven by
// scripts/guards/customers-security.sql.
import 'fake-indexeddb/auto';
import {describe, expect, it, beforeAll} from 'vitest';
import {offlineDB} from '@/app/core/offline/db';
import {DEMO, seedMockData} from '@/app/core/mock/mock';
import {customersApi} from '@/app/features/customers/api';

describe('customers (mock mode)', () => {
  beforeAll(async () => {
    await seedMockData();
  });

  it('creates a customer with a credit limit', async () => {
    await customersApi.upsert(DEMO.companyId, null, {name: 'Aling Nena Store', contact: '0917', credit_limit: 5000});
    const list = await customersApi.fetchCustomers(DEMO.companyId);
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('Aling Nena Store');
    expect(list[0]!.credit_limit).toBe(5000);
  });

  it('rejects an empty name and a negative limit', async () => {
    await expect(customersApi.upsert(DEMO.companyId, null, {name: '  '})).rejects.toThrow(/name/i);
    await expect(customersApi.upsert(DEMO.companyId, null, {name: 'Bad', credit_limit: -10})).rejects.toThrow(/negative/i);
  });

  it('derives outstanding AR + available credit from an attributed unpaid invoice', async () => {
    const cust = (await customersApi.fetchCustomers(DEMO.companyId))[0]!;
    // seed an unpaid credit invoice for this company/branch
    const invId = 'inv-cust-1';
    await offlineDB.posInvoices.put({
      id: invId, company_id: DEMO.companyId, branch_id: DEMO.branchA, invoice_number: 900,
      lines: [], subtotal: 1200, discount: 0, delivery_fee: 0, total: 1200,
      tender_cash: 0, change_amount: 0, note: null, status: 'Unpaid', created_at: new Date().toISOString(),
    });
    // before attribution: standing shows zero outstanding
    let standing = (await customersApi.fetchStanding(DEMO.companyId)).find((s) => s.customer_id === cust.id)!;
    expect(standing.outstanding_ar).toBe(0);
    expect(standing.available_credit).toBe(5000);
    // attribute + re-check
    await customersApi.assignInvoice(DEMO.companyId, invId, cust.id);
    standing = (await customersApi.fetchStanding(DEMO.companyId)).find((s) => s.customer_id === cust.id)!;
    expect(standing.outstanding_ar).toBe(1200);
    expect(standing.available_credit).toBe(3800); // 5000 − 1200
  });

  it('reports null available credit when no limit is set', async () => {
    await customersApi.upsert(DEMO.companyId, null, {name: 'Walk-in Wholesaler', credit_limit: null});
    const s = (await customersApi.fetchStanding(DEMO.companyId)).find((x) => x.name === 'Walk-in Wholesaler')!;
    expect(s.credit_limit).toBeNull();
    expect(s.available_credit).toBeNull();
  });
});
