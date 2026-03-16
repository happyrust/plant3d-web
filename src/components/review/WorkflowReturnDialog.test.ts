import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';

import WorkflowReturnDialog from './WorkflowReturnDialog.vue';

function mount(component: ReturnType<typeof createApp>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  component.mount(host);
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('WorkflowReturnDialog', () => {
  it('renders target node, required reason input, and disabled confirm button when empty', async () => {
    mount(
      createApp({
        render: () =>
          h(WorkflowReturnDialog, {
            visible: true,
            currentNode: 'jd',
          }),
      })
    );

    await nextTick();

    expect(document.body.textContent).toContain('驳回到指定节点');
    expect(document.body.textContent).toContain('目标节点');
    expect(document.body.textContent).toContain('编制');
    expect(document.body.textContent).toContain('驳回原因输入（必填）');

    const reasonInput = document.body.querySelector('[data-testid="workflow-return-reason"]') as HTMLTextAreaElement | null;
    const confirmButton = document.body.querySelector('[data-testid="workflow-return-confirm"]') as HTMLButtonElement | null;

    expect(reasonInput?.getAttribute('placeholder')).toBe('请输入驳回原因（必填）');
    expect(confirmButton?.disabled).toBe(true);
    expect(document.body.textContent).toContain('驳回原因为必填项');
  });

  it('enables confirm after entering a trimmed reason and resets after reopen', async () => {
    const visible = ref(true);
    const emitted: { targetNode: string; reason: string }[] = [];

    mount(
      createApp({
        setup() {
          return { visible };
        },
        render() {
          return h(WorkflowReturnDialog, {
            visible: this.visible,
            currentNode: 'sh',
            'onUpdate:visible': (value: boolean) => {
              this.visible = value;
            },
            onConfirm: (targetNode: string, reason: string) => {
              emitted.push({ targetNode, reason });
            },
          });
        },
      })
    );

    await nextTick();

    const targetButtons = Array.from(document.body.querySelectorAll('button')).filter((button) => button.textContent?.includes('校核'));
    const reviewTargetButton = targetButtons[0] as HTMLButtonElement | undefined;
    reviewTargetButton?.click();
    await nextTick();

    const reasonInput = document.body.querySelector('[data-testid="workflow-return-reason"]') as HTMLTextAreaElement;
    reasonInput.value = '  退回设计补充依据  ';
    reasonInput.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    const confirmButton = document.body.querySelector('[data-testid="workflow-return-confirm"]') as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(false);

    confirmButton.click();
    await nextTick();

    expect(emitted).toEqual([{ targetNode: 'jd', reason: '退回设计补充依据' }]);

    visible.value = false;
    await nextTick();
    visible.value = true;
    await nextTick();

    const reopenedInput = document.body.querySelector('[data-testid="workflow-return-reason"]') as HTMLTextAreaElement;
    const reopenedConfirm = document.body.querySelector('[data-testid="workflow-return-confirm"]') as HTMLButtonElement;

    expect(reopenedInput.value).toBe('');
    expect(reopenedConfirm.disabled).toBe(true);
    expect(document.body.textContent).toContain('编制');
  });
});
