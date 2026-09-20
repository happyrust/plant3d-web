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

/** gen-model `/api/v1/health` 的最小回包：一个服务进程只服务一个项目。 */
const buildHealthResponse = (project: string | null, mdb = '/ALL'): Response => ({
  ok: true,
  status: 200,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => ({
    status: 'ok',
    ...(project ? { project, mdb } : {}),
  }),
  text: async () => JSON.stringify({ status: 'ok', ...(project ? { project, mdb } : {}) }),
} as Response);

describe('useModelProjects（gen-model-v1：/api/v1/health 的单项目）', () => {
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

  it('不带参数：进 health 答出的那个项目，id / path 都是项目名', async () => {
    fetchMock.mockResolvedValue(buildHealthResponse('AvevaMarineSample'));

    const { currentProject, projects } = await createModelProjects();
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/health');
    expect(projects.value.map((p) => p.path)).toEqual(['AvevaMarineSample']);
    expect(currentProject.value).toMatchObject({ id: 'AvevaMarineSample', path: 'AvevaMarineSample', description: 'MDB /ALL' });
    expect(new URLSearchParams(window.location.search).get('output_project')).toBe('AvevaMarineSample');
  });

  it('switchProjectById：命中同名项目不重复切换、不发事件；没有的项目回 false', async () => {
    fetchMock.mockResolvedValue(buildHealthResponse('AvevaMarineSample'));

    const { switchProjectById, currentProject } = await createModelProjects();
    await flushPromises();

    const eventSpy = vi.fn();
    window.addEventListener('modelProjectChanged', eventSpy);
    expect(switchProjectById('AvevaMarineSample')).toBe(false);
    expect(eventSpy).not.toHaveBeenCalled();
    expect(switchProjectById('non-existent-project')).toBe(false);
    expect(currentProject.value?.id).toBe('AvevaMarineSample');
    window.removeEventListener('modelProjectChanged', eventSpy);
  });

  it('project_id 与服务项目名一致时直接命中（PMS 登记的 project_id 就是项目名）', async () => {
    window.history.replaceState({}, '', '/?project_id=AvevaMarineSample');
    fetchMock.mockResolvedValue(buildHealthResponse('AvevaMarineSample'));

    const { currentProject } = await createModelProjects();
    await flushPromises();

    expect(currentProject.value?.path).toBe('AvevaMarineSample');
    expect(currentProject.value?.id).toBe('AvevaMarineSample');
  });

  it('project_id 不匹配也只能进服务端唯一的那个项目', async () => {
    window.history.replaceState({}, '', '/?project_id=legacy-project-path');
    fetchMock.mockResolvedValue(buildHealthResponse('AvevaMarineSample'));

    const { currentProject, projects } = await createModelProjects();
    await flushPromises();

    expect(projects.value).toHaveLength(1);
    expect(currentProject.value?.path).toBe('AvevaMarineSample');
  });

  it('health 没答出项目名时落默认 AvevaMarineSample', async () => {
    fetchMock.mockResolvedValue(buildHealthResponse(null));

    const { currentProject, projects } = await createModelProjects();
    await flushPromises();

    expect(projects.value).toHaveLength(1);
    expect(currentProject.value?.path).toBe('AvevaMarineSample');
    expect(currentProject.value?.default).toBe(true);
  });

  it('后端不可达：落默认工程、isLoading 复位、记一条 console.error', async () => {
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

  it('并发 loadProjects 合并成一次请求', async () => {
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

    resolveFetch!(buildHealthResponse('ProjOne'));
    await Promise.all([extraA, extraB]);
    await flushPromises();

    expect(projects.value.map((p) => p.path)).toEqual(['ProjOne']);
    expect(currentProject.value?.path).toBe('ProjOne');
  });

  it('URL 指定 output_project 与服务项目不同：仍保留 URL 指定的为当前工程', async () => {
    window.history.replaceState({}, '', '/?output_project=MissingButRequested');
    fetchMock.mockResolvedValue(buildHealthResponse('AvevaMarineSample'));

    const { currentProject, projects } = await createModelProjects();
    await flushPromises();

    expect(currentProject.value?.path).toBe('MissingButRequested');
    expect(currentProject.value?.id).toBe('MissingButRequested');
    expect(projects.value.map((project) => project.path)).toContain('MissingButRequested');
  });

  it('output_project 在 health 返回前就是当前工程', async () => {
    window.history.replaceState({}, '', '/?output_project=AvevaMarineSample');
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));

    const { currentProject, projects, isLoading } = await createModelProjects();

    expect(currentProject.value?.path).toBe('AvevaMarineSample');
    expect(currentProject.value?.id).toBe('AvevaMarineSample');
    expect(projects.value.map((project) => project.path)).toContain('AvevaMarineSample');
    expect(isLoading.value).toBe(true);
  });

  it('health 失败时保留 output_project', async () => {
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
