import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import HierarchicalMenuBar from './HierarchicalMenuBar.vue';

const emitCommand = vi.fn();

vi.mock('@/ribbon/commandBus', () => ({
  emitCommand: (commandId: string) => emitCommand(commandId),
}));

vi.mock('vuetify/components', () => ({
  VSnackbar: {
    name: 'VSnackbar',
    props: ['modelValue', 'timeout'],
    template: '<div data-testid="v-snackbar"><slot /></div>',
  },
}));

describe('HierarchicalMenuBar', () => {
  beforeEach(() => {
    emitCommand.mockReset();
  });

  it('opens a tab and dispatches commands from the hierarchical dropdown', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    createApp({
      render: () => h(HierarchicalMenuBar),
    }).mount(host);

    const reviewTab = host.querySelector('[data-hierarchical-tab="review"] button') as HTMLButtonElement | null;
    expect(reviewTab).toBeTruthy();

    reviewTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    const reviewCommand = host.querySelector('[data-command="review.start"]') as HTMLButtonElement | null;
    expect(reviewCommand).toBeTruthy();

    reviewCommand?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(emitCommand).toHaveBeenCalledWith('review.start');
  });
});
