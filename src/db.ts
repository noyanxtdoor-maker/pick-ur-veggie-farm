import Dexie, { type Table } from 'dexie';
import {
  User,
  VegetablePrice,
  Transaction,
  Expense,
  Equipment,
  Employee,
  CashAdvance,
  Wage,
  CashEntry,
  ScheduleEvent,
  Project
} from './lib/types';

class PickUrVeggieDatabase extends Dexie {
  users!: Table<User, string>;
  prices!: Table<VegetablePrice, string>;
  transactions!: Table<Transaction, string>;
  expenses!: Table<Expense, string>;
  equipment!: Table<Equipment, string>;
  employees!: Table<Employee, string>;
  cashAdvances!: Table<CashAdvance, string>;
  wages!: Table<Wage, string>;
  cashEntries!: Table<CashEntry, string>;
  scheduleEvents!: Table<ScheduleEvent, string>;
  projects!: Table<Project, string>;
  meta!: Table<{ key: string; value: any }, string>;

  constructor() {
    super('PickUrVeggieERP');
    this.version(1).stores({
      users: 'username, role, approved',
      prices: 'id, name',
      transactions: 'id, datetime, type, voided, slipNo, status, postedBy',
      expenses: 'id, date, category, sourceType, equipmentType',
      equipment: 'id, name, purchaseDate, working',
      employees: 'id, name, active',
      cashAdvances: 'id, employeeId, date',
      wages: 'id, employeeId, datePaid',
      cashEntries: 'id, date, flow, category',
      scheduleEvents: 'id, title, date, type, projectId',
      projects: 'id, name, status, visibility',
      meta: 'key',
    });
  }
}

export const db = new PickUrVeggieDatabase();

// Help string creator for seeds
const todayStr = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

