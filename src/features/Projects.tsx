import React, { useState, useEffect } from 'react';
import { db } from '../db';
import { Project, ProjectTask, User, UserRole } from '../lib/types';
import { todayISO } from '../lib/dates';
import {
  FolderGit, Plus, CheckCircle2, Circle, Users, Sparkles, Layout, Trash2, Clipboard,
  UserCheck, AlertCircle, HelpCircle, Flame
} from 'lucide-react';

interface ProjectsProps {
  currentUser: User;
  onRefresh: () => void;
}

export function Projects({ currentUser, onRefresh }: ProjectsProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showAddProject, setShowAddProject] = useState<boolean>(false);

  // New Project Form State
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [startDate, setStartDate] = useState<string>(todayISO());
  const [endDate, setEndDate] = useState<string>(todayISO());
  const [status, setStatus] = useState<'Planning' | 'In Progress' | 'Completed' | 'On Hold'>('In Progress');
  const [visibility, setVisibility] = useState<'Public' | 'Restricted'>('Public');
  const [managerInput, setManagerInput] = useState<string>(currentUser.username);

  // New task text
  const [taskText, setTaskText] = useState<Record<string, string>>({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const listProjects = await db.projects.toArray();
    setProjects(listProjects);
  };

  const stampChange = async () => {
    await db.meta.put({ key: 'lastChange', value: new Date().toISOString() });
    onRefresh();
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !description.trim()) {
      alert('Please fill out name and descriptions.');
      return;
    }

    // Managers list: split comma delimited usernames
    const managers = managerInput.split(',').map(m => m.trim().toLowerCase()).filter(Boolean);
    if (!managers.includes(currentUser.username.toLowerCase())) {
      managers.push(currentUser.username.toLowerCase());
    }

    const newProj: Project = {
      id: `proj_${Date.now()}`,
      name: name.trim(),
      description: description.trim(),
      startDate,
      endDate,
      status,
      visibility,
      managers,
      tasks: []
    };

    await db.projects.add(newProj);
    await stampChange();
    loadData();

    // Reset fields
    setName('');
    setDescription('');
    setManagerInput(currentUser.username);
    setShowAddProject(false);
  };

  const handleDeleteProject = async (id: string) => {
    if (confirm('Permanently delete this project card?')) {
      await db.projects.delete(id);
      await stampChange();
      loadData();
    }
  };

  const handleAddTask = async (projId: string) => {
    const text = taskText[projId] || '';
    if (!text.trim()) return;

    const targetProject = projects.find(p => p.id === projId);
    if (!targetProject) return;

    // Check manager authorization
    const isManager = ['Developer', 'Owner', 'Co-Owner', 'Admin'].includes(currentUser.role) ||
                      targetProject.managers.includes(currentUser.username.toLowerCase());

    if (!isManager) {
      alert('Unauthorized! Only assigned managers or owners can append tasks here.');
      return;
    }

    const newTask: ProjectTask = {
      id: `task_${Date.now()}`,
      text: text.trim(),
      completed: false
    };

    const updatedTasks = [...(targetProject.tasks || []), newTask];

    await db.projects.update(projId, { tasks: updatedTasks });
    await stampChange();
    loadData();

    setTaskText({ ...taskText, [projId]: '' });
  };

  const handleToggleTask = async (projId: string, taskId: string) => {
    const targetProject = projects.find(p => p.id === projId);
    if (!targetProject) return;

    const updatedTasks = targetProject.tasks.map(t => {
      if (t.id === taskId) {
        return {
          ...t,
          completed: !t.completed,
          completedBy: !t.completed ? currentUser.username : undefined,
          completedAt: !t.completed ? new Date().toISOString() : undefined
        };
      }
      return t;
    });

    await db.projects.update(projId, { tasks: updatedTasks });
    await stampChange();
    loadData();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-farm-green flex items-center gap-2">
            <FolderGit className="w-7 h-7" />
            <span>Farm Projects Board</span>
          </h2>
          <p className="text-xs text-farm-muted leading-relaxed">
            Team-wide coordination checklists (similar to Monday.com). Tunnels planning, machinery construction, and harvest campaigns visible to everyone.
          </p>
        </div>

        {currentUser.role !== 'Employee' && (
          <button
            onClick={() => {
              setStartDate(todayISO());
              setEndDate(todayISO());
              setManagerInput(currentUser.username);
              setShowAddProject(true);
            }}
            className="bg-farm-green hover:bg-farm-green-700 text-white font-bold h-11 px-6 rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer text-sm shadow-md"
          >
            <Plus className="w-5 h-5" /> Start New Project
          </button>
        )}
      </div>

      {/* Monday.com layout of Projects */}
      <div className="grid grid-cols-1 gap-6">
        {projects.map(p => {
          // Calculate project percentage completion
          const totTasks = p.tasks?.length || 0;
          const completedTasks = p.tasks?.filter(t => t.completed).length || 0;
          const pct = totTasks > 0 ? Math.round((completedTasks / totTasks) * 100) : 0;

          // Check if current user is manager or owner
          const canManage = ['Developer', 'Owner', 'Co-Owner', 'Admin'].includes(currentUser.role) ||
                            p.managers.includes(currentUser.username.toLowerCase());

          return (
            <div key={p.id} className="bg-white rounded-2xl border border-farm-accent-soft shadow-md hover:shadow-xl transition overflow-hidden">
              {/* Header block with color key by status */}
              <div className="p-6 border-b border-farm-accent-soft flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-farm-bg/25 to-white">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-0.5 rounded text-[10px] uppercase font-bold text-white ${
                      p.status === 'Completed' ? 'bg-farm-green' : 
                      p.status === 'In Progress' ? 'bg-amber-600' : 
                      p.status === 'On Hold' ? 'bg-red-600' : 'bg-gray-600'
                    }`}>
                      {p.status}
                    </span>
                    <span className="text-[10px] text-farm-muted font-bold font-mono uppercase bg-farm-accent-soft px-1.5 py-0.5 rounded">
                      Ref: {p.id.slice(5, 12)}
                    </span>
                  </div>
                  <h3 className="text-lg font-black text-farm-green mt-1.5">{p.name}</h3>
                  <p className="text-xs text-farm-muted leading-relaxed max-w-2xl mt-1">{p.description}</p>
                </div>

                <div className="text-right flex flex-col items-start md:items-end gap-1">
                  <div className="text-xs font-bold text-farm-muted">Target Duration: <span className="font-mono text-farm-ink font-extrabold">{p.startDate} to {p.endDate}</span></div>
                  <div className="flex items-center gap-1.5 text-[10px] text-farm-muted font-bold mt-1 uppercase bg-farm-bg p-1.5 px-2.5 rounded-lg border border-farm-accent">
                    <Users className="w-3.5 h-3.5 text-farm-green" />
                    <span>Managers: {p.managers.join(', ')}</span>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-4">
                {/* Progress bar */}
                <div>
                  <div className="flex justify-between text-xs font-bold text-farm-muted uppercase mb-1">
                    <span>Campaign Completion</span>
                    <span>{pct}% ({completedTasks} of {totTasks} completed)</span>
                  </div>
                  <div className="w-full bg-farm-bg h-3 rounded-full overflow-hidden border border-farm-accent-soft">
                    <div className="bg-farm-green h-full rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                {/* Task Checklist steps (uniquely aligned with eggplant steps etc) */}
                <div className="space-y-2">
                  <h4 className="font-bold text-xs text-farm-green uppercase tracking-wide">Step-By-step checklist:</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    {p.tasks?.map(t => (
                      <div
                        key={t.id}
                        onClick={() => handleToggleTask(p.id, t.id)}
                        className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer select-none transition ${t.completed ? 'bg-farm-accent-soft/30 border-farm-accent text-farm-muted line-through' : 'bg-farm-bg hover:bg-white border-farm-accent hover:border-farm-green'}`}
                      >
                        <div className="flex items-center gap-2.5">
                          {t.completed ? (
                            <CheckCircle2 className="w-5 h-5 text-farm-green flex-shrink-0" />
                          ) : (
                            <Circle className="w-5 h-5 text-farm-accent flex-shrink-0" />
                          )}
                          <span className="font-bold tracking-tight">{t.text}</span>
                        </div>
                        {t.completedBy && (
                          <span className="text-[9px] bg-farm-bg px-2 py-0.5 rounded text-farm-muted font-bold font-mono">
                            Done by: {t.completedBy}
                          </span>
                        )}
                      </div>
                    ))}
                    {(!p.tasks || p.tasks.length === 0) && (
                      <p className="text-farm-muted italic text-[11px] col-span-full py-4 text-center">No checklist milestones formulated yet. Add a task below to orchestrate the harvest flow.</p>
                    )}
                  </div>
                </div>

                {/* Adding Milestone (Limited to assigned project managers / strategic roles) */}
                <div className="pt-4 border-t border-farm-accent-soft flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  {canManage ? (
                    <div className="flex w-full max-w-sm gap-2">
                      <input
                        type="text"
                        value={taskText[p.id] || ''}
                        onChange={(e) => setTaskText({ ...taskText, [p.id]: e.target.value })}
                        placeholder="Add step (e.g., Planting a Tunnel of Eggplant)..."
                        className="flex-1 p-2 border border-farm-accent focus:border-farm-green rounded-xl bg-farm-bg text-xs"
                      />
                      <button
                        onClick={() => handleAddTask(p.id)}
                        className="bg-farm-green hover:bg-farm-green-700 text-white font-bold px-4 py-2 rounded-xl text-xs cursor-pointer select-none"
                      >
                        Add Step
                      </button>
                    </div>
                  ) : (
                    <div className="text-[10px] text-farm-muted italic flex items-center gap-1">
                      <AlertCircle className="w-4 h-4 text-farm-green" />
                      <span>Viewing Mode: Ticking checklists allowed. Appending new steps is restricted to {p.managers.join(' & ')}.</span>
                    </div>
                  )}

                  {currentUser.role !== 'Employee' && (
                    <button
                      onClick={() => handleDeleteProject(p.id)}
                      className="text-red-500 hover:bg-red-50 p-2 rounded-lg font-bold text-xs flex items-center gap-1 cursor-pointer transition select-none"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete Project
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {projects.length === 0 && (
          <div className="bg-white border border-farm-accent-soft shadow-md rounded-2xl text-center py-20 text-farm-muted">
            <Clipboard className="w-12 h-12 text-farm-accent mx-auto mb-3" />
            <p className="text-sm font-semibold text-farm-green">No projects registered yet.</p>
            <p className="text-xs text-farm-muted mt-1">Deploy campaign dashboards or cafe timelines to orchestrate team harvests.</p>
          </div>
        )}
      </div>

      {/* New Project Setup overlay */}
      {showAddProject && (
        <div className="overlay show select-none">
          <div className="modal max-w-md animate-scale-up">
            <div className="p-6">
              <h3 className="text-xl font-bold text-farm-green text-center">Start Monday Project</h3>
              <p className="text-xs text-farm-muted text-center mb-6">Create shared company pipelines and track accomplishments in real-time.</p>

              <form onSubmit={handleCreateProject} className="space-y-4 text-xs font-semibold text-farm-ink">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Project Start Date</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full text-xs font-semibold p-2.5 border border-farm-accent-soft rounded-lg bg-farm-bg"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Expected End Date</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full text-xs font-semibold p-2.5 border border-farm-accent-soft rounded-lg bg-farm-bg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Baseline Status</label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as any)}
                      className="w-full text-xs font-semibold p-2.5 border border-farm-accent-soft rounded-lg bg-farm-bg/50 focus:outline-none"
                    >
                      <option value="Planning">Planning</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Completed">Completed</option>
                      <option value="On Hold">On Hold</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Visibility Mode</label>
                    <select
                      value={visibility}
                      onChange={(e) => setVisibility(e.target.value as any)}
                      className="w-full text-xs font-semibold p-2.5 border border-farm-accent-soft rounded-lg bg-farm-bg/50 focus:outline-none"
                    >
                      <option value="Public">Public (Everyone can see/tick items)</option>
                      <option value="Restricted">Restricted (Strict list lookup)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Campaign Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Planting Eggplants Slot 3"
                    className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-farm-green bg-farm-bg text-sm"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Manager list (comma separated usernames)</label>
                  <input
                    type="text"
                    value={managerInput}
                    onChange={(e) => setManagerInput(e.target.value)}
                    placeholder="e.g. owner, admin, dev"
                    className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-farm-green bg-farm-bg text-sm"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Scope Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Provide description..."
                    className="w-full text-sm p-3 rounded-xl border border-farm-accent-soft h-20 focus:outline-none bg-farm-bg"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-farm-accent-soft">
                  <button
                    type="button"
                    onClick={() => setShowAddProject(false)}
                    className="bg-farm-bg hover:bg-farm-accent-soft text-farm-green font-semibold py-3 px-6 rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-farm-green hover:bg-farm-green-700 text-white font-bold py-3 px-6 rounded-xl flex-1 cursor-pointer"
                  >
                    Create Monday Board
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
