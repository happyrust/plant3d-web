import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import DimensionToolbar from './DimensionToolbar.vue';

const emitCommand = vi.hoisted(() => vi.fn());

vi.mock('@/ribbon/commandBus', () => ({ emitCommand }));

afterEach(() => {
  document.body.innerHTML = '';
  emitCommand.mockClear();
});

describe('DimensionToolbar', () => {
  it('emits all four named creation commands', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    createApp({ render: () => h(DimensionToolbar) }).mount(host);
    await nextTick();

    for (const command of [
      'dimension.create.linear',
      'dimension.create.projected',
      'dimension.create.angular',
      'dimension.create.radial',
    ]) {
      (document.querySelector(`[data-testid="${command}"]`) as HTMLButtonElement).click();
    }

    expect(emitCommand.mock.calls.map(([command]) => command)).toEqual([
      'dimension.create.linear',
      'dimension.create.projected',
      'dimension.create.angular',
      'dimension.create.radial',
    ]);
  });

  it('keeps undo and redo disabled until the document allows them', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    createApp({
      render: () => h(DimensionToolbar, { canUndo: false, canRedo: true }),
    }).mount(host);
    await nextTick();

    expect((document.querySelector('[data-testid="dimension.undo"]') as HTMLButtonElement).disabled).toBe(true);
    expect((document.querySelector('[data-testid="dimension.redo"]') as HTMLButtonElement).disabled).toBe(false);
  });
});
