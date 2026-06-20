# PickUrVeggie ERP Development Rules

## Project Philosophy

Follow Ponytail principles:
- Prefer deleting unnecessary code.
- Use existing framework and platform capabilities first.
- Avoid unnecessary libraries, abstractions, and complexity.
- Keep solutions simple, readable, and maintainable.

However, PickUrVeggie is an agricultural ERP system where correctness and traceability are more important than reducing code size.

---

# Non-Negotiable ERP Rules

## 1. Complete Farm Traceability

Every physical movement must have a corresponding digital event.

Examples:
- Seed purchase → inventory receipt
- Seed usage → planting batch consumption
- Fertilizer application → farm activity log
- Harvest → harvest record
- Sale → sales transaction
- Spoilage, loss, or damage → inventory adjustment

Never replace historical transactions with only a current status.

---

## 2. Audit Trail Is Mandatory

Never remove or simplify:
- Creation timestamps
- Update timestamps
- User identity for critical actions
- Change history where required

The system must answer:

> Who performed this action, when, and why?

---

## 3. Inventory Is Transaction-Based

Avoid designs that only store a current quantity.

Maintain movement records for:
- Purchases
- Usage
- Transfers
- Adjustments
- Returns
- Losses

Current inventory should be calculated or reconciled from transaction history.

---

## 4. Financial Data Must Be Preserved

Never delete or overwrite financial transactions.

Corrections must be performed through:
- Reversals
- Adjustments
- Correcting entries

The financial history must remain auditable.

---

## 5. Offline-First Is a Core Requirement

Never replace proper synchronization with temporary local storage.

The system must support:
- Offline action queue
- Automatic synchronization when online
- Duplicate prevention
- Conflict handling
- Preservation of transaction order when necessary

---

## 6. Security and Validation Are Never Optional

Do not sacrifice:
- Authentication
- Authorization
- Input validation
- Server-side verification
- Data integrity checks

Shorter code is not better if it creates risk.

---

## 7. UI Must Be Farm-Worker Friendly

Design for:
- 10–12 inch landscape tablets
- Outdoor lighting and glare
- Workers wearing gloves or having wet/dirty hands
- Large touch targets (minimum 48–60px)
- Fast, low-friction workflows

---

# Decision Priority

When making implementation decisions, follow this order:

1. Business correctness
2. Data integrity and traceability
3. Security
4. Reliability and offline capability
5. Simplicity and maintainability

Never choose fewer lines of code over preserving critical ERP behavior.

The best code is not the shortest code.
The best code is the code that reliably protects farm operations.