export async function seedDatabase() {
  // 1. Seed default users
  const userCount = await db.users.count();
  if (userCount === 0) {
    const defaultUsers: User[] = [
      {
        username: 'dev',
        passwordHash: 'dev',
        role: 'Developer',
        approved: true,
        createdAt: new Date().toISOString(),
      },
      {
        username: 'owner',
        passwordHash: 'owner',
        role: 'Owner',
        approved: true,
        createdAt: new Date().toISOString(),
      },
      {
        username: 'admin',
        passwordHash: 'admin',
        role: 'Admin',
        approved: true,
        createdAt: new Date().toISOString(),
      },
      {
        username: 'operator',
        passwordHash: 'op',
        role: 'Operator',
        approved: true,
        createdAt: new Date().toISOString(),
      },
      {
        username: 'employee',
        passwordHash: 'emp',
        role: 'Employee',
        approved: true,
        createdAt: new Date().toISOString(),
      },
      {
        username: 'waiting_user',
        passwordHash: 'waiting',
        role: 'Employee',
        approved: false,
        createdAt: new Date().toISOString(),
      }
    ];
    await db.users.bulkAdd(defaultUsers);
  }

  // 2. Seed default crops / prices
  const priceCount = await db.prices.count();
  if (priceCount === 0) {
    const initialCrops: VegetablePrice[] = [
      { id: 'crop_lett', name: 'Lettuce', retailPerKg: 120 },
      { id: 'crop_toma', name: 'Tomato', retailPerKg: 160 },
      { id: 'crop_pech', name: 'Pechay', retailPerKg: 80 },
      { id: 'crop_beans', name: 'Baguio Beans', retailPerKg: 100 },
      { id: 'crop_carrot', name: 'Carrots', retailPerKg: 110 },
      { id: 'crop_cabb', name: 'Cabbage', retailPerKg: 90 },
      { id: 'crop_eggp', name: 'Eggplant', retailPerKg: 70 },
      { id: 'crop_kang', name: 'Kangkong', retailPerKg: 40 },
    ];
    await db.prices.bulkAdd(initialCrops);
  }

  // 3. Seed default employees
  const empCount = await db.employees.count();
  if (empCount === 0) {
    const initialEmployees: Employee[] = [
      {
        id: 'E001',
        name: 'Juan Dela Cruz',
        position: 'Farm Operator',
        dailyRate: 650,
        dateHired: '2025-01-10',
        active: true,
      },
      {
        id: 'E002',
        name: 'Maria Santos',
        position: 'Harvester',
        dailyRate: 550,
        dateHired: '2025-03-15',
        active: true,
      },
    ];
    await db.employees.bulkAdd(initialEmployees);
  }

  // 4. Seed default metadata
  const metaCount = await db.meta.count();
  if (metaCount === 0) {
    await db.meta.add({ key: 'nextSlipNo', value: 101 });
    await db.meta.add({ key: 'farmName', value: 'Pick Ur Veggie Farm' });
    await db.meta.add({ key: 'lastBackup', value: null });
    await db.meta.add({ key: 'openingCashBalance', value: '50000' });
  }

  // 5. Seed default projects
  const projectCount = await db.projects.count();
  if (projectCount === 0) {
    const defaultProjects: Project[] = [
      {
        id: 'proj_cafe',
        name: 'Building the Farm Cafe',
        description: 'Constructing a small outdoor rustic cafe to serve fresh farm-to-table salads and beverages.',
        startDate: todayStr(-15),
        endDate: todayStr(45),
        status: 'In Progress',
        visibility: 'Public',
        managers: ['owner'],
        tasks: [
          { id: 'task_1', text: 'Foundation laying and post raising', completed: true },
          { id: 'task_2', text: 'Bamboo roofing installation', completed: true },
          { id: 'task_3', text: 'Wood plumbing and sink setup', completed: false },
          { id: 'task_4', text: 'Counter carpentry & layout', completed: false },
          { id: 'task_5', text: 'Local health permits clearance', completed: false },
        ]
      },
      {
        id: 'proj_tunnel',
        name: 'Finishing Tomatoes Tunnel Slot',
        description: 'Set up greenhouse poly-tunnel Slot 4 dedicated strictly to organic heirloom tomato breeds.',
        startDate: todayStr(-5),
        endDate: todayStr(10),
        status: 'In Progress',
        visibility: 'Public',
        managers: ['owner', 'admin'],
        tasks: [
          { id: 'task_10', text: 'Assemble steel arches', completed: true },
          { id: 'task_11', text: 'Dig soil slots & prepare organic manure bed', completed: true },
          { id: 'task_12', text: 'Drape & secure UV greenhouse film', completed: false },
          { id: 'task_13', text: 'Setup drip irrigation pipes', completed: false },
          { id: 'task_14', text: 'Transplant nursery seedlings', completed: false },
        ]
      }
    ];
    await db.projects.bulkAdd(defaultProjects);
  }

  // 6. Seed schedule events & Cash Inflows/Outflows
  const scheduleCount = await db.scheduleEvents.count();
  if (scheduleCount === 0) {
    const defaultEvents: ScheduleEvent[] = [
      {
        id: 'ev_1',
        title: 'Cafe Construction Phase 2',
        date: todayStr(2),
        endDate: todayStr(5),
        type: 'Project',
        description: 'Carpentry crew building the serving tables & customer benches.',
        restrictedTo: ['Developer', 'Owner', 'Co-Owner', 'Admin', 'Operator', 'Employee'],
        createdBy: 'owner',
        projectId: 'proj_cafe'
      },
      {
        id: 'ev_2',
        title: 'Tomato Seedling Transplanting',
        date: todayStr(8),
        type: 'Planting',
        description: 'Move tomato seedlings from potting nursery to newly prepared Slot 4 tunnels.',
        restrictedTo: ['Developer', 'Owner', 'Co-Owner', 'Admin', 'Operator', 'Employee'],
        createdBy: 'owner',
        projectId: 'proj_tunnel'
      },
      {
        id: 'ev_3',
        title: 'Investor Progress Meeting',
        date: todayStr(0),
        type: 'Meeting',
        description: 'Discuss Q2 farm outputs, expanding Pechay harvest and Farm Cafe feasibility.',
        restrictedTo: ['Developer', 'Owner', 'Co-Owner'],
        createdBy: 'owner'
      }
    ];
    await db.scheduleEvents.bulkAdd(defaultEvents);

    // Seed default Cash Movements correctly following the CashEntry schema!
    const defaultCash: CashEntry[] = [
      {
        id: 'cf_1',
        date: todayStr(-30),
        flow: 'in',
        category: 'Owner Investment',
        description: 'Harvest launch fund from owner personal savings',
        amount: 50000
      },
      {
        id: 'cf_2',
        date: todayStr(-18),
        flow: 'in',
        category: 'Loan Received',
        description: 'Local coop agri micro-loan program backing',
        amount: 20000
      },
      {
        id: 'cf_3',
        date: todayStr(-12),
        flow: 'out',
        category: 'Equipment Purchase',
        description: 'Submersible water sprinkler pump and metal sockets',
        amount: 12000
      },
      {
        id: 'cf_4',
        date: todayStr(-5),
        flow: 'out',
        category: "Owner's Drawings",
        description: 'Personal draws for household offset',
        amount: 5000
      }
    ];
    await db.cashEntries.bulkAdd(defaultCash);

    // Seed some initial materials expenses to populate Inventory consumables
    const initialExpenses: Expense[] = [
      {
        id: 'seed_exp_1',
        date: todayStr(-25),
        category: 'Seeds/Seedlings',
        description: 'Sakata organic pechay seed canisters',
        amount: 2500,
        pcs: 5,
        sourceType: 'online',
        sourceName: 'Lazada',
        sourceWho: 'Lazada Sakata official broker',
        equipmentType: 'Consumables'
      },
      {
        id: 'nutri_exp_1',
        date: todayStr(-15),
        category: 'Substrate & Nutrients',
        description: 'A&B liquid mineral solution sets for leafy vegetables',
        amount: 3200,
        pcs: 8,
        sourceType: 'physical',
        sourceName: 'Malolos Hydro Farm Center',
        sourceWho: 'Engr. David Santos',
        equipmentType: 'Consumables'
      },
      {
        id: 'pack_exp_1',
        date: todayStr(-10),
        category: 'Packaging',
        description: 'Clear vented OPP vegetable bags transparent',
        amount: 1500,
        pcs: 15,
        sourceType: 'online',
        sourceName: 'Shopee',
        sourceWho: 'PacksCity PH seller',
        equipmentType: 'Consumables'
      },
      {
        id: 'equip_exp_1',
        date: todayStr(-12),
        category: 'Equipment Purchase',
        description: 'Submersible Water Sprinkler Pump',
        amount: 12000,
        pcs: 1,
        sourceType: 'physical',
        sourceName: 'Malolos Hydro Farm Center',
        sourceWho: 'Engr. David Santos',
        equipmentType: 'Equipment'
      }
    ];
    await db.expenses.bulkAdd(initialExpenses);

    // Ensure the seed is linked to the explicit Equipment list too for checklist logs!
    const initialEquipment: Equipment[] = [
      {
        id: 'equip_1',
        name: 'Submersible Water Sprinkler Pump',
        purchaseDate: todayStr(-12),
        cost: 12000,
        working: true,
        notes: 'Sourcing Malolos Hydro Farm Center',
        lastChecklistDate: todayStr(-12),
        monthlyChecklist: [
          {
            working: true,
            needsMaintenance: false,
            maintenancePerformedBy: 'owner',
            checkedDate: todayStr(-12),
            notes: 'First engine fire up. No vibration anomalies.'
          }
        ]
      }
    ];
    await db.equipment.bulkAdd(initialEquipment);
  }
}
