import { describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';

vi.mock('@/components/review/ReviewPanel.vue', () => ({
  default: defineComponent({
    name: 'ReviewPanelStub',
    props: {
      density: { type: String, default: 'normal' },
    },
    setup(props) {
      return () => h('div', {
        'data-testid': 'review-panel-stub',
        'data-density': props.density,
      });
    },
  }),
}));

describe('ReviewPanelDock', () => {
  it('固定使用 Dock 紧凑密度', async () => {
    const { default: ReviewPanelDock } = await import('./ReviewPanelDock.vue');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp({ render: () => h(ReviewPanelDock) });

    app.mount(host);

    expect(host.querySelector('[data-testid="review-panel-stub"]')?.getAttribute('data-density')).toBe('dock');

    app.unmount();
    host.remove();
  });
});
