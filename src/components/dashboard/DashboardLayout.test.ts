import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';

const selectProjectMock = vi.fn();

vi.mock('./DashboardOverview.vue', () => ({
  default: defineComponent({
    emits: ['navigate', 'select'],
    setup(_, { emit }) {
      return () =>
        h('section', { 'data-testid': 'dashboard-overview' }, [
          h('button', {
            type: 'button',
            'data-testid': 'overview-navigate-projects',
            onClick: () => emit('navigate', 'projects'),
          }, 'Go to projects'),
          h('button', {
            type: 'button',
            'data-testid': 'overview-select-project',
            onClick: () => emit('select', 'project-from-overview'),
          }, 'Select project'),
        ]);
    },
  }),
}));

vi.mock('@/components/dashboard/DashboardReviewsPanel.vue', () => ({
  default: defineComponent({
    setup() {
      return () => h('section', { 'data-testid': 'dashboard-reviews-panel' }, 'Reviews panel');
    },
  }),
}));

vi.mock('@/components/model-project/ProjectCardList.vue', () => ({
  default: defineComponent({
    emits: ['select'],
    setup(_, { emit }) {
      return () =>
        h('section', { 'data-testid': 'project-card-list' }, [
          h('button', {
            type: 'button',
            'data-testid': 'project-list-select',
            onClick: () => emit('select', 'project-from-list'),
          }, 'Open project'),
        ]);
    },
  }),
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({
    currentUser: ref({
      id: 'reviewer_001',
      name: '李审核员',
    }),
  }),
}));

vi.mock('@/composables/useModelProjects', () => ({
  useModelProjects: () => ({
    selectProject: selectProjectMock,
  }),
}));

import DashboardLayout from './DashboardLayout.vue';

function mountDashboardLayout(onSelect = vi.fn()) {
  const host = document.createElement('div');
  document.body.appendChild(host);

  const app = createApp({
    render: () => h(DashboardLayout, { onSelect }),
  });

  app.mount(host);

  return {
    app,
    host,
    onSelect,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

beforeEach(() => {
  selectProjectMock.mockReset();
});

describe('DashboardLayout', () => {
  it('renders the desktop shell with a 280px sidebar and dashboard content by default', () => {
    const { host } = mountDashboardLayout();

    const root = host.firstElementChild as HTMLElement | null;
    const sidebar = host.querySelector('aside');
    const navButtons = sidebar?.querySelectorAll('button') ?? [];

    expect(root?.className).toContain('bg-[#F3F4F6]');
    expect(sidebar?.className).toContain('w-[280px]');
    expect(sidebar?.textContent).toContain('Plant3D Web');
    expect(navButtons).toHaveLength(3);
    expect(Array.from(navButtons, (button) => button.textContent?.trim())).toEqual([
      '首页 (Dashboard)',
      '模型工程',
      '校审批注',
    ]);
    expect(host.querySelector('[data-testid="dashboard-overview"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="project-card-list"]')).toBeNull();
    expect(host.querySelector('[data-testid="dashboard-reviews-panel"]')).toBeNull();
  });

  it('renders the top bar title, utility icons, and current user avatar', () => {
    const { host } = mountDashboardLayout();

    const header = host.querySelector('header');
    const title = header?.querySelector('h1');
    const searchButton = host.querySelector('button[aria-label="搜索"]');
    const notificationButton = host.querySelector('button[aria-label="通知"]');
    const avatar = header?.querySelector('div[aria-label="李审核员"]');

    expect(header?.className).toContain('h-20');
    expect(title?.textContent).toBe('概览');
    expect(searchButton).toBeTruthy();
    expect(notificationButton).toBeTruthy();
    expect(notificationButton?.querySelector('span')?.className).toContain('bg-blue-500');
    expect(avatar?.textContent).toBe('李');
    expect(avatar?.className).toContain('h-9');
    expect(avatar?.className).toContain('w-9');
  });

  it('switches the active page and highlight when clicking navigation items', async () => {
    const { host } = mountDashboardLayout();
    const navButtons = host.querySelectorAll('aside button');

    expect(navButtons[0]?.className).toContain('bg-[#EFF6FF]');
    expect(host.querySelector('header h1')?.textContent).toBe('概览');

    (navButtons[1] as HTMLButtonElement).click();
    await nextTick();

    expect(navButtons[0]?.className).not.toContain('bg-[#EFF6FF]');
    expect(navButtons[1]?.className).toContain('bg-[#EFF6FF]');
    expect(host.querySelector('header h1')?.textContent).toBe('模型工程');
    expect(host.querySelector('[data-testid="project-card-list"]')).toBeTruthy();

    (navButtons[2] as HTMLButtonElement).click();
    await nextTick();

    expect(navButtons[2]?.className).toContain('bg-[#EFF6FF]');
    expect(host.querySelector('header h1')?.textContent).toBe('校审批注');
    expect(host.querySelector('[data-testid="dashboard-reviews-panel"]')).toBeTruthy();
  });

  it('handles child content navigation and selects projects from page content', async () => {
    const { host } = mountDashboardLayout();

    (host.querySelector('[data-testid="overview-navigate-projects"]') as HTMLButtonElement).click();
    await nextTick();

    expect(host.querySelector('header h1')?.textContent).toBe('模型工程');
    expect(host.querySelector('[data-testid="project-card-list"]')).toBeTruthy();

    (host.querySelector('aside button') as HTMLButtonElement).click();
    await nextTick();

    (host.querySelector('[data-testid="overview-select-project"]') as HTMLButtonElement).click();
    await nextTick();

    expect(selectProjectMock).toHaveBeenCalledWith('project-from-overview');
    expect(host.querySelector('header h1')?.textContent).toBe('模型工程');
    expect(host.querySelector('[data-testid="project-card-list"]')).toBeTruthy();

    (host.querySelectorAll('aside button')[1] as HTMLButtonElement).click();
    await nextTick();

    (host.querySelector('[data-testid="project-list-select"]') as HTMLButtonElement).click();
    await nextTick();

    expect(selectProjectMock).toHaveBeenLastCalledWith('project-from-list');
  });
});
