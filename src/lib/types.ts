export type UserRole = 'Developer' | 'Owner' | 'Co-Owner' | 'Admin' | 'Operator' | 'Employee';

export interface FeatureAccess {
  hasAccess: boolean;
  mode: 'view' | 'edit';
}

export interface User {
  username: string;
  passwordHash: string; // Plain password for simple local offline verification
  role: UserRole;
  approved: boolean;
  createdAt: string;
  customPermissions?: {
    pos?: FeatureAccess;
    inventory?: FeatureAccess;
    accounting?: FeatureAccess;
    schedules?: FeatureAccess;
    projects?: FeatureAccess;
    payroll?: FeatureAccess;
  };
}

export function hasFeatureAccess(user: User, featureId: string, requiredMode: 'view' | 'edit' = 'view'): boolean {
  // If the user has a custom set of permissions for this feature, use it:
  if (user.customPermissions && user.customPermissions[featureId as keyof typeof user.customPermissions]) {
    const perm = user.customPermissions[featureId as keyof typeof user.customPermissions]!;
    if (perm.hasAccess) {
      if (requiredMode === 'view') return true;
      return perm.mode === 'edit';
    }
    // If explicitly configured as inactive, deny
    return false;
  }

  // Fallback to role-based default permissions:
  // Developer, Owner, Co-Owner, Admin can do anything
  if (['Developer', 'Owner', 'Co-Owner', 'Admin'].includes(user.role)) {
    return true;
  }

  // Operator defaults:
  if (user.role === 'Operator') {
    // Operator has full access to POS, Inventory, Schedules, Projects, and can view Payroll. No Accounting access.
    if (featureId === 'accounting') return false;
    if (featureId === 'payroll') {
      return requiredMode === 'view'; // view only for payroll
    }
    return true; // view & edit for others
  }

  // Employee defaults:
  if (user.role === 'Employee') {
    // Employee has POS view/edit, Schedules view, Projects view, Payroll view (self only), no Accounting, no Inventory
    if (featureId === 'pos') return true;
    if (featureId === 'schedules' || featureId === 'projects') {
      return true; // can view
    }
    if (featureId === 'payroll') {
      return requiredMode === 'view';
    }
    return false; // No Inventory, No Accounting
  }

  return false;
}


export interface VegetablePrice {
  id: string; // e.g., 'p_lett'
  name: string;
  retailPerKg: number;
}

export interface SalesItem {
  name: string;
  weightKg: number | null; // null for bulk/wholesale item
  retailPerKg: number | null;
  farmPerKg: number | null;
  lineTotal: number;
  retailLine: number;
}

export interface Transaction {
  id: string;
  datetime: string;
  type: 'retail' | 'wholesale';
  items: SalesItem[];
  total: number;
  retailTotal: number;
  saved: number;
  cash: number;
  change: number;
  note: string; // e.g. delivery vendor, buyer details
  slipNo: number;
  voided: boolean;
  postedBy: string; // Username of operator who processed the sale
  status: 'paid' | 'preorder'; // preorder handles deliveries where cash entry is optional until delivery
  deliveryPaidAmount?: number; // actual amount paid by customer for delivery
  deliveryChangeAmount?: number; // change given in delivery
  deliveryFee?: number; // delivery fee added to pre-orders
  discountAmount?: number; // discount applied to pre-orders
}

export interface Expense {
  id: string;
  date: string;
  category: 'Seeds/Seedlings' | 'Substrate & Nutrients' | 'Packaging' | 'Water/Electricity' | 'Transport' | 'Equipment Purchase' | 'Miscellaneous';
  description: string;
  amount: number;
  pcs: number; // how many pieces were purchased (for consumables)
  sourceType: 'online' | 'physical';
  sourceName: string; // Lazada, Shopee, TikTok OR supplier name
  sourceWho: string; // supplier person / seller name
  equipmentType?: 'Consumables' | 'Equipment';
}

export interface Equipment {
  id: string;
  name: string;
  purchaseDate: string;
  cost: number;
  working: boolean;
  notes: string;
  lastChecklistDate: string;
  monthlyChecklist: {
    working: boolean;
    needsMaintenance: boolean;
    maintenancePerformedBy: string;
    checkedDate: string;
    notes: string;
  }[];
}

export interface Employee {
  id: string; // e.g. 'E001'
  name: string;
  position: string;
  dailyRate: number;
  dateHired: string;
  active: boolean;
}

export interface CashAdvance {
  id: string;
  date: string;
  employeeId: string;
  amount: number;
  note: string;
}

export interface Wage {
  id: string;
  employeeId: string;
  payPeriod: string; // e.g. "June 1-7"
  datePaid: string;
  daysWorked: number;
  dailyRate: number;
  gross: number;
  caDeducted: number;
  net: number;
  notes: string;
}

export interface CashEntry {
  id: string;
  date: string;
  flow: 'in' | 'out';
  category: string; // e.g., 'Owner Investment', 'Loan Payment', 'Equipment Purchase', 'Owner Drawings'
  description: string;
  amount: number;
}

export interface ScheduleEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  type: 'Meeting' | 'Planting' | 'Delivery' | 'Project';
  description: string;
  restrictedTo: UserRole[]; // list of roles that can see this (Dev/Owner see all by default)
  createdBy: string;
  projectId?: string; // linked project ID
}

export interface ProjectTask {
  id: string;
  text: string;
  completed: boolean;
  completedBy?: string;
  completedAt?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  status: 'Planning' | 'In Progress' | 'Completed' | 'On Hold';
  tasks: ProjectTask[];
  visibility: 'Public' | 'Restricted';
  managers: string[]; // usernames of managers allowed to edit
}
