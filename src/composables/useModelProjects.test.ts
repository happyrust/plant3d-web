import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import { useModelProjects } from './useModelProjects';

const flushPromises = async () => {
  await Promise.resolve();
  await nextTick();
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

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('switchProjectById switches to existing project', async () => {
    fetchMock.mockResolvedValue(buildProjectsResponse([
      { id: 'project-1', name: 'Project1', notes: 'Test 1' },
      { id: 'AvevaMarineSample', name: 'AvevaMarineSample', notes: 'Marine' },
    ]));

    const { switchProjectById, currentProject } = useModelProjects();
    await flushPromises();

    const result = switchProjectById('AvevaMarineSample');
    expect(result).toBe(true);
    expect(currentProject.value?.path).toBe('AvevaMarineSample');
  });

  it('switchProjectById returns false for non-existent project', async () => {
    fetchMock.mockResolvedValue(buildProjectsResponse([]));

    const { switchProjectById } = useModelProjects();
    await flushPromises();

    const result = switchProjectById('non-existent-project');
    expect(result).toBe(false);
  });

  it('switchProjectById does not switch if already on target project', async () => {
    fetchMock.mockResolvedValue(buildProjectsResponse([
      { id: 'AvevaMarineSample', name: 'AvevaMarineSample', notes: 'Marine' },
    ]));

    const { switchProjectById, currentProject } = useModelProjects();
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

    const { switchProjectById } = useModelProjects();
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
      { id: 'ams-model', name: 'AvevaMarineSample', notes: 'Test AMS' },
    ]));

    const { switchProjectById, currentProject } = useModelProjects();
    await flushPromises();

    expect(currentProject.value?.id).toBe('ams-model');

    const result = switchProjectById('AvevaMarineSample');
    expect(result).toBe(false);
    expect(currentProject.value?.path).toBe('AvevaMarineSample');
  });

  it('switchProjectById matches project by id or path for embed URLs', async () => {
    fetchMock.mockResolvedValue(buildProjectsResponse([
      { id: 'ams-model', name: 'AvevaMarineSample', notes: 'Test AMS', show_dbnum: 7997 },
      { id: 'other-project', name: 'OtherPath', notes: 'Other project' },
    ]));

    const { switchProjectById, currentProject } = useModelProjects();
    await flushPromises();

    expect(currentProject.value?.id).toBe('ams-model');

    // Test matching by path (when project_id in URL is actually a path value)
    let result = switchProjectById('AvevaMarineSample');
    expect(result).toBe(false);
    expect(currentProject.value?.path).toBe('AvevaMarineSample');

    // Test matching by id
    result = switchProjectById('other-project');
    expect(result).toBe(true);
    expect(currentProject.value?.id).toBe('other-project');
  });

  it('falls back cleanly when project loading fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const { currentProject, projects, isLoading } = useModelProjects();
    await flushPromises();

    expect(isLoading.value).toBe(false);
    expect(projects.value).toHaveLength(1);
    expect(currentProject.value?.path).toBe('AvevaMarineSample');
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

