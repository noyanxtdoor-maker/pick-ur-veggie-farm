import React, { useState, useEffect } from 'react';
import { db, seedDatabase } from './db';
import { User, UserRole, hasFeatureAccess } from './lib/types';
import { Auth, UserAdminPanel } from './features/Auth';
import { Dashboard } from './features/Dashboard';
import { POS } from './features/POS';
import { Inventory } from './features/Inventory';
import { Accounting } from './features/Accounting';
import { Schedules } from './features/Schedules';
import { Projects } from './features/Projects';
import { Payroll } from './features/Payroll';
import { Settings as SettingsTab } from './features/Settings';
import { BackupBadge } from './components/BackupBadge';
import { 
  Sprout, LogOut, Shield, ShoppingCart, Package, TrendingUp, Calendar, FolderGit, 
  Users, UserCheck, Settings, Key, Sparkles, ServerCrash, RefreshCw, Activity, Menu, X 
} from 'lucide-react';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [showMobileMenu, setShowMobileMenu] = useState<boolean>(false);
  const [seedCheck, setSeedCheck] = useState<number>(0);

  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        // Ensure Database Seeding runs once
        await seedDatabase();

        // Apply active user customized theme
        const activeTheme = localStorage.getItem('puv_theme') || 'light';
        document.documentElement.setAttribute('data-theme', activeTheme);

        // Check if user is already logged in
        const storedUser = localStorage.getItem('puv_logged_user');
        if (storedUser) {
          const user = await db.users.get(storedUser);
          if (user && user.approved) {
            setCurrentUser(user);
          } else {
            localStorage.removeItem('puv_logged_user');
          }
        }
      } catch (err) {
        console.error('Failed to bootstrap database seeds:', err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [seedCheck]);

  // Handle custom dynamic theme listening
  useEffect(() => {
    const handleThemeChange = () => {
      const activeTheme = localStorage.getItem('puv_theme') || 'light';
      document.documentElement.setAttribute('data-theme', activeTheme);
    };
    window.addEventListener('themechange', handleThemeChange);
    return () => window.removeEventListener('themechange', handleThemeChange);
  }, []);

  // Safeguard page permission redirects
  useEffect(() => {
    if (currentUser && !['admin_panel', 'settings', 'dashboard'].includes(activeTab)) {
      if (!hasFeatureAccess(currentUser, activeTab)) {
        setActiveTab('dashboard');
      }
    }
  }, [currentUser, activeTab]);

  const handleRefreshAll = () => {
    setSeedCheck(prev => prev + 1);
  };

  const handleLogout = () => {
    localStorage.removeItem('puv_logged_user');
    setCurrentUser(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-farm-bg p-6 text-center font-sans">
        <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-farm-green mb-4"></div>
        <h3 className="text-lg font-black text-farm-green flex items-center gap-1.5 justify-center">
          <Sprout className="w-5 h-5 text-farm-green animate-bounce" />
          <span>Starting Pick Ur Veggie ERP...</span>
        </h3>
        <p className="text-xs text-farm-muted mt-1">Bootstrapping regional seeds datasets and index layers.</p>
      </div>
    );
  }

  // If no auth, force login panel
  if (!currentUser) {
    return (
      <Auth 
        currentUser={currentUser} 
        setCurrentUser={setCurrentUser} 
        onRefresh={handleRefreshAll} 
      />
    );
  }

  return (
    <div className="min-h-screen bg-farm-bg font-sans flex flex-col md:flex-row pb-16 md:pb-0">
      {/* Left Side Navigation Sidebar in Bento Style - Hidden below md */}
      <aside className="hidden md:flex md:w-64 bg-white border-r border-farm-accent-soft p-5 flex-col justify-between sticky top-0 md:h-screen select-none shadow-[1px_0_4px_rgba(0,0,0,0.02)]">
        <div className="space-y-5">
          {/* Logo Brand Section */}
          <div className="pb-4 border-b border-farm-accent-soft flex items-center gap-3">
            <div className="w-8.5 h-8.5 bg-farm-green rounded-lg flex items-center justify-center text-white font-black text-sm shadow-sm">
              PV
            </div>
            <div>
              <h1 className="font-extrabold text-base tracking-tight text-farm-ink">PickUrVeggie</h1>
              <p className="text-[10px] text-farm-green font-bold uppercase tracking-wider leading-none mt-0.5">ERP Suite</p>
            </div>
          </div>

          {/* Nav Menus */}
          <nav className="space-y-1.5">
            <span className="block text-[10px] font-black text-farm-muted uppercase tracking-wider px-3 pb-1 border-b border-farm-bg">Core Operational Features</span>
            
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`w-full text-left p-3 rounded-xl font-bold text-xs flex items-center gap-2.5 transition select-none cursor-pointer ${activeTab === 'dashboard' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green hover:bg-farm-bg/50'}`}
            >
              <Activity className="w-4 h-4" /> Home Dashboard
            </button>

            {hasFeatureAccess(currentUser, 'pos') && (
              <button
                onClick={() => setActiveTab('pos')}
                className={`w-full text-left p-3 rounded-xl font-bold text-xs flex items-center gap-2.5 transition select-none cursor-pointer ${activeTab === 'pos' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green hover:bg-farm-bg/50'}`}
              >
                <ShoppingCart className="w-4 h-4" /> Weigh Point-Of-Sale
              </button>
            )}

            {hasFeatureAccess(currentUser, 'inventory') && (
              <button
                onClick={() => setActiveTab('inventory')}
                className={`w-full text-left p-3 rounded-xl font-bold text-xs flex items-center gap-2.5 transition select-none cursor-pointer ${activeTab === 'inventory' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green hover:bg-farm-bg/50'}`}
              >
                <Package className="w-4 h-4" /> Stock Inventories
              </button>
            )}

            {hasFeatureAccess(currentUser, 'accounting') && (
              <button
                onClick={() => setActiveTab('accounting')}
                className={`w-full text-left p-3 rounded-xl font-bold text-xs flex items-center gap-2.5 transition select-none cursor-pointer ${activeTab === 'accounting' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green hover:bg-farm-bg/50'}`}
              >
                <TrendingUp className="w-4 h-4" /> Accounting Ledgers
              </button>
            )}

            {hasFeatureAccess(currentUser, 'schedules') && (
              <button
                onClick={() => setActiveTab('schedules')}
                className={`w-full text-left p-3 rounded-xl font-bold text-xs flex items-center gap-2.5 transition select-none cursor-pointer ${activeTab === 'schedules' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green hover:bg-farm-bg/50'}`}
              >
                <Calendar className="w-4 h-4" /> Schedules &amp; Plans
              </button>
            )}

            {hasFeatureAccess(currentUser, 'projects') && (
              <button
                onClick={() => setActiveTab('projects')}
                className={`w-full text-left p-3 rounded-xl font-bold text-xs flex items-center gap-2.5 transition select-none cursor-pointer ${activeTab === 'projects' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green hover:bg-farm-bg/50'}`}
              >
                <FolderGit className="w-4 h-4" /> Project Checklists
              </button>
            )}

            {hasFeatureAccess(currentUser, 'payroll') && (
              <button
                onClick={() => setActiveTab('payroll')}
                className={`w-full text-left p-3 rounded-xl font-bold text-xs flex items-center gap-2.5 transition select-none cursor-pointer ${activeTab === 'payroll' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green hover:bg-farm-bg/50'}`}
              >
                <Users className="w-4 h-4" /> Salaries &amp; Payroll
              </button>
            )}

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full text-left p-3 rounded-xl font-bold text-xs flex items-center gap-2.5 transition select-none cursor-pointer ${activeTab === 'settings' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green hover:bg-farm-bg/50'}`}
            >
              <Settings className="w-4 h-4" /> Settings Hub
            </button>

            {['Developer', 'Owner', 'Co-Owner', 'Admin'].includes(currentUser.role) && (
              <>
                <span className="block text-[10px] font-black text-farm-muted uppercase tracking-wider px-3 pt-4 pb-1 border-b border-farm-bg">User Administration</span>
                
                <button
                  onClick={() => setActiveTab('admin_panel')}
                  className={`w-full text-left p-3 rounded-xl font-bold text-xs flex items-center gap-2.5 transition select-none cursor-pointer ${activeTab === 'admin_panel' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green hover:bg-farm-bg/50'}`}
                >
                  <UserCheck className="w-4 h-4" /> Approvals &amp; Roles
                </button>
              </>
            )}
          </nav>
        </div>

        {/* User Session Profile details at bottom of Sidebar */}
        <div className="pt-4 border-t border-farm-accent-soft space-y-3">
          <div className="flex items-center gap-3 p-1">
            <div className="w-9 h-9 bg-farm-green text-white font-extrabold rounded-full flex items-center justify-center text-xs shadow-sm uppercase">
              {currentUser.username.slice(0, 2)}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black text-farm-ink truncate">{currentUser.username}</p>
              <p className="text-[10px] text-farm-green font-bold uppercase tracking-widest leading-none mt-0.5">{currentUser.role} Access</p>
            </div>
          </div>

          <div className="text-[10px] text-farm-muted text-center pt-2 border-t border-farm-accent-soft/50 space-y-1">
            <div className="flex items-center justify-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-farm-green" />
              <span className="font-bold">Offline Local Mode</span>
            </div>
            <p className="font-semibold leading-relaxed">Stored on local browser index unless backup triggered.</p>
          </div>
        </div>
      </aside>

      {/* Main Container Stage (Bento Layout Style) */}
      <main className="flex-1 flex flex-col min-w-0 bg-farm-bg overflow-x-hidden">
        {/* Top-docked panel Header */}
        <header className="bg-white border-b border-farm-accent-soft px-4 py-3 md:px-6 md:py-4 flex flex-col md:flex-row items-center justify-between gap-3 sticky top-0 z-30 select-none shadow-[0_1px_3px_rgba(0,0,0,0.01)]">
          <div className="flex items-center justify-between w-full md:w-auto">
            <div className="flex items-center gap-2">
              {/* Compact Logo Brand for Mobile */}
              <div className="md:hidden w-8 h-8 bg-farm-green rounded-lg flex items-center justify-center text-white font-black text-xs shadow-sm">
                PV
              </div>
              <div>
                <h2 className="text-sm md:text-lg font-black text-farm-ink flex items-center gap-1.5 leading-tight">
                  <span className="md:hidden text-farm-muted text-[11px] font-bold uppercase tracking-wider mr-0.5">PV —</span>
                  <span>{activeTab === 'dashboard' ? 'Home Dashboard' :
                        activeTab === 'pos' ? 'Weigh POS Terminal' :
                        activeTab === 'inventory' ? 'Inventory Sync Hub' :
                        activeTab === 'accounting' ? 'Accounting Journals' :
                        activeTab === 'schedules' ? 'Operational Plans' :
                        activeTab === 'projects' ? 'Campaign Boards' :
                        activeTab === 'payroll' ? 'Salaries & Payroll' :
                        activeTab === 'settings' ? 'Settings Hub' :
                        'Approvals Admin'}</span>
                  <span className="text-[9px] font-bold text-farm-green bg-farm-accent-soft px-1.5 py-0.5 rounded-full border border-farm-accent/40 whitespace-nowrap">BRANCH LIVE</span>
                </h2>
                <p className="text-xs text-farm-muted md:block hidden">PickUrVeggie Regional Enterprise Platform (Synchronized)</p>
              </div>
            </div>

            {/* Quick Logout, BackupBadge and Hamburger row on mobile */}
            <div className="flex md:hidden items-center gap-2 text-xs">
              <BackupBadge />
              <button 
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                title="Toggle menu drawer"
                className="p-2 border border-farm-accent bg-farm-accent-soft hover:bg-farm-accent text-farm-green rounded-xl transition cursor-pointer select-none"
              >
                <Menu className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Header Action Tools for Desktop & Tablets (md+) */}
          <div className="hidden md:flex flex-wrap items-center gap-3 text-xs">
            <div className="md:flex hidden">
              <BackupBadge />
            </div>

            <div className="flex items-center gap-2 bg-farm-bg px-3 py-1.5 rounded-xl border border-farm-accent-soft shadow-xs text-farm-ink font-semibold">
              <span className="w-2 h-2 rounded-full bg-farm-green animate-pulse" />
              <span>Session: <strong className="font-mono text-farm-green">{currentUser.username}</strong></span>
            </div>

            <button 
              onClick={handleLogout}
              title="Sign out of regional terminal"
              className="bg-red-500 hover:bg-red-650 px-3.5 py-1.5 rounded-xl font-bold cursor-pointer transition text-xs flex items-center gap-1.5 shadow-sm text-white"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </header>

        {/* Inner page content viewport with Desktop Max Width bounds */}
        <div className="flex-1 p-4 md:p-8 pb-32 md:pb-12 max-w-7xl w-full mx-auto animate-fade-in">
          {activeTab === 'dashboard' && (
            <Dashboard 
              currentUser={currentUser} 
              setActiveTab={setActiveTab}
              onRefresh={handleRefreshAll} 
            />
          )}

          {activeTab === 'pos' && (
            <POS 
              currentUser={currentUser} 
              onRefresh={handleRefreshAll} 
            />
          )}

          {activeTab === 'inventory' && (
            <Inventory 
              currentUser={currentUser} 
              onRefresh={handleRefreshAll} 
            />
          )}

          {activeTab === 'accounting' && (
            <Accounting 
              currentUser={currentUser} 
              onRefresh={handleRefreshAll} 
            />
          )}

          {activeTab === 'schedules' && (
            <Schedules 
              currentUser={currentUser} 
              onRefresh={handleRefreshAll} 
            />
          )}

          {activeTab === 'projects' && (
            <Projects 
              currentUser={currentUser} 
              onRefresh={handleRefreshAll} 
            />
          )}

          {activeTab === 'payroll' && (
            <Payroll 
              currentUser={currentUser} 
              onRefresh={handleRefreshAll} 
            />
          )}

          {activeTab === 'settings' && (
            <SettingsTab 
              currentUser={currentUser} 
              onRefresh={handleRefreshAll} 
              onLogout={handleLogout}
            />
          )}

          {activeTab === 'admin_panel' && ['Developer', 'Owner', 'Co-Owner', 'Admin'].includes(currentUser.role) && (
            <UserAdminPanel 
              currentUser={currentUser} 
            />
          )}
        </div>
      </main>

      {/* Sticky Bottom Navigation Bar for Mobile & Tablets */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-farm-accent-soft shadow-[0_-4px_12px_rgba(0,0,0,0.04)] pb-[safe-area-inset-bottom]">
        <nav className="flex items-center gap-1 p-2 overflow-x-auto no-scrollbar scroll-smooth">
          {hasFeatureAccess(currentUser, 'pos') && (
            <button
              onClick={() => setActiveTab('pos')}
              className={`flex-1 min-w-[72px] flex flex-col items-center justify-center p-1.5 rounded-xl transition select-none cursor-pointer ${activeTab === 'pos' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green hover:bg-farm-bg/50'}`}
            >
              <ShoppingCart className="w-4 h-4" />
              <span className="text-[10px] font-black tracking-tight mt-0.5 whitespace-nowrap">POS</span>
            </button>
          )}

          {hasFeatureAccess(currentUser, 'inventory') && (
            <button
              onClick={() => setActiveTab('inventory')}
              className={`flex-1 min-w-[72px] flex flex-col items-center justify-center p-1.5 rounded-xl transition select-none cursor-pointer ${activeTab === 'inventory' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green hover:bg-farm-bg/50'}`}
            >
              <Package className="w-4 h-4" />
              <span className="text-[10px] font-black tracking-tight mt-0.5 whitespace-nowrap">Inventory</span>
            </button>
          )}

          {hasFeatureAccess(currentUser, 'accounting') && (
            <button
              onClick={() => setActiveTab('accounting')}
              className={`flex-1 min-w-[72px] flex flex-col items-center justify-center p-1.5 rounded-xl transition select-none cursor-pointer ${activeTab === 'accounting' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green hover:bg-farm-bg/50'}`}
            >
              <TrendingUp className="w-4 h-4" />
              <span className="text-[10px] font-black tracking-tight mt-0.5 whitespace-nowrap">Accounting</span>
            </button>
          )}

          {hasFeatureAccess(currentUser, 'schedules') && (
            <button
              onClick={() => setActiveTab('schedules')}
              className={`flex-1 min-w-[72px] flex flex-col items-center justify-center p-1.5 rounded-xl transition select-none cursor-pointer ${activeTab === 'schedules' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green hover:bg-farm-bg/50'}`}
            >
              <Calendar className="w-4 h-4" />
              <span className="text-[10px] font-black tracking-tight mt-0.5 whitespace-nowrap">Schedules</span>
            </button>
          )}

          {hasFeatureAccess(currentUser, 'projects') && (
            <button
              onClick={() => setActiveTab('projects')}
              className={`flex-1 min-w-[72px] flex flex-col items-center justify-center p-1.5 rounded-xl transition select-none cursor-pointer ${activeTab === 'projects' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green hover:bg-farm-bg/50'}`}
            >
              <FolderGit className="w-4 h-4" />
              <span className="text-[10px] font-black tracking-tight mt-0.5 whitespace-nowrap">Projects</span>
            </button>
          )}

          {hasFeatureAccess(currentUser, 'payroll') && (
            <button
              onClick={() => setActiveTab('payroll')}
              className={`flex-1 min-w-[72px] flex flex-col items-center justify-center p-1.5 rounded-xl transition select-none cursor-pointer ${activeTab === 'payroll' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green hover:bg-farm-bg/50'}`}
            >
              <Users className="w-4 h-4" />
              <span className="text-[10px] font-black tracking-tight mt-0.5 whitespace-nowrap">Payroll</span>
            </button>
          )}

          <button
            onClick={() => setActiveTab('settings')}
            className={`flex-1 min-w-[72px] flex flex-col items-center justify-center p-1.5 rounded-xl transition select-none cursor-pointer ${activeTab === 'settings' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green hover:bg-farm-bg/50'}`}
          >
            <Settings className="w-4 h-4" />
            <span className="text-[10px] font-black tracking-tight mt-0.5 whitespace-nowrap">Settings</span>
          </button>

          {['Developer', 'Owner', 'Co-Owner', 'Admin'].includes(currentUser.role) && (
            <button
              onClick={() => setActiveTab('admin_panel')}
              className={`flex-1 min-w-[72px] flex flex-col items-center justify-center p-1.5 rounded-xl transition select-none cursor-pointer ${activeTab === 'admin_panel' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green hover:bg-farm-bg/50'}`}
            >
              <UserCheck className="w-4 h-4" />
              <span className="text-[10px] font-black tracking-tight mt-0.5 whitespace-nowrap">Approvals</span>
            </button>
          )}
        </nav>
      </div>

      {/* Floating sliding drawer navigation list on mobile */}
      {showMobileMenu && (
        <div className="fixed inset-0 z-50 lg:hidden flex justify-end">
          {/* Backdrop layer */}
          <div 
            onClick={() => setShowMobileMenu(false)}
            className="fixed inset-0 bg-stone-900/40 backdrop-blur-xs transition-opacity"
          />
          {/* Drawer content drawer block */}
          <div className="relative w-80 max-w-[85vw] h-full bg-white shadow-2xl flex flex-col justify-between p-6 overflow-y-auto z-10 animate-fade-in-right">
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-farm-accent-soft">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 bg-farm-green rounded-lg flex items-center justify-center text-white font-black text-xs">
                    PV
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm text-farm-ink">PickUrVeggie Menu</h3>
                    <p className="text-[10px] text-farm-green font-black uppercase tracking-wider">ERP Suite</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowMobileMenu(false)}
                  className="p-1.5 hover:bg-farm-accent-soft rounded-lg text-farm-muted transition cursor-pointer"
                >
                  <X className="w-5 h-5 animate-pulse" />
                </button>
              </div>

              {/* Navigation list */}
              <nav className="space-y-1.5 text-xs font-semibold">
                <span className="block text-[9px] font-black text-farm-muted uppercase tracking-wider pb-1 border-b border-farm-bg">Core Operational Features</span>
                
                <button
                  onClick={() => { setActiveTab('dashboard'); setShowMobileMenu(false); }}
                  className={`w-full text-left p-3 rounded-xl font-bold flex items-center gap-2.5 transition select-none cursor-pointer ${activeTab === 'dashboard' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green'}`}
                >
                  <Activity className="w-4 h-4" /> Home Dashboard
                </button>

                {hasFeatureAccess(currentUser, 'pos') && (
                  <button
                    onClick={() => { setActiveTab('pos'); setShowMobileMenu(false); }}
                    className={`w-full text-left p-3 rounded-xl font-bold flex items-center gap-2.5 transition select-none cursor-pointer ${activeTab === 'pos' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green'}`}
                  >
                    <ShoppingCart className="w-4 h-4" /> Weigh Point-Of-Sale
                  </button>
                )}

                {hasFeatureAccess(currentUser, 'inventory') && (
                  <button
                    onClick={() => { setActiveTab('inventory'); setShowMobileMenu(false); }}
                    className={`w-full text-left p-3 rounded-xl font-bold flex items-center gap-2.5 transition select-none cursor-pointer ${activeTab === 'inventory' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green'}`}
                  >
                    <Package className="w-4 h-4" /> Stock Inventories
                  </button>
                )}

                {hasFeatureAccess(currentUser, 'accounting') && (
                  <button
                    onClick={() => { setActiveTab('accounting'); setShowMobileMenu(false); }}
                    className={`w-full text-left p-3 rounded-xl font-bold flex items-center gap-2.5 transition select-none cursor-pointer ${activeTab === 'accounting' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green'}`}
                  >
                    <TrendingUp className="w-4 h-4" /> Accounting Ledgers
                  </button>
                )}

                {hasFeatureAccess(currentUser, 'schedules') && (
                  <button
                    onClick={() => { setActiveTab('schedules'); setShowMobileMenu(false); }}
                    className={`w-full text-left p-3 rounded-xl font-bold flex items-center gap-2.5 transition select-none cursor-pointer ${activeTab === 'schedules' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green'}`}
                  >
                    <Calendar className="w-4 h-4" /> Schedules &amp; Plans
                  </button>
                )}

                {hasFeatureAccess(currentUser, 'projects') && (
                  <button
                    onClick={() => { setActiveTab('projects'); setShowMobileMenu(false); }}
                    className={`w-full text-left p-3 rounded-xl font-bold flex items-center gap-2.5 transition select-none cursor-pointer ${activeTab === 'projects' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green'}`}
                  >
                    <FolderGit className="w-4 h-4" /> Project Checklists
                  </button>
                )}

                {hasFeatureAccess(currentUser, 'payroll') && (
                  <button
                    onClick={() => { setActiveTab('payroll'); setShowMobileMenu(false); }}
                    className={`w-full text-left p-3 rounded-xl font-bold flex items-center gap-2.5 transition select-none cursor-pointer ${activeTab === 'payroll' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green'}`}
                  >
                    <Users className="w-4 h-4" /> Salaries &amp; Payroll
                  </button>
                )}

                <button
                  onClick={() => { setActiveTab('settings'); setShowMobileMenu(false); }}
                  className={`w-full text-left p-3 rounded-xl font-bold flex items-center gap-2.5 transition select-none cursor-pointer ${activeTab === 'settings' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green'}`}
                >
                  <Settings className="w-4 h-4" /> Settings Hub
                </button>

                {['Developer', 'Owner', 'Co-Owner', 'Admin'].includes(currentUser.role) && (
                  <>
                    <span className="block text-[9px] font-black text-farm-muted uppercase tracking-wider pt-3 pb-1 border-b border-farm-bg">User Administration</span>
                    <button
                      onClick={() => { setActiveTab('admin_panel'); setShowMobileMenu(false); }}
                      className={`w-full text-left p-3 rounded-xl font-bold flex items-center gap-2.5 transition select-none cursor-pointer ${activeTab === 'admin_panel' ? 'bg-farm-accent-soft text-farm-green border border-farm-accent/40 shadow-xs' : 'text-farm-muted hover:text-farm-green'}`}
                    >
                      <UserCheck className="w-4 h-4" /> Approvals &amp; Roles
                    </button>
                  </>
                )}
              </nav>
            </div>

            <div className="pt-4 border-t border-farm-accent-soft sticky bottom-0 bg-white">
              <button 
                onClick={() => { handleLogout(); setShowMobileMenu(false); }}
                className="w-full bg-red-500 hover:bg-red-650 text-white font-bold py-3 px-4 rounded-xl transition text-xs uppercase flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out Account</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
