# External Financial UI Inspirations

> **Authority level: INSPIRATION / REFERENCE ONLY — NOT a PickUrVeggie ERP V3 specification.**
> These are **external, third-party** financial-application UI/UX references collected for design study. They carry the **lowest authority** in the UI reference hierarchy and **do not override** Approved Screens, New UI designs, or any canonical PickUrVeggie architecture decision. The authority hierarchy established by **[ADR-001](../../28_Enterprise_Architecture_Audit/ADR_001_Architecture_Ratification.md)** and the **[Stage A Governance Precedence Model](../../28_Enterprise_Architecture_Audit/Stage_A_Governance_Reconciliation.md)** remains in full effect.

## What this folder is

A curated set of screenshots from external digital-banking / fintech mobile applications, kept as **inspiration** for studying mature financial-app UX. They are **not** PickUrVeggie screens, not mockups of PickUrVeggie features, and not approved designs.

| Folder | Source app | Screenshots |
|---|---|---|
| [`Gotyme/`](Gotyme/) | GoTyme Bank (digital bank) | 12 |
| [`MariBank/`](MariBank/) | MariBank (digital bank) | 18 |

## What they are NOT

- ❌ Not official PickUrVeggie ERP V3 UI specifications.
- ❌ Not a substitute for, and they do not override, **Approved Screens** (authoritative), **New UI** (active V3 direction), or **Old UI** (historical reference).
- ❌ Not architectural authority. They never override canonical specs in the enterprise layer (Sections 10–26) or any ADR-001 decision.
- ❌ Not a commitment to build any feature shown.

## Why they exist — best practices to study

These references exist to study proven patterns in mature financial apps:

- **Mobile banking UX** — onboarding, account overview, security/trust cues.
- **Dashboard layouts** — at-a-glance balances, KPIs, and summaries.
- **Financial visualization** — charts, spending breakdowns, trends.
- **Transaction history presentation** — lists, grouping, filters, detail views.
- **Clean navigation patterns** — bottom nav, tab structures, information hierarchy.
- **Modern mobile interactions** — gestures, micro-interactions, responsive feedback.

These are directly relevant to PickUrVeggie's POS, Accounting dashboards, financial reporting, and the mobile/offline field application (Section 25).

## How to use them (authority-respecting workflow)

Any pattern worth adopting must flow through the canonical UI pipeline — it does **not** enter the product directly from this folder:

```
External inspiration (this folder)  →  New UI exploration (14_UI_References/New_UI)
        →  review/approval  →  Approved Screens (authoritative)  →  implementation
```

Inspiration informs exploration; only **Approved Screens** are authoritative for the V3 build.

## Provenance & attribution

- These are screenshots of **third-party applications**; all product names, logos, and designs are the property of their respective owners (GoTyme Bank; MariBank).
- They are retained for **internal, non-commercial design study only**.
- Captured 2026-06-19 and manually restored into this folder.

## Relationship to the UI reference hierarchy

| UI reference | Authority for V3 |
|---|---|
| `Approved_Screens/` | **Authoritative** |
| `New_UI/` | Active direction (pending approval) |
| `Old_UI/` | Deprecated / historical (V1/V2) |
| `External_Financial_UI_Inspirations/` (this) | **Inspiration only — lowest authority; external, non-PickUrVeggie** |
