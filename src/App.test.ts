import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';

const {
  authVerifyTokenMock,
  loadProjectsMock,
  switchProjectByIdMock,
} = vi.hoisted(() => ({
  authVerifyTokenMock: vi.fn(),
  loadProjectsMock: vi.fn(),
  switchProjectByIdMock: vi.fn(),
}));

const currentProjectRef = ref<null | { id: string; path: string }>(null);
const projectsRef = ref<{ id: string; path: string }[]>([]);

vi.mock('@/api/reviewApi', () => ({
  authVerifyToken: (...args: unknown[]) => authVerifyTokenMock(...args),
}));

vi.mock('@/components/dashboard/DashboardLayout.vue', () => ({
  default: defineComponent({
    name: 'DashboardLayoutStub',
    setup() {
      return () => h('section', { 'data-testid': 'dashboard-layout-stub' }, 'dashboard');
    },
  }),
}));

vi.mock('@/components/DockLayout.vue', () => ({
  default: defineComponent({
    name: 'DockLayoutStub',
    setup() {
      return () => h('section', { 'data-testid': 'dock-layout-stub' }, 'dock');
    },
  }),
}));

vi.mock('@/components/AboutDialog.vue', () => ({
  default: defineComponent({
    setup() {
      return () => h('div');
    },
  }),
}));

vi.mock('@/components/ReleaseNotesDialog.vue', () => ({
  default: defineComponent({
    setup() {
      return () => h('div');
    },
  }),
}));

vi.mock('@/components/onboarding/OnboardingOverlay.vue', () => ({
  default: defineComponent({
    setup() {
      return () => h('div');
    },
  }),
}));

vi.mock('@/components/onboarding/ReviewGuideCenter.vue', () => ({
  default: defineComponent({
    setup() {
      return () => h('div');
    },
  }),
}));

vi.mock('@/components/ribbon/HierarchicalMenuBar.vue', () => ({
  default: defineComponent({
    setup(_, { slots }) {
      return () => h('div', {}, slots['header-right']?.());
    },
  }),
}));

vi.mock('@/components/ui/ConfirmDialog.vue', () => ({
  default: defineComponent({
    setup() {
      return () => h('div');
    },
  }),
}));

vi.mock('@/components/ui/LayoutToggleButtons.vue', () => ({
  default: defineComponent({
    setup() {
      return () => h('div');
    },
  }),
}));

vi.mock('@/components/user/UserAvatar.vue', () => ({
  default: defineComponent({
    setup() {
      return () => h('div');
    },
  }),
}));

vi.mock('@/composables/useOnboardingGuide', () => ({
  useOnboardingGuide: () => ({
    openGuideCenter: vi.fn(),
    autoStartIfNeeded: vi.fn(),
  }),
}));

vi.mock('@/composables/useModelProjects', () => ({
  useModelProjects: () => ({
    currentProject: currentProjectRef,
    projects: projectsRef,
    loadProjects: loadProjectsMock,
    switchProjectById: switchProjectByIdMock,
  }),
}));

import App from './App.vue';

