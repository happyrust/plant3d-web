import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

async function mountPanel() {
  const [{ default: RenderModeSettingsPanel }, { useRenderLookStore }] = await Promise.all([
    import('./RenderModeSettingsPanel.vue'),
    import('@/composables/useRenderLookStore'),
  ]);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(RenderModeSettingsPanel);
  app.mount(host);
  await nextTick();
  return {
    host,
    store: useRenderLookStore(),
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

function q<T extends Element>(host: HTMLElement, testId: string): T {
  const el = host.querySelector(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`missing [data-testid="${testId}"]`);
  return el as T;
}

describe('RenderModeSettingsPanel', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
  });

  it('两种模式、两套预设、四个后处理开关都展示出来；默认 web 标准且 E3D 项禁用', async () => {
    const { host, unmount } = await mountPanel();

    expect(host.textContent).toContain('渲染模式');
    expect(host.textContent).toContain('web 标准');
    expect(host.textContent).toContain('E3D 外观');
    expect(host.textContent).toContain('出厂 E3D 3.1');
    expect(host.textContent).toContain('本机真机');
    for (const key of ['hlr', 'ao', 'gradient', 'aa']) {
      expect(q<HTMLInputElement>(host, `render-mode-effect-${key}`).disabled).toBe(true);
    }
    expect(q<HTMLButtonElement>(host, 'render-mode-option-pbr').getAttribute('aria-checked')).toBe('true');
    expect(q<HTMLButtonElement>(host, 'render-mode-option-sgl').getAttribute('aria-checked')).toBe('false');
    expect(q<HTMLInputElement>(host, 'render-mode-preset-e3d31-factory').disabled).toBe(true);
    expect(q<HTMLElement>(host, 'render-mode-url-hint').textContent).toBe('?dtx_look=pbr');

    unmount();
  });

  it('点 E3D 外观：store 切到 sgl 并落盘，预设 / 开关解禁，开关反映预设出厂位', async () => {
    const { host, store, unmount } = await mountPanel();

    q<HTMLButtonElement>(host, 'render-mode-option-sgl').click();
    await nextTick();

    expect(store.mode.value).toBe('sgl');
    expect(localStorage.getItem('dtx_look')).toBe('sgl');
    expect(q<HTMLButtonElement>(host, 'render-mode-option-sgl').getAttribute('aria-checked')).toBe('true');
    expect(q<HTMLInputElement>(host, 'render-mode-preset-e3d31-factory').disabled).toBe(false);
    expect(q<HTMLInputElement>(host, 'render-mode-preset-e3d31-factory').checked).toBe(true);
    for (const key of ['hlr', 'ao', 'gradient', 'aa']) {
      const input = q<HTMLInputElement>(host, `render-mode-effect-${key}`);
      expect(input.disabled).toBe(false);
      expect(input.checked).toBe(true);
    }
    expect(q<HTMLButtonElement>(host, 'render-mode-reset-preset').disabled).toBe(true);
    expect(q<HTMLElement>(host, 'render-mode-url-hint').textContent).toBe('?dtx_look=sgl&dtx_look_preset=factory');

    unmount();
  });

  it('改开关标「已改」并可一键恢复；切预设归到该预设出厂位', async () => {
    const { host, store, unmount } = await mountPanel();
    store.setMode('sgl');
    await nextTick();

    const hlr = q<HTMLInputElement>(host, 'render-mode-effect-hlr');
    hlr.checked = false;
    hlr.dispatchEvent(new Event('change'));
    await nextTick();

    expect(store.hlr.value).toBe(false);
    expect(localStorage.getItem('dtx_look_hlr')).toBe('0');
    expect(host.textContent).toContain('已改');
    expect(q<HTMLElement>(host, 'render-mode-url-hint').textContent)
      .toBe('?dtx_look=sgl&dtx_look_preset=factory&dtx_look_hlr=0');
    const reset = q<HTMLButtonElement>(host, 'render-mode-reset-preset');
    expect(reset.disabled).toBe(false);
    reset.click();
    await nextTick();
    expect(store.hlr.value).toBe(true);
    expect(host.textContent).not.toContain('已改');

    const machine = q<HTMLInputElement>(host, 'render-mode-preset-sgl-machine');
    machine.checked = true;
    machine.dispatchEvent(new Event('change'));
    await nextTick();
    expect(store.preset.value).toBe('sgl-machine');
    for (const key of ['hlr', 'ao', 'gradient', 'aa']) {
      expect(q<HTMLInputElement>(host, `render-mode-effect-${key}`).checked).toBe(false);
    }
    expect(localStorage.getItem('dtx_look_preset')).toBe('sgl-machine');
    expect(q<HTMLElement>(host, 'render-mode-url-hint').textContent).toBe('?dtx_look=sgl&dtx_look_preset=machine');

    unmount();
  });

  it('外部（ViewerPanel 齿轮弹层）改 store，面板同步刷新', async () => {
    const { host, store, unmount } = await mountPanel();

    store.setEnabled(true);
    store.setAo(false);
    await nextTick();

    expect(q<HTMLButtonElement>(host, 'render-mode-option-sgl').getAttribute('aria-checked')).toBe('true');
    expect(q<HTMLInputElement>(host, 'render-mode-effect-ao').checked).toBe(false);
    expect(q<HTMLInputElement>(host, 'render-mode-effect-hlr').checked).toBe(true);

    unmount();
  });
});
