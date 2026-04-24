import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import ReleaseNotesDialog from './ReleaseNotesDialog.vue';

import { emitCommand } from '@/ribbon/commandBus';

function mount(component: ReturnType<typeof createApp>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  component.mount(host);
  return { host, unmount: () => component.unmount() };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ReleaseNotesDialog', () => {
  it('收到 help.releaseNotes 命令后应打开并展示 changelog 内容', async () => {
    const app = createApp({
      render: () => h(ReleaseNotesDialog),
    });

    const { unmount } = mount(app);

    emitCommand('help.releaseNotes');
    await nextTick();
    await nextTick();

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('更新说明');
    expect(dialog?.textContent).toContain('当前版本');
    expect(dialog?.textContent).toMatch(/2026-04-\d{2}|Unreleased/);

    unmount();
  });
});
