import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';

import ReviewGuideCenter from './ReviewGuideCenter.vue';

import { emitCommand } from '@/ribbon/commandBus';

const guideMocks = vi.hoisted(() => ({
  openGuideCenter: vi.fn(),
  startGuideForCurrentRole: vi.fn(),
}));

function makeGuide(role: string) {
  return {
    role,
    title: `${role} guide`,
    description: '',
    steps: [{ id: 'start', title: 'Start', description: '', targetSelector: '[data-guide="start"]' }],
  };
}

vi.mock('@/components/ui/Dialog.vue', () => ({
  default: defineComponent({
    props: {
      open: { type: Boolean, default: false },
    },
    setup(props, { slots }) {
      return () => (props.open ? h('div', { role: 'dialog' }, slots.default?.()) : null);
    },
  }),
}));

vi.mock('@/composables/useOnboardingGuide', async () => {
  const vue = await vi.importActual<typeof import('vue')>('vue');
  const allGuides = {
    designer: makeGuide('designer'),
    proofreader: makeGuide('proofreader'),
    reviewer: makeGuide('reviewer'),
    manager: makeGuide('manager'),
  };

  return {
    useOnboardingGuide: () => ({
      guideCenterOpen: vue.ref(false),
      guideCenterTopic: vue.ref('currentRole'),
      allGuides,
      resolveCurrentGuideContext: () => ({ workflowRole: 'sh', workflowMode: 'manual', menuMode: 'hierarchical' }),
      resolveGuideForUser: () => allGuides.reviewer,
      startGuideForRole: vi.fn(),
      startGuideForCurrentRole: guideMocks.startGuideForCurrentRole,
      openGuideCenter: guideMocks.openGuideCenter,
      closeGuideCenter: vi.fn(),
    }),
  };
});

vi.mock('@/composables/useUserStore', async () => {
  const vue = await vi.importActual<typeof import('vue')>('vue');
  return {
    useUserStore: () => ({
      currentUser: vue.ref({ id: 'reviewer-1', role: 'reviewer' }),
    }),
  };
});

function mountReviewGuideCenter() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render: () => h(ReviewGuideCenter),
  });
  app.mount(host);

  return {
    unmount: () => app.unmount(),
  };
}

let unmountCurrent: (() => void) | null = null;

afterEach(() => {
  unmountCurrent?.();
  unmountCurrent = null;
  guideMocks.openGuideCenter.mockReset();
  guideMocks.startGuideForCurrentRole.mockReset();
  document.body.innerHTML = '';
});

describe('ReviewGuideCenter command entry', () => {
  it('收到 help.reviewGuide 命令后直接进入当前角色向导，不打开选择弹窗', async () => {
    const { unmount } = mountReviewGuideCenter();
    unmountCurrent = unmount;

    emitCommand('help.reviewGuide');
    await nextTick();

    expect(guideMocks.startGuideForCurrentRole).toHaveBeenCalledTimes(1);
    expect(guideMocks.openGuideCenter).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});
