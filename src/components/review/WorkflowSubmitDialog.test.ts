import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';

import WorkflowSubmitDialog from './WorkflowSubmitDialog.vue';

function mount(component: ReturnType<typeof createApp>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  component.mount(host);
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('WorkflowSubmitDialog', () => {
  it('renders current node, target node, optional comment input, and action buttons when open', async () => {
    mount(
      createApp({
        render: () =>
          h(WorkflowSubmitDialog, {
            visible: true,
            currentNode: 'jd',
            targetNode: 'sh',
          }),
      })
    );

    await nextTick();

    expect(document.body.textContent).toContain('确认提交流转');
    expect(document.body.textContent).toContain('当前环节');
    expect(document.body.textContent).toContain('校对');
    expect(document.body.textContent).toContain('下一环节');
    expect(document.body.textContent).toContain('审核');

    const commentInput = document.body.querySelector('[data-testid="workflow-submit-comment"]') as HTMLTextAreaElement | null;

    expect(commentInput?.getAttribute('placeholder')).toContain('请输入需要提醒后续审核人员注意事项');
    expect(document.body.textContent).toContain('流转备注 (选填)');
    expect(document.body.textContent).toContain('取消');
    expect(document.body.textContent).toContain('确认提交流转');
  });

  it('emits trimmed comment and clears the field after closing and reopening', async () => {
    const visible = ref(true);
    const emittedComments: (string | undefined)[] = [];

    mount(
      createApp({
        setup() {
          return { visible };
        },
        render() {
          return h(WorkflowSubmitDialog, {
            visible: this.visible,
            currentNode: 'sj',
            targetNode: 'jd',
            'onUpdate:visible': (value: boolean) => {
              this.visible = value;
            },
            onConfirm: (comment?: string) => {
              emittedComments.push(comment);
            },
          });
        },
      })
    );

    await nextTick();

    const commentInput = document.body.querySelector('[data-testid="workflow-submit-comment"]') as HTMLTextAreaElement;
    commentInput.value = '  ready for next step  ' ;
    commentInput.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    const confirmButton = document.body.querySelector('[data-testid="workflow-submit-confirm"]') as HTMLButtonElement;
    confirmButton.click();
    await nextTick();

    expect(emittedComments).toEqual(['ready for next step']);

    visible.value = false;
    await nextTick();
    visible.value = true;
    await nextTick();

    const reopenedInput = document.body.querySelector('[data-testid="workflow-submit-comment"]') as HTMLTextAreaElement;
    expect(reopenedInput.value).toBe('');
  });
});
