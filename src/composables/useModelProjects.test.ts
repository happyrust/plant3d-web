import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

const flushPromises = async () => {
  await Promise.resolve();
  await nextTick();
};

const createModelProjects = async () => {
  const mod = await import('./useModelProjects');
  return mod.useModelProjects();
};

const buildProjectsResponse = (items: Record<string, unknown>[]): Response => ({
  ok: true,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => ({
    items,
    total: items.length,
    page: 1,
    per_page: 20,
  }),
} as Response);

describe('useModelProjects', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const baseUrl = `${window.location.origin}/`;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', baseUrl);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', baseUrl);
  });

  it('switchProjectById switches to existing project', async () => {
    fetchMock.mockResolvedValue(buildProjectsResponse([
      { id: 'project-1', name: 'Project1', notes: 'Test 1' },
      { id: 'AvevaMarineSample', name: 'AvevaMarineSample', notes: 'Marine' },
    ]));

    const { switchProjectById, currentProject } = await createModelProjects();
    await flushPromises();

    expect(switchProjectById('project-1')).toBe(true);
    expect(currentProject.value?.path).toBe('Project1');

    const result = switchProjectById('AvevaMarineSample');
    expect(result).toBe(true);
    expect(currentProject.value?.path).toBe('AvevaMarineSample');
  });

  it('switchProjectById returns false for non-existent project', async () => {
    fetchMock.mockResolvedValue(buildProjectsResponse([]));

    const { switchProjectById } = await createModelProjects();
    await flushPromises();

    const result = switchProjectById('non-existent-project');
    expect(result).toBe(false);
  });

  it('switchProjectById does not switch if already on target project', async () => {
    fetchMock.mockResolvedValue(buildProjectsResponse([
      { id: 'AvevaMarineSample', name: 'AvevaMarineSample', notes: 'Marine' },
    ]));

    const { switchProjectById, currentProject } = await createModelProjects();
    await flushPromises();

    switchProjectById('AvevaMarineSample');

    const eventSpy = vi.fn();
    window.addEventListener('modelProjectChanged', eventSpy);

    const currentId = currentProject.value?.id;
    expect(currentId).toBe('AvevaMarineSample');

    switchProjectById(currentId!);

    expect(eventSpy).not.toHaveBeenCalled();

    window.removeEventListener('modelProjectChanged', eventSpy);
  });

  it('switchProjectById triggers modelProjectChanged event', async () => {
    fetchMock.mockResolvedValue(buildProjectsResponse([
      { id: 'project-1', name: 'Project1', notes: 'Test 1' },
      { id: 'AvevaMarineSample', name: 'AvevaMarineSample', notes: 'Marine' },
    ]));

    const { switchProjectById } = await createModelProjects();
    await flushPromises();

    const switchedToOther = switchProjectById('project-1');
    expect(switchedToOther).toBe(true);

    const eventSpy = vi.fn();
    window.addEventListener('modelProjectChanged', eventSpy);

    const result = switchProjectById('AvevaMarineSample');

    expect(result).toBe(true);
    expect(eventSpy).toHaveBeenCalledOnce();

    window.removeEventListener('modelProjectChanged', eventSpy);
  });

  it('switchProjectById matches project by path when id does not match', async () => {
    fetchMock.mockResolvedValue(buildProjectsResponse([
      { id: 'other', name: 'OtherProj', notes: 'x' },
      { id: 'ams-model', name: 'AvevaMarineSample', notes: 'Test AMS' },
    ]));

    const { switchProjectById, currentProject } = await createModelProjects();
    await flushPromises();

    expect(currentProject.value?.path).toBe('AvevaMarineSample');

    expect(switchProjectById('other')).toBe(true);
    expect(currentProject.value?.id).toBe('other');

    expect(switchProjectById('AvevaMarineSample')).toBe(true);
    expect(currentProject.value?.id).toBe('ams-model');
  });

  it('switchProjectById matches project by id or path for embed URLs', async () => {
    fetchMock.mockResolvedValue(buildProjectsResponse([
      { id: 'ams-model', name: 'AvevaMarineSample', notes: 'Test AMS', show_dbnum: 7997 },
      { id: 'other-project', name: 'OtherPath', notes: 'Other project' },
    ]));

    const { switchProjectById, currentProject } = await createModelProjects();
    await flushPromises();

    expect(currentProject.value?.path).toBe('AvevaMarineSample');

    expect(switchProjectById('other-project')).toBe(true);
    expect(currentProject.value?.id).toBe('other-project');

    // Test matching by path（显式切换时仍支持 path）
    let result = switchProjectById('AvevaMarineSample');
    expect(result).toBe(true);
    expect(currentProject.value?.id).toBe('ams-model');
    expect(currentProject.value?.path).toBe('AvevaMarineSample');

    // Test matching by id
    result = switchProjectById('other-project');
    expect(result).toBe(true);
    expect(currentProject.value?.id).toBe('other-project');
  });

  it('falls back cleanly when project loading fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const { currentProject, projects, isLoading } = await createModelProjects();
    await flushPromises();

    expect(isLoading.value).toBe(false);
    expect(projects.value).toHaveLength(1);
    expect(currentProject.value?.path).toBe('AvevaMarineSample');
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('matches project_id query param to list item path when id differs (PMS 常用目录名)', async () => {
    window.history.replaceState({}, '', '/?project_id=AvevaMarineSample');
    fetchMock.mockResolvedValue(buildProjectsResponse([
      { id: 'ams-model', name: 'AvevaMarineSample', notes: 'Test AMS' },
    ]));

    const { currentProject } = await createModelProjects();
    await flushPromises();

    expect(currentProject.value?.path).toBe('AvevaMarineSample');
    expect(currentProject.value?.id).toBe('ams-model');
  });

  it('dedupes concurrent loadProjects onto one fetch', async () => {
    let resolveFetch!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    fetchMock.mockImplementation(() => pending);

    const { currentProject, loadProjects, projects } = await createModelProjects();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const extraA = loadProjects();
    const extraB = loadProjects();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch!(buildProjectsResponse([
      { id: 'p1', name: 'ProjOne', notes: '' },
    ]));
    await Promise.all([extraA, extraB]);
    await flushPromises();

    expect(projects.value).toHaveLength(2);
    expect(projects.value.map((p) => p.path).sort()).toEqual(['AvevaMarineSample', 'ProjOne']);
    expect(projects.value.find((p) => p.path === 'ProjOne')).toBeTruthy();
    expect(currentProject.value?.path).toBe('AvevaMarineSample');
  });

  it('falls back to default AvevaMarineSample when project_id does not match and list is empty', async () => {
    window.history.replaceState({}, '', '/?project_id=legacy-project-path');
    fetchMock.mockResolvedValue(buildProjectsResponse([]));

    const { currentProject, projects } = await createModelProjects();
    await flushPromises();

    expect(projects.value).toHaveLength(1);
    expect(currentProject.value?.path).toBe('AvevaMarineSample');
  });

  it('still auto-creates a project from output_project when backend list is empty', async () => {
    window.history.replaceState({}, '', '/?output_project=OutputOnlyPath');
    fetchMock.mockResolvedValue(buildProjectsResponse([]));

    const { currentProject, projects } = await createModelProjects();
    await flushPromises();

    expect(projects.value).toHaveLength(1);
    expect(currentProject.value?.path).toBe('OutputOnlyPath');
    expect(currentProject.value?.id).toBe('OutputOnlyPath');
  });

  it('当 /api/projects 未返回该 output_project 时，仍保留 URL 指定项目为当前项目', async () => {
    window.history.replaceState({}, '', '/?output_project=MissingButRequested');
    fetchMock.mockResolvedValue(buildProjectsResponse([
      { id: 'ams-model', name: 'AvevaMarineSample', notes: 'Marine' },
    ]));

    const { currentProject, projects } = await createModelProjects();
    await flushPromises();

    expect(currentProject.value?.path).toBe('MissingButRequested');
    expect(currentProject.value?.id).toBe('MissingButRequested');
    expect(projects.value.map((project) => project.path)).toContain('MissingButRequested');
  });

  it('sets output_project as current project immediately before /api/projects resolves', async () => {
    window.history.replaceState({}, '', '/?output_project=AvevaMarineSample');
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));

    const { currentProject, projects, isLoading } = await createModelProjects();

    expect(currentProject.value?.path).toBe('AvevaMarineSample');
    expect(currentProject.value?.id).toBe('AvevaMarineSample');
    expect(projects.value.map((project) => project.path)).toContain('AvevaMarineSample');
    expect(isLoading.value).toBe(true);
  });

  it('keeps output_project when /api/projects fails', async () => {
    window.history.replaceState({}, '', '/?output_project=OtherProject');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const { currentProject, projects, isLoading } = await createModelProjects();
    await flushPromises();

    expect(isLoading.value).toBe(false);
    expect(projects.value).toHaveLength(1);
    expect(currentProject.value?.path).toBe('OtherProject');
    expect(currentProject.value?.id).toBe('OtherProject');
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
