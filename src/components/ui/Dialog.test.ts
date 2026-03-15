import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';

import Dialog from './Dialog.vue';

declare global {
  type DialogTestWindow = Window & {
    __dialogScrollLockTestReset__?: () => void;
    __dialogScrollLockState__?: {
      count: number;
      lockedOverflow: string;
      activeIds: Set<string>;
    };
  };
}

function mount(component: ReturnType<typeof createApp>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  component.mount(host);
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
  document.body.style.overflow = '';
  (window as DialogTestWindow).__dialogScrollLockTestReset__?.();
});

describe('Dialog', () => {
  it('renders overlay, title and slots when open', async () => {
    const host = mount(
      createApp({
        render: () =>
          h(Dialog, { open: true, title: 'Review task' }, {
            default: () => h('p', { 'data-testid': 'body' }, 'Dialog content'),
            footer: () => h('button', { 'data-testid': 'footer' }, 'Confirm'),
          }),
      })
    );

    await nextTick();

    const overlay = document.body.querySelector('[data-testid="dialog-overlay"]');
    const panel = document.body.querySelector('[role="dialog"]');

    expect(host.innerHTML).toContain('teleport');
    expect(overlay?.className).toContain('bg-black/50');
    expect(panel?.className).toContain('rounded-[12px]');
    expect(panel?.textContent).toContain('Review task');
    expect(document.body.querySelector('[data-testid="body"]')?.textContent).toBe('Dialog content');
    expect(document.body.querySelector('[data-testid="footer"]')?.textContent).toBe('Confirm');
  });

  it('binds aria-labelledby to the rendered title heading for title prop and title slot', async () => {
    mount(
      createApp({
        render: () =>
          h('div', [
            h(Dialog, { open: true, title: 'Prop title' }, {
              default: () => 'Prop content',
            }),
            h(Dialog, { open: true }, {
              title: ({ titleId }: { titleId: string }) => h('h3', { id: titleId }, 'Slotted title'),
              default: () => 'Slot content',
            }),
          ]),
      })
    );

    await nextTick();

    const dialogs = Array.from(document.body.querySelectorAll('[role="dialog"]'));
    const propDialog = dialogs[0];
    const slotDialog = dialogs[1];
    const propHeading = propDialog?.querySelector('h2');
    const slottedHeading = slotDialog?.querySelector('h3');

    expect(propHeading?.id).toBeTruthy();
    expect(propDialog?.getAttribute('aria-labelledby')).toBe(propHeading?.id ?? null);
    expect(propDialog?.hasAttribute('aria-label')).toBe(false);

    expect(slottedHeading?.id).toBeTruthy();
    expect(slotDialog?.getAttribute('aria-labelledby')).toBe(slottedHeading?.id ?? null);
    expect(slotDialog?.hasAttribute('aria-label')).toBe(false);
  });

  it('supports v-model:open updates from overlay and close button', async () => {
    const open = ref(true);
    const host = mount(
      createApp({
        setup() {
          return { open };
        },
        render() {
          return h(Dialog, {
            open: this.open,
            title: 'Closable',
            'onUpdate:open': (value: boolean) => {
              this.open = value;
            },
          }, {
            default: () => 'Closable content',
          });
        },
      })
    );

    await nextTick();

    const overlay = document.body.querySelector('[data-testid="dialog-overlay"]') as HTMLDivElement | null;
    overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(open.value).toBe(false);

    open.value = true;
    await nextTick();

    const closeButton = document.body.querySelector('[data-testid="dialog-close"]') as HTMLButtonElement | null;
    closeButton?.click();
    await nextTick();

    expect(open.value).toBe(false);
    expect(host.innerHTML).toContain('teleport');
  });

  it('does not close from overlay when persistent', async () => {
    const onUpdate = vi.fn();

    mount(
      createApp({
        render: () =>
          h(Dialog, {
            open: true,
            persistent: true,
            'onUpdate:open': onUpdate,
          }, {
            default: () => 'Persistent content',
          }),
      })
    );

    const overlay = document.body.querySelector('[data-testid="dialog-overlay"]') as HTMLDivElement | null;
    overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(onUpdate).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('locks and restores body scroll while open state changes', async () => {
    const open = ref(false);
    document.body.style.overflow = 'auto';

    mount(
      createApp({
        setup() {
          return { open };
        },
        render() {
          return h(Dialog, {
            open: this.open,
            'onUpdate:open': (value: boolean) => {
              this.open = value;
            },
          }, {
            default: () => 'Scroll lock content',
          });
        },
      })
    );

    await nextTick();
    expect(document.body.style.overflow).toBe('auto');

    open.value = true;
    await nextTick();
    expect(document.body.style.overflow).toBe('hidden');

    open.value = false;
    await nextTick();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('keeps body scroll locked while any dialog remains open and restores it after the last close', async () => {
    const firstOpen = ref(true);
    const secondOpen = ref(false);
    document.body.style.overflow = 'scroll';

    mount(
      createApp({
        setup() {
          return { firstOpen, secondOpen };
        },
        render() {
          return h('div', [
            h(Dialog, {
              open: this.firstOpen,
              'onUpdate:open': (value: boolean) => {
                this.firstOpen = value;
              },
            }, {
              default: () => 'First dialog',
            }),
            h(Dialog, {
              open: this.secondOpen,
              'onUpdate:open': (value: boolean) => {
                this.secondOpen = value;
              },
            }, {
              default: () => 'Second dialog',
            }),
          ]);
        },
      })
    );

    await nextTick();
    expect(document.body.style.overflow).toBe('hidden');

    secondOpen.value = true;
    await nextTick();
    expect(document.body.style.overflow).toBe('hidden');

    firstOpen.value = false;
    await nextTick();
    expect(document.body.style.overflow).toBe('hidden');

    secondOpen.value = false;
    await nextTick();
    expect(document.body.style.overflow).toBe('scroll');
  });
});
