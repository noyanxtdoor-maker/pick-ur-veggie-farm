# PickUrVeggie ERP V3 — Supabase Master Database Schema

## Purpose

This package contains the complete database architecture blueprint for PickUrVeggie ERP V3.

This is the master reference that will guide future Supabase PostgreSQL database implementation.

## Core Principles

- Multi-company architecture.
- Role-based security.
- Private user workspaces.
- Complete audit trail.
- No destructive deletion.
- Offline-first synchronization.
- Every physical movement has a digital and financial record.

## Architecture Flow

Company
↓
Users & Roles
↓
Farm Locations
↓
Inventory
↓
Production
↓
Harvest
↓
Sales
↓
Calendar
↓
Accounting
↓
Reports & Analytics

## Important Rule

This document is architecture only.

Actual database migration scripts will be created later after the entire design is audited and approved.