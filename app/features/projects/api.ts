// Projects data-access (M1B A1 seam; spec Phase_2_M7_Projects_Module_Spec.md). Project cards + task checklists are
// branch-owned, non-financial → plain RLS-gated writes (like crops/scheduling). MOCK → Dexie; online → PostgREST;
// offline → outbox. Tasks are scoped through their parent project server-side (RLS EXISTS + is_branch_member).
import {supabase} from '../../core/supabase/client';
import {offlineDB} from '../../core/offline/db';
import {enqueue} from '../../core/offline/queue';
import {uuidv7} from '../../core/offline/uuidv7';
import {MOCK_MODE} from '../../core/mock/mock';
import type {Project, ProjectTask} from '../../types/db';

const online = () => typeof navigator === 'undefined' || navigator.onLine;

export interface ProjectInput {
  name: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  status?: Project['status'];
  visibility?: Project['visibility'];
}

export const projectsApi = {
  async fetchProjects(companyId: string, branchId: string): Promise<Project[]> {
    if (MOCK_MODE) {
      const rows = await offlineDB.projects.where('company_id').equals(companyId).filter((p) => p.branch_id === branchId).toArray();
      const out: Project[] = [];
      for (const p of rows) {
        const tasks = await offlineDB.projectTasks.where('project_id').equals(p.id).toArray();
        out.push({...p, tasks: tasks.sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))});
      }
      return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    const {data: projs, error} = await supabase.from('projects').select('*').eq('company_id', companyId).eq('branch_id', branchId).order('created_at', {ascending: false});
    if (error) throw new Error(error.message);
    const projects = (projs ?? []) as Array<Omit<Project, 'tasks'>>;
    if (projects.length === 0) return [];
    const {data: tasks, error: e2} = await supabase.from('project_tasks').select('*').eq('company_id', companyId).in('project_id', projects.map((p) => p.id));
    if (e2) throw new Error(e2.message);
    const byProject = new Map<string, ProjectTask[]>();
    for (const t of (tasks ?? []) as ProjectTask[]) byProject.set(t.project_id, [...(byProject.get(t.project_id) ?? []), t]);
    return projects.map((p) => ({...p, tasks: (byProject.get(p.id) ?? []).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))}));
  },

  async createProject(companyId: string, branchId: string, input: ProjectInput): Promise<void> {
    if (!input.name.trim()) throw new Error('Project name is required.');
    const payload = {
      company_id: companyId, branch_id: branchId, name: input.name.trim(), description: input.description?.trim() || null,
      start_date: input.start_date || null, end_date: input.end_date || null,
      status: input.status ?? 'In Progress', visibility: input.visibility ?? 'Public',
    };
    if (MOCK_MODE) {
      const now = new Date().toISOString();
      await offlineDB.projects.put({id: uuidv7(), ...payload, created_by: null, created_at: now, updated_at: now});
      return;
    }
    if (online()) {
      const {error} = await supabase.from('projects').insert(payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'project.create', request: {type: 'insert', table: 'projects', payload}});
  },

  async setStatus(project: Project, status: Project['status']): Promise<void> {
    if (MOCK_MODE) {
      const {tasks: _t, ...row} = project;
      await offlineDB.projects.put({...row, status, updated_at: new Date().toISOString()});
      return;
    }
    if (online()) {
      const {error} = await supabase.from('projects').update({status}).eq('id', project.id);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId: project.company_id, kind: 'project.update', request: {type: 'update', table: 'projects', match: {id: project.id, baseUpdatedAt: project.updated_at}, payload: {status}}});
  },

  async deleteProject(project: Project): Promise<void> {
    if (MOCK_MODE) {
      await offlineDB.projectTasks.where('project_id').equals(project.id).delete();
      await offlineDB.projects.delete(project.id);
      return;
    }
    if (online()) {
      await supabase.from('project_tasks').delete().eq('project_id', project.id);
      const {error} = await supabase.from('projects').delete().eq('id', project.id);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId: project.company_id, kind: 'project.cancel', request: {type: 'update', table: 'projects', match: {id: project.id, baseUpdatedAt: project.updated_at}, payload: {status: 'On Hold'}}});
  },

  async addTask(project: Project, text: string): Promise<void> {
    if (!text.trim()) throw new Error('Task text is required.');
    const position = project.tasks.length;
    const payload = {company_id: project.company_id, project_id: project.id, text: text.trim(), position};
    if (MOCK_MODE) {
      await offlineDB.projectTasks.put({id: uuidv7(), ...payload, completed: false, completed_by: null, completed_at: null, created_at: new Date().toISOString()});
      return;
    }
    if (online()) {
      const {error} = await supabase.from('project_tasks').insert(payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId: project.company_id, kind: 'project.task.add', request: {type: 'insert', table: 'project_tasks', payload}});
  },

  async toggleTask(task: ProjectTask, actorUserId: string | null): Promise<void> {
    const completed = !task.completed;
    const patch = {completed, completed_by: completed ? actorUserId : null, completed_at: completed ? new Date().toISOString() : null};
    if (MOCK_MODE) {
      await offlineDB.projectTasks.put({...task, ...patch});
      return;
    }
    if (online()) {
      const {error} = await supabase.from('project_tasks').update(patch).eq('id', task.id);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId: task.company_id, kind: 'project.task.toggle', request: {type: 'update', table: 'project_tasks', match: {id: task.id}, payload: patch}});
  },
};
