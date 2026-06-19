# Package 21: Human Resources & Payroll Architecture

## Purpose

This package defines the complete Human Resource Management and Payroll Engine of PickUrVeggie ERP V3.

The HR system is not only a salary calculator. It is a complete employee lifecycle management system integrated with operations, attendance, payroll, permissions, and accounting.

The system supports both:
- Company-created employee accounts.
- Employee self-registration with management approval.

The architecture is designed for agricultural operations where workers, operators, managers, and executives have different responsibilities and access levels.

---

## Core Principles

1. Every employee has a unique identity within the company.

2. Employee accounts and employee records are connected but not necessarily created at the same time.

3. Attendance directly affects payroll computation.

4. Payroll is a financial record only.
The ERP records salaries, deductions, and payments but does not hold or transfer actual money.

5. Employee privacy must be protected.

6. All payroll modifications require audit logs.

---

## Major Components

- Employee Master Records
- User Account Linking
- Roles & Permissions
- Attendance System
- Work Shifts
- Leave Management
- Overtime Management
- Payroll Engine
- Cash Advances
- Salary Requests
- Payroll Approvals
- Payment Records
- Performance Reviews
- Employee Training
- Documents & Contracts
- Incident Reports
- Employee Exit Process
- HR Analytics

---

## Integration With Other Modules

### Calendar

Employee schedules, shifts, and approved leave synchronize with the company operational calendar.

### Inventory

Workers responsible for inventory transactions are recorded for accountability.

### Production

Labor activities can be assigned to crop blocks for production costing.

### Accounting

Payroll expenses, liabilities, and cash disbursement records are forwarded to the accounting engine.

---

## ERP Principle

A person may leave the company, but their historical records remain permanently stored for audit, accounting, and legal purposes.