async function flushView() {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

function mountApp() {
  const host = document.createElement('div');
  document.body.appendChild(host);

  const app = createApp(App);
  const passthrough = (name: string) =>
    defineComponent({
      name,
      setup(_, { slots, attrs }) {
        return () => h('div', attrs, slots.default?.());
      },
    });
  app.component('VApp', passthrough('VAppStub'));
  app.component('VMain', passthrough('VMainStub'));
  app.component('VAppBar', passthrough('VAppBarStub'));
  app.component('VBtn', passthrough('VBtnStub'));
  app.component('VIcon', passthrough('VIconStub'));
  app.component('BenchmarkView', passthrough('BenchmarkViewStub'));
  app.mount(host);

  return { app, host };
}

describe('App embed bootstrap', () => {
  beforeEach(() => {
    currentProjectRef.value = null;
    projectsRef.value = [];
    authVerifyTokenMock.mockReset();
    loadProjectsMock.mockReset();
    switchProjectByIdMock.mockReset();
    loadProjectsMock.mockResolvedValue(undefined);
    switchProjectByIdMock.mockImplementation((projectId: string) => {
      if (projectId === 'PROJECT-CLAIMS') {
        currentProjectRef.value = { id: projectId, path: projectId };
        return true;
      }
      return false;
    });
    window.history.replaceState({}, '', '/?user_token=jwt-app-token');
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('在 token-only 嵌入模式下会先按 verified claims.project_id 自动选项目，再进入 DockLayout', async () => {
    authVerifyTokenMock.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        valid: true,
        claims: {
          projectId: 'PROJECT-CLAIMS',
          userId: 'designer-1',
          formId: 'FORM-CLAIMS-1',
          role: 'sj',
          workflowMode: 'external',
          exp: 1999999999,
          iat: 1700000000,
        },
      },
    });

    const { host } = mountApp();
    await flushView();

    expect(authVerifyTokenMock).toHaveBeenCalledWith('jwt-app-token', undefined);
    expect(loadProjectsMock).toHaveBeenCalledTimes(1);
    expect(switchProjectByIdMock).toHaveBeenCalledWith('PROJECT-CLAIMS');
    expect(host.querySelector('[data-testid="dock-layout-stub"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="dashboard-layout-stub"]')).toBeNull();
  });

  it('若 loadProjects 已按 output_project 预选当前项目，则不会误报 project_id 未命中', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    authVerifyTokenMock.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        valid: true,
        claims: {
          projectId: 'AvevaMarineSample',
          userId: 'designer-1',
          formId: 'FORM-CLAIMS-1',
          role: 'sj',
          workflowMode: 'external',
          exp: 1999999999,
          iat: 1700000000,
        },
      },
    });
    projectsRef.value = [{ id: 'projects:sample', path: 'AvevaMarineSample' }];
    loadProjectsMock.mockImplementation(async () => {
      currentProjectRef.value = { id: 'projects:sample', path: 'AvevaMarineSample' };
    });
    switchProjectByIdMock.mockReturnValue(false);

    mountApp();
    await flushView();

    expect(warnSpy).not.toHaveBeenCalledWith(
      '[App] 嵌入模式 project_id 未命中项目列表:',
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it('只要 URL 带 output_project，就不会回退到项目选择页', async () => {
    window.history.replaceState({}, '', '/?output_project=AvevaMarineSample');

    const { host } = mountApp();
    await flushView();

    expect(host.querySelector('[data-testid="dashboard-layout-stub"]')).toBeNull();
    expect(host.querySelector('[data-testid="dock-layout-stub"]')).toBeTruthy();
  });

  it('output_project 已选中时，token claims.project_id 不一致只告警不覆盖当前项目', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.history.replaceState(
      {},
      '',
      '/?output_project=AvevaMarineSample&user_token=jwt-app-token',
    );
    currentProjectRef.value = { id: 'projects:sample', path: 'AvevaMarineSample' };
    authVerifyTokenMock.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        valid: true,
        claims: {
          projectId: 'AnotherProject',
          userId: 'designer-1',
          formId: 'FORM-CLAIMS-1',
          role: 'sj',
          workflowMode: 'external',
          exp: 1999999999,
          iat: 1700000000,
        },
      },
    });

    mountApp();
    await flushView();

    expect(switchProjectByIdMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[App] output_project 与 token claims.project_id 不一致，保留 output_project 直达:',
      {
        outputProject: 'AvevaMarineSample',
        projectId: 'AnotherProject',
      },
    );
    warnSpy.mockRestore();
  });

  it('主工作区使用可收缩的 v-main flex，避免嵌入 iframe 时高度溢出', async () => {
    authVerifyTokenMock.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        valid: true,
        claims: {
          projectId: 'PROJECT-CLAIMS',
          userId: 'designer-1',
          formId: 'FORM-CLAIMS-1',
          role: 'sj',
          workflowMode: 'external',
          exp: 1999999999,
          iat: 1700000000,
        },
      },
    });

    const { host } = mountApp();
    await flushView();

    const mainShell = Array.from(host.querySelectorAll('div')).find((node) =>
      node.className.includes('d-flex')
      && node.className.includes('flex-row')
    );

    expect(mainShell).toBeTruthy();
    const style = mainShell?.getAttribute('style') || '';
    expect(style).toContain('flex-grow: 1');
    expect(style).toContain('flex-shrink: 1');
    expect(style).toContain('flex-basis: auto');
  });
});
