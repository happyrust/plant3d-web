import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';

import HierarchicalMenuBar from './HierarchicalMenuBar.vue';

const emitCommand = vi.fn();

vi.mock('@/ribbon/commandBus', () => ({
  emitCommand: (commandId: string) => emitCommand(commandId),
}));

function mountMenu(host: HTMLDivElement) {
  const app = createApp({
    render: () => h(HierarchicalMenuBar),
  });
  app.component('VSnackbar', defineComponent({
    name: 'VSnackbarStub',
    setup(_, { slots }) {
      return () => h('div', { 'data-testid': 'v-snackbar' }, slots.default?.());
    },
  }));
  app.mount(host);
}

describe('HierarchicalMenuBar', () => {
  beforeEach(() => {
    emitCommand.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('opens a tab and dispatches commands from the hierarchical dropdown', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mountMenu(host);

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

  it('帮助菜单应包含更新说明命令', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mountMenu(host);

    const helpTab = host.querySelector('[data-hierarchical-tab="help"] button') as HTMLButtonElement | null;
    expect(helpTab).toBeTruthy();

    helpTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    const releaseNotesCommand = host.querySelector('[data-command="help.releaseNotes"]') as HTMLButtonElement | null;
    expect(releaseNotesCommand).toBeTruthy();

    releaseNotesCommand?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(emitCommand).toHaveBeenCalledWith('help.releaseNotes');
  });

  it('keeps the dropdown open while the pointer moves from tab trigger into dropdown content', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mountMenu(host);

    const reviewTab = host.querySelector('[data-hierarchical-tab="review"]') as HTMLDivElement | null;
    expect(reviewTab).toBeTruthy();

    reviewTab?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await nextTick();

    let dropdown = host.querySelector('.hierarchical-menu-dropdown') as HTMLDivElement | null;
    expect(dropdown).toBeTruthy();

    reviewTab?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    await nextTick();

    dropdown = host.querySelector('.hierarchical-menu-dropdown') as HTMLDivElement | null;
    expect(dropdown).toBeTruthy();

    dropdown?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await nextTick();

    vi.advanceTimersByTime(150);
    await nextTick();

    dropdown = host.querySelector('.hierarchical-menu-dropdown') as HTMLDivElement | null;
    expect(dropdown).toBeTruthy();

    dropdown?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    vi.advanceTimersByTime(150);
    await nextTick();

    dropdown = host.querySelector('.hierarchical-menu-dropdown') as HTMLDivElement | null;
    expect(dropdown).toBeNull();
  });

  it('pins the dropdown open after click and closes on outside pointerdown', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const outside = document.createElement('div');
    document.body.appendChild(outside);

    mountMenu(host);

    const reviewTabButton = host.querySelector('[data-hierarchical-tab="review"] button') as HTMLButtonElement | null;
    expect(reviewTabButton).toBeTruthy();

    reviewTabButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    let dropdown = host.querySelector('.hierarchical-menu-dropdown') as HTMLDivElement | null;
    expect(dropdown).toBeTruthy();

    const reviewTab = host.querySelector('[data-hierarchical-tab="review"]') as HTMLDivElement | null;
    reviewTab?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    vi.advanceTimersByTime(150);
    await nextTick();

    dropdown = host.querySelector('.hierarchical-menu-dropdown') as HTMLDivElement | null;
    expect(dropdown).toBeTruthy();

    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await nextTick();

    dropdown = host.querySelector('.hierarchical-menu-dropdown') as HTMLDivElement | null;
    expect(dropdown).toBeNull();
  });

  it('closes a pinned dropdown when Escape is pressed', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mountMenu(host);

    const reviewTabButton = host.querySelector('[data-hierarchical-tab="review"] button') as HTMLButtonElement | null;
    expect(reviewTabButton).toBeTruthy();

    reviewTabButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    let dropdown = host.querySelector('.hierarchical-menu-dropdown') as HTMLDivElement | null;
    expect(dropdown).toBeTruthy();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();

    dropdown = host.querySelector('.hierarchical-menu-dropdown') as HTMLDivElement | null;
    expect(dropdown).toBeNull();
  });
});
