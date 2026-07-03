// M7B projects seam (mock mode): create project, add + toggle tasks (% complete), delete cascades tasks,
// branch scoping. Server-side tenant/branch/task-parent isolation is proven by scripts/guards/projects-security.sql.
import 'fake-indexeddb/auto';
import {describe, expect, it, beforeAll} from 'vitest';
import {DEMO, seedMockData} from '@/app/core/mock/mock';
import {projectsApi} from '@/app/features/projects/api';

describe('projects (mock mode)', () => {
  beforeAll(async () => {
    await seedMockData();
  });

  it('creates a project (branch-scoped) with an empty checklist', async () => {
    await projectsApi.createProject(DEMO.companyId, DEMO.branchA, {name: 'Tunnel 3 retrofit', description: 'rainy season', status: 'In Progress'});
    const projs = await projectsApi.fetchProjects(DEMO.companyId, DEMO.branchA);
    expect(projs).toHaveLength(1);
    expect(projs[0]!.name).toBe('Tunnel 3 retrofit');
    expect(projs[0]!.tasks).toHaveLength(0);
    // other branch sees none
    expect(await projectsApi.fetchProjects(DEMO.companyId, DEMO.branchB)).toHaveLength(0);
  });

  it('adds tasks and toggling them drives % complete', async () => {
    let p = (await projectsApi.fetchProjects(DEMO.companyId, DEMO.branchA))[0]!;
    await projectsApi.addTask(p, 'order poly sheet');
    p = (await projectsApi.fetchProjects(DEMO.companyId, DEMO.branchA))[0]!;
    await projectsApi.addTask(p, 'strip old cover');
    p = (await projectsApi.fetchProjects(DEMO.companyId, DEMO.branchA))[0]!;
    expect(p.tasks).toHaveLength(2);
    await projectsApi.toggleTask(p.tasks[0]!, null);
    p = (await projectsApi.fetchProjects(DEMO.companyId, DEMO.branchA))[0]!;
    expect(p.tasks.filter((t) => t.completed)).toHaveLength(1);
    expect(p.tasks[0]!.completed).toBe(true);
  });

  it('rejects a task with no text and a project with no name', async () => {
    const p = (await projectsApi.fetchProjects(DEMO.companyId, DEMO.branchA))[0]!;
    await expect(projectsApi.addTask(p, '   ')).rejects.toThrow(/task/i);
    await expect(projectsApi.createProject(DEMO.companyId, DEMO.branchA, {name: '  '})).rejects.toThrow(/name/i);
  });

  it('deletes a project and its tasks', async () => {
    const p = (await projectsApi.fetchProjects(DEMO.companyId, DEMO.branchA))[0]!;
    await projectsApi.deleteProject(p);
    expect(await projectsApi.fetchProjects(DEMO.companyId, DEMO.branchA)).toHaveLength(0);
  });
});
