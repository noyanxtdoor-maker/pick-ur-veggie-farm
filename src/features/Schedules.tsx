import React, { useState, useEffect } from 'react';
import { db } from '../db';
import { ScheduleEvent, Project, User, UserRole } from '../lib/types';
import { todayISO, MONTHS, yearOf, monthOf } from '../lib/dates';
import { Calendar as CalIcon, Plus, Info, ShieldAlert, Sparkles, Check, Trash2, Link, UserCheck } from 'lucide-react';

interface SchedulesProps {
  currentUser: User;
  onRefresh: () => void;
}

export function Schedules({ currentUser, onRefresh }: SchedulesProps) {
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  // View switchers: 'month' | 'week' | 'day'
  const [viewType, setViewType] = useState<'month' | 'week' | 'day'>('month');
  const [selectedDay, setSelectedDay] = useState<string>(todayISO());

  // Selection dates
  const [currentMonth, setCurrentMonth] = useState<number>(new Date().getMonth() + 1);
  const [currentYear, setCurrentYear] = useState<number>(new Date().getFullYear());

  // Adding event form state
  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [title, setTitle] = useState<string>('');
  const [date, setDate] = useState<string>(todayISO());
  const [type, setType] = useState<'Meeting' | 'Planting' | 'Delivery' | 'Project'>('Planting');
  const [description, setDescription] = useState<string>('');
  const [restrictedRoles, setRestrictedRoles] = useState<UserRole[]>(['Developer', 'Owner', 'Co-Owner', 'Admin', 'Operator', 'Employee']);
  const [linkedProjectId, setLinkedProjectId] = useState<string>('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const listEvents = await db.scheduleEvents.toArray();
    setEvents(listEvents);

    const listProjects = await db.projects.toArray();
    setProjects(listProjects);
  };

  const stampChange = async () => {
    await db.meta.put({ key: 'lastChange', value: new Date().toISOString() });
    onRefresh();
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date) {
      alert('Please fill out titles and choose dates.');
      return;
    }

    const newEv: ScheduleEvent = {
      id: `ev_${Date.now()}`,
      title: title.trim(),
      date,
      type,
      description: description.trim(),
      restrictedTo: restrictedRoles,
      createdBy: currentUser.username,
      projectId: linkedProjectId || undefined
    };

    await db.scheduleEvents.add(newEv);
    await stampChange();
    loadData();

    // Reset Form
    setTitle('');
    setDescription('');
    setLinkedProjectId('');
    setShowAddForm(false);
  };

  const handleDeleteEvent = async (id: string) => {
    if (confirm('Permanently delete this schedule event?')) {
      await db.scheduleEvents.delete(id);
      await stampChange();
      loadData();
    }
  };

  // Helper toggle role visibility
  const toggleRoleRestriction = (role: UserRole) => {
    if (restrictedRoles.includes(role)) {
      setRestrictedRoles(restrictedRoles.filter(r => r !== role));
    } else {
      setRestrictedRoles([...restrictedRoles, role]);
    }
  };

  // Filter events based on current user's role-based visibility restrictions
  const approvedEvents = events.filter(ev => {
    return ['Developer', 'Owner', 'Co-Owner'].includes(currentUser.role) || 
           ev.restrictedTo.includes(currentUser.role) ||
           ev.createdBy === currentUser.username;
  });

  const getDaysOfSelectedWeek = (refDateStr: string) => {
    const [yearStr, monthStr, dayStr] = refDateStr.split('-');
    const refDate = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
    const dayOfWeek = refDate.getDay();
    const sunday = new Date(refDate);
    sunday.setDate(refDate.getDate() - dayOfWeek);
    
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const r = String(d.getDate()).padStart(2, '0');
      weekDays.push(`${y}-${m}-${r}`);
    }
    return weekDays;
  };

  const getWeekOffset = (offsetWeeks: number) => {
    const [yearStr, monthStr, dayStr] = selectedDay.split('-');
    const current = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
    current.setDate(current.getDate() + (offsetWeeks * 7));
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const r = String(current.getDate()).padStart(2, '0');
    setSelectedDay(`${y}-${m}-${r}`);
  };

  const getDayOffset = (offsetDays: number) => {
    const [yearStr, monthStr, dayStr] = selectedDay.split('-');
    const current = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
    current.setDate(current.getDate() + offsetDays);
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const r = String(current.getDate()).padStart(2, '0');
    setSelectedDay(`${y}-${m}-${r}`);
  };

  // Filter events for the currently shown view
  const visibleEvents = approvedEvents.filter(ev => {
    if (viewType === 'day') {
      return ev.date === selectedDay;
    } else if (viewType === 'week') {
      const weekDays = getDaysOfSelectedWeek(selectedDay);
      return weekDays.includes(ev.date);
    } else {
      const evDate = new Date(ev.date);
      const evYear = evDate.getUTCFullYear();
      const evMonth = evDate.getUTCMonth() + 1;
      return evYear === currentYear && evMonth === currentMonth;
    }
  });

  // Calculate Monthly Grid calendar spaces
  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month, 0).getDate();
  };

  const previousMonthChange = () => {
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const nextMonthChange = () => {
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  // Get weekday of 1st day of month (0 = Sun, 1 = Mon...)
  const firstDayIndex = new Date(currentYear, currentMonth - 1, 1).getDay();

  // Create grid cells (empty cells for previous month padding + days)
  const cellArray: (number | null)[] = [];
  for (let i = 0; i < firstDayIndex; i++) {
    cellArray.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cellArray.push(d);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-farm-green flex items-center gap-2">
            <CalIcon className="w-7 h-7" />
            <span>Farm Plans &amp; Schedules</span>
          </h2>
          <p className="text-xs text-farm-muted leading-relaxed">
            Coordinated cropping schedules and partner pickups. Limits event visibility dynamically according to staff permissions.
          </p>
        </div>

        {currentUser.role !== 'Employee' && (
          <button
            onClick={() => {
              setDate(todayISO());
              setRestrictedRoles(['Developer', 'Owner', 'Co-Owner', 'Admin', 'Operator', 'Employee']);
              setShowAddForm(true);
            }}
            className="bg-farm-green hover:bg-farm-green-700 text-white font-bold h-11 px-6 rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer text-sm shadow-md"
          >
            <Plus className="w-5 h-5" /> Book Calendar Event
          </button>
        )}
      </div>

      {/* Role limited visibility notice for Operators / Employees */}
      {['Operator', 'Employee'].includes(currentUser.role) && (
        <div className="p-3.5 bg-farm-accent-soft/30 border border-farm-accent rounded-xl text-left flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 text-farm-green flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-farm-green font-semibold">
            We respect your role level! Displaying only general operational plans. Strategic investor and owner meetings are hidden automatically.
          </p>
        </div>
      )}

      {/* Calendar Controller Header */}
      <div className="bg-white rounded-2xl shadow-md border border-farm-accent-soft p-6">
        
        {/* Toggle View Options Tabs (Month, Week, Day) */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-farm-accent-soft">
          <div className="flex items-center gap-1 bg-farm-accent-soft/60 p-1 rounded-xl border border-farm-accent/20">
            <button
              onClick={() => setViewType('month')}
              className={`px-4 py-2 rounded-lg text-xs font-black transition select-none cursor-pointer ${viewType === 'month' ? 'bg-farm-green text-white shadow-sm' : 'text-farm-muted hover:text-farm-green'}`}
            >
              Month View
            </button>
            <button
              onClick={() => setViewType('week')}
              className={`px-4 py-2 rounded-lg text-xs font-black transition select-none cursor-pointer ${viewType === 'week' ? 'bg-farm-green text-white shadow-sm' : 'text-farm-muted hover:text-farm-green'}`}
            >
              Week View
            </button>
            <button
              onClick={() => setViewType('day')}
              className={`px-4 py-2 rounded-lg text-xs font-black transition select-none cursor-pointer ${viewType === 'day' ? 'bg-farm-green text-white shadow-sm' : 'text-farm-muted hover:text-farm-green'}`}
            >
              Day View
            </button>
          </div>

          <div className="text-xs font-bold text-farm-green bg-farm-accent-soft px-3 py-1.5 rounded-xl border border-farm-accent/40 font-mono">
            Focus: {selectedDay}
          </div>
        </div>

        {/* 1. MONTH VIEW */}
        {viewType === 'month' && (
          <>
            <div className="flex justify-between items-center mb-6">
              <button
                onClick={previousMonthChange}
                className="p-2 border border-farm-accent bg-farm-bg/50 hover:bg-farm-accent-soft text-farm-green rounded-lg font-bold text-xs cursor-pointer transition select-none"
              >
                ← Prev Month
              </button>
              <h3 className="text-sm md:text-base font-black text-farm-green uppercase tracking-wider font-mono">
                {MONTHS[currentMonth - 1]} {currentYear}
              </h3>
              <button
                onClick={nextMonthChange}
                className="p-2 border border-farm-accent bg-farm-bg/50 hover:bg-farm-accent-soft text-farm-green rounded-lg font-bold text-xs cursor-pointer transition select-none"
              >
                Next Month →
              </button>
            </div>

            {/* Visual Calendar Grid Days Header */}
            <div className="grid grid-cols-7 gap-2 text-center text-[10px] font-black text-farm-muted uppercase mb-2 border-b border-farm-accent-soft pb-2">
              <span>Sun</span>
              <span>Mon</span>
              <span>Tue</span>
              <span>Wed</span>
              <span>Thu</span>
              <span>Fri</span>
              <span>Sat</span>
            </div>

            {/* Printable Blocks */}
            <div className="grid grid-cols-7 gap-2 min-h-[300px]">
              {cellArray.map((day, idx) => {
                if (day === null) {
                  return <div key={`pad-${idx}`} className="bg-farm-bg/10 rounded-xl border border-dashed border-farm-accent-soft/40" />;
                }

                const dayString = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const todaysEvents = approvedEvents.filter(ev => ev.date === dayString);
                const isSelected = dayString === selectedDay;

                return (
                  <div
                    key={`day-${day}`}
                    onClick={() => {
                      setSelectedDay(dayString);
                      setDate(dayString);
                      setViewType('day');
                    }}
                    className={`bg-farm-bg/20 rounded-xl p-2 border border-farm-accent-soft min-h-[85px] text-left flex flex-col justify-between hover:bg-white hover:border-farm-green group transition select-none cursor-pointer ${dayString === todayISO() ? 'ring-4 ring-farm-green/30 bg-emerald-50/50' : ''} ${isSelected ? 'border-farm-green bg-farm-accent-soft/20' : ''}`}
                    title="Click this cell day to view dynamic plans"
                  >
                    <div className="flex justify-between items-center w-full">
                      <span className={`text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center ${dayString === todayISO() ? 'bg-farm-green text-white font-black' : 'text-farm-ink'}`}>
                        {day}
                      </span>
                      {currentUser.role !== 'Employee' && (
                        <span className="text-[10px] text-farm-green font-bold opacity-0 group-hover:opacity-100 transition duration-150">
                          + Add
                        </span>
                      )}
                    </div>

                    <div className="space-y-1 mt-1.5 flex-1 overflow-y-auto max-h-16 pr-0.5">
                      {todaysEvents.map(e => {
                        let badgeColor = 'bg-farm-green text-white';
                        if (e.type === 'Meeting') badgeColor = 'bg-indigo-600 text-white';
                        if (e.type === 'Delivery') badgeColor = 'bg-amber-600 text-white';
                        if (e.type === 'Project') badgeColor = 'bg-sky-700 text-white';

                        return (
                          <div
                            key={e.id}
                            onClick={(clickEv) => {
                              // Let click selection trigger and stop form trigger
                              clickEv.stopPropagation();
                              setSelectedDay(dayString);
                            }}
                            className={`p-1 rounded text-[8px] font-bold ${badgeColor} truncate leading-tight tracking-tight shadow-sm cursor-pointer flex items-center justify-between gap-1`}
                            title={e.description || e.title}
                          >
                            <span className="truncate">{e.title}</span>
                            {currentUser.role !== 'Employee' && (
                              <button
                                onClick={(clickEv) => {
                                  clickEv.stopPropagation();
                                  handleDeleteEvent(e.id);
                                }}
                                className="hover:scale-125 transition text-white/85 cursor-pointer flex-shrink-0 font-extrabold px-0.5"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* 2. WEEK VIEW */}
        {viewType === 'week' && (
          <>
            <div className="flex justify-between items-center mb-6">
              <button
                onClick={() => getWeekOffset(-1)}
                className="p-2 border border-farm-accent bg-farm-bg/50 hover:bg-farm-accent-soft text-farm-green rounded-lg font-bold text-xs cursor-pointer transition select-none"
              >
                ← Prev Week
              </button>
              <h3 className="text-xs md:text-sm font-black text-farm-green uppercase tracking-wider font-mono text-center">
                Week: {getDaysOfSelectedWeek(selectedDay)[0]} to {getDaysOfSelectedWeek(selectedDay)[6]}
              </h3>
              <button
                onClick={() => getWeekOffset(1)}
                className="p-2 border border-farm-accent bg-farm-bg/50 hover:bg-farm-accent-soft text-farm-green rounded-lg font-bold text-xs cursor-pointer transition select-none"
              >
                Next Week →
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-7 gap-3">
              {getDaysOfSelectedWeek(selectedDay).map((dayStr, idx) => {
                const todaysEvents = approvedEvents.filter(ev => ev.date === dayStr);
                const dateObj = new Date(dayStr + 'T00:00:00');
                const dayNum = dateObj.getDate();
                const dayOfWeekName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dateObj.getDay()];
                const isToday = dayStr === todayISO();
                const isSelected = dayStr === selectedDay;

                return (
                  <div
                    key={dayStr}
                    onClick={() => {
                      setSelectedDay(dayStr);
                      setDate(dayStr);
                      setViewType('day');
                    }}
                    className={`bg-farm-bg/20 rounded-2xl p-3 border border-farm-accent-soft hover:border-farm-green hover:bg-white min-h-[140px] text-left flex flex-col justify-between transition cursor-pointer select-none group ${isToday ? 'ring-4 ring-farm-green/30 bg-emerald-50/50' : ''} ${isSelected ? 'border-farm-green bg-farm-accent-soft/20' : ''}`}
                  >
                    <div>
                      <div className="flex justify-between items-center w-full">
                        <span className="text-[10px] font-black uppercase text-farm-muted">{dayOfWeekName}</span>
                        <span className={`text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center ${isToday ? 'bg-farm-green text-white' : 'text-farm-ink font-bold'}`}>
                          {dayNum}
                        </span>
                      </div>

                      <div className="space-y-1 mt-2.5 max-h-24 overflow-y-auto">
                        {todaysEvents.map(e => {
                          let typeBadge = 'bg-farm-green text-white';
                          if (e.type === 'Meeting') typeBadge = 'bg-indigo-600 text-white';
                          if (e.type === 'Delivery') typeBadge = 'bg-amber-600 text-white';
                          if (e.type === 'Project') typeBadge = 'bg-sky-700 text-white';

                          return (
                            <div
                              key={e.id}
                              onClick={(clickEv) => {
                                clickEv.stopPropagation();
                                setSelectedDay(dayStr);
                              }}
                              className={`p-1 rounded text-[8px] font-bold ${typeBadge} truncate flex items-center justify-between gap-1`}
                              title={e.description || e.title}
                            >
                              <span className="truncate">{e.title}</span>
                              {currentUser.role !== 'Employee' && (
                                <button
                                  onClick={(clickEv) => {
                                    clickEv.stopPropagation();
                                    handleDeleteEvent(e.id);
                                  }}
                                  className="text-white hover:scale-125 transition font-black text-[9px] px-0.5"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="text-[8px] font-extrabold text-farm-green opacity-0 group-hover:opacity-100 text-right transition duration-150 mt-1">
                      + Add Plan
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* 3. DAY VIEW */}
        {viewType === 'day' && (
          <div className="bg-farm-accent-soft/40 rounded-2xl border border-farm-accent/40 p-4 md:p-6 text-center space-y-4">
            <div className="flex items-center justify-between gap-4">
              <button
                onClick={() => getDayOffset(-1)}
                className="p-2 border border-farm-accent bg-white hover:bg-farm-accent-soft text-farm-green rounded-xl font-bold text-xs cursor-pointer transition select-none"
              >
                ← Prev Day
              </button>
              <div className="text-center flex flex-col items-center">
                <span className="text-[9px] font-black uppercase text-farm-green tracking-widest block mb-0.5">Focusing Day Schedule</span>
                <h4 className="text-lg font-black text-farm-ink font-mono">{selectedDay}</h4>
                {currentUser.role !== 'Employee' && (
                  <button
                    onClick={() => {
                      setDate(selectedDay);
                      setShowAddForm(true);
                    }}
                    className="mt-2 text-[10px] font-black hover:bg-farm-green hover:text-white text-farm-green cursor-pointer bg-white px-3 py-1.5 border border-farm-accent-soft rounded-full transition shadow-xs"
                  >
                    + Book Schedule Plan
                  </button>
                )}
              </div>
              <button
                onClick={() => getDayOffset(1)}
                className="p-2 border border-farm-accent bg-white hover:bg-farm-accent-soft text-farm-green rounded-xl font-bold text-xs cursor-pointer transition select-none"
              >
                Next Day →
              </button>
            </div>

            <div className="space-y-3.5 mt-6 text-left max-w-xl mx-auto">
              {approvedEvents.filter(ev => ev.date === selectedDay).length === 0 ? (
                <div className="text-center py-12 bg-white rounded-xl border border-dashed border-farm-accent-soft text-farm-muted italic">
                  <p className="font-semibold text-xs text-farm-muted">No schedules booked for {selectedDay}.</p>
                  {currentUser.role !== 'Employee' && (
                    <button
                      onClick={() => {
                        setDate(selectedDay);
                        setShowAddForm(true);
                      }}
                      className="mt-3 inline-flex items-center gap-1.5 text-farm-green hover:underline font-black text-xs"
                    >
                      Establish a plan right now →
                    </button>
                  )}
                </div>
              ) : (
                approvedEvents.filter(ev => ev.date === selectedDay).map(e => {
                  let typeBadge = 'bg-farm-green text-white';
                  let borderStyle = 'border-l-4 border-l-farm-green';
                  if (e.type === 'Meeting') {
                    typeBadge = 'bg-indigo-600 text-white';
                    borderStyle = 'border-l-4 border-l-indigo-600';
                  }
                  if (e.type === 'Delivery') {
                    typeBadge = 'bg-amber-600 text-white';
                    borderStyle = 'border-l-4 border-l-amber-600';
                  }
                  if (e.type === 'Project') {
                    typeBadge = 'bg-sky-700 text-white';
                    borderStyle = 'border-l-4 border-l-sky-700';
                  }

                  return (
                    <div key={e.id} className={`bg-white p-4 rounded-xl border border-farm-accent-soft/80 shadow-xs flex items-center justify-between gap-4 ${borderStyle}`}>
                      <div className="space-y-1 my-0.5">
                        <span className={`inline-block px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${typeBadge}`}>
                          {e.type}
                        </span>
                        <h5 className="font-extrabold text-sm text-farm-ink">{e.title}</h5>
                        <p className="text-xs text-farm-muted">{e.description || 'No additional remarks standard.'}</p>
                        <p className="text-[9px] text-farm-muted font-bold font-mono">Booked by: {e.createdBy}</p>
                      </div>
                      {currentUser.role !== 'Employee' && (
                        <button
                          onClick={() => handleDeleteEvent(e.id)}
                          className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 font-extrabold rounded-xl transition text-[10px] cursor-pointer"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

      </div>

      {/* Sidebar Listing / Linked projects info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-farm-accent-soft p-5 shadow">
          <h4 className="font-extrabold text-farm-green text-xs uppercase mb-3 flex items-center gap-1">
            <Info className="w-4 h-4 text-farm-green" /> List of Month Plans
          </h4>
          <div className="divide-y divide-farm-accent-soft text-xs max-h-60 overflow-y-auto pr-1">
            {visibleEvents.map(ev => (
              <div key={ev.id} className="py-2.5 flex justify-between items-start gap-4">
                <div>
                  <div className="font-bold text-farm-ink">{ev.title}</div>
                  <div className="text-[10px] text-farm-muted mt-0.5">{ev.description || 'No remarks provided.'}</div>
                  <div className="text-[9px] text-farm-muted font-bold font-mono uppercase tracking-wide mt-1">Booked: {ev.date} · Type: {ev.type}</div>
                </div>
                {ev.projectId && (
                  <span className="px-2 py-0.5 rounded bg-sky-100 text-sky-800 font-extrabold text-[9px] uppercase flex items-center gap-0.5">
                    <Link className="w-2.5 h-2.5" /> Project
                  </span>
                )}
              </div>
            ))}
            {visibleEvents.length === 0 && (
              <p className="text-center text-farm-muted italic py-6">No schedules booked for {MONTHS[currentMonth - 1]}.</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-farm-accent-soft p-5 shadow text-xs">
          <h4 className="font-extrabold text-farm-green text-xs uppercase mb-3 flex items-center gap-1">
            <UserCheck className="w-4 h-4 text-farm-green" /> Staff Permissions Key
          </h4>
          <ul className="space-y-1.5 leading-relaxed font-semibold text-farm-muted">
            <li>• <strong className="text-farm-green">Developer / Owner</strong> can see all strategic meetings, add/delete bookings, and appoint user slots.</li>
            <li>• <strong className="text-farm-green">Admin / Operator</strong> can book cropping cycles, track harvests, and coordinate deliveries.</li>
            <li>• <strong className="text-farm-green">Employee</strong> acts as viewer, accessing planting and delivery calendars but blind to private investment talks.</li>
          </ul>
        </div>
      </div>

      {/* Add Custom schedule details */}
      {showAddForm && (
        <div className="overlay show select-none">
          <div className="modal max-w-md animate-scale-up">
            <div className="p-6">
              <h3 className="text-xl font-bold text-farm-green text-center">Book Calendar Schedule</h3>
              <p className="text-xs text-farm-muted text-center mb-6">Create a plan visible only to authorized staff categories.</p>

              <form onSubmit={handleCreateEvent} className="space-y-4 text-xs font-semibold text-farm-ink">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Event Date Target</label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full text-xs font-semibold p-2.5 border border-farm-accent-soft rounded-lg bg-farm-bg"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Class Type</label>
                    <select
                      value={type}
                      onChange={(e) => setType(e.target.value as any)}
                      className="w-full text-xs font-semibold p-2.5 border border-farm-accent-soft rounded-lg bg-farm-bg/50 focus:outline-none"
                    >
                      <option value="Planting">Planting Cycle harvest</option>
                      <option value="Meeting">Strategic Staff Meeting</option>
                      <option value="Delivery">Vendor delivery pickup</option>
                      <option value="Project">Engineering Project Milestone</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5 font-bold">Plan Title</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Pechay harvesting Slot 2"
                    className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-farm-green bg-farm-bg text-sm"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Linked Project (Optional)</label>
                  <select
                    value={linkedProjectId}
                    onChange={(e) => setLinkedProjectId(e.target.value)}
                    className="w-full text-xs font-semibold p-2.5 border border-farm-accent-soft rounded-lg bg-farm-bg/50 focus:outline-none"
                  >
                    <option value="">-- No Linked Project --</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                {/* Restricted to Roles check lists */}
                <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Authorised Roles Visibility</label>
                  <div className="grid grid-cols-2 gap-2 p-3 bg-farm-bg rounded-xl border border-farm-accent-soft">
                    {(['Developer', 'Owner', 'Co-Owner', 'Admin', 'Operator', 'Employee'] as UserRole[]).map(role => (
                      <label key={role} className="flex items-center gap-1 text-[11px] font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={restrictedRoles.includes(role)}
                          onChange={() => toggleRoleRestriction(role)}
                          className="rounded border-farm-accent text-farm-green accent-farm-green w-3.5 h-3.5 cursor-pointer"
                        />
                        <span>{role}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Schedule Notes</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. Harvest 50kg, pack under Sakata bags."
                    className="w-full text-sm p-3 rounded-xl border border-farm-accent-soft h-20 focus:outline-none bg-farm-bg"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-farm-accent-soft">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="bg-farm-bg hover:bg-farm-accent-soft text-farm-green font-semibold py-3 px-6 rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-farm-green hover:bg-farm-green-700 text-white font-bold py-3 px-6 rounded-xl flex-1 cursor-pointer"
                  >
                    Post Plan to Calendar
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
