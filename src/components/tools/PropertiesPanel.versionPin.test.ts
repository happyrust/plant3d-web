import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';

import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';

import PropertiesPanel from './PropertiesPanel.vue';

import {
  getGlobalSelectedVersionPin,
  setGlobalSelectedRefno,
  setGlobalSelectedRefnoAtVersion,
} from '@/composables/useSelectionStore';

// -----------------------------------------------------------------------------------------------
// 属性面板 × 「版本钉住」选中（版本对比里在三维点了 A / B 隔离图层的构件）：
// 属性不走当前会话的 `uiAttr`，改按钉住时带来的 `load`（闭包住那一侧版本几何的句柄）取那一版的；标题栏下给一条「属性来自版本 A · sesno N」；
// 同一 refno 的「当前会话」与「某一版」各自缓存、互不串；任何一次正常选中都把钉住复位。
// -----------------------------------------------------------------------------------------------

const { uiAttr } = vi.hoisted(() => ({ uiAttr: vi.fn<(refno: string) => Promise<unknown>>() }));

vi.mock('@/model-source', () => ({
  getModelSource: () => ({ attributes: { uiAttr } }),
}));

const FTUB = '24384_23262';

async function flushUi(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    await nextTick();
  }
}

function mountPanel(): { host: HTMLElement; app: App } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(PropertiesPanel);
  app.use(VueQueryPlugin, {
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }),
  });
  app.mount(host);
  return { host, app };
}

const notice = (host: HTMLElement) => host.querySelector('[data-testid="properties-version-pin-notice"]');

describe('PropertiesPanel × 版本钉住选中（版本对比里点 A / B 构件）', () => {
  let mounted: { host: HTMLElement; app: App } | null = null;

  beforeEach(() => {
    uiAttr.mockReset();
    uiAttr.mockResolvedValue({ success: true, attrs: { NAME: '/CURRENT', POS: '10887, 12332, 2900' }, full_name: '/CURRENT' });
    setGlobalSelectedRefno(null);
  });

  afterEach(() => {
    mounted?.app.unmount();
    mounted = null;
    document.body.innerHTML = '';
    setGlobalSelectedRefno(null);
  });

  it('钉住 A 那版：属性经 load 取、不发当前会话查询、标题下注明版本；正常选中复位并回到当前会话', async () => {
    mounted = mountPanel();
    const { host } = mounted;

    const loadA = vi.fn().mockResolvedValue({
      success: true, refno: FTUB, attrs: { NAME: '/AT-626', POS: '10887, 12332, 3400' }, full_name: '/AT-626', ref_full_names: null,
    });
    setGlobalSelectedRefnoAtVersion(FTUB, { sesno: 626, label: 'A', load: loadA });
    await flushUi();

    expect(loadA).toHaveBeenCalledTimes(1);
    expect(uiAttr).not.toHaveBeenCalled();
    expect(getGlobalSelectedVersionPin()).toEqual({ sesno: 626, label: 'A' });
    expect(notice(host)?.textContent).toContain('A · sesno 626');
    expect(notice(host)?.getAttribute('data-sesno')).toBe('626');
    expect(host.textContent).toContain('/AT-626');
    expect(host.textContent).toContain('3400');
    expect(host.textContent).not.toContain('/CURRENT');

    // 同一 refno 普通选中：钉住复位、走当前会话、那一版的值不串过来
    setGlobalSelectedRefno(FTUB);
    await flushUi();
    expect(getGlobalSelectedVersionPin()).toBeNull();
    expect(notice(host)).toBeNull();
    expect(uiAttr).toHaveBeenCalledWith(FTUB);
    expect(host.textContent).toContain('/CURRENT');
    expect(host.textContent).not.toContain('/AT-626');

    // 再钉到 B 那版：另一个 sesno 是另一份缓存，load 照发
    const loadB = vi.fn().mockResolvedValue({ success: true, refno: FTUB, attrs: { NAME: '/AT-630' }, full_name: '/AT-630', ref_full_names: null });
    setGlobalSelectedRefnoAtVersion(FTUB, { sesno: 630, label: 'B', load: loadB });
    await flushUi();
    expect(loadB).toHaveBeenCalledTimes(1);
    expect(notice(host)?.textContent).toContain('B · sesno 630');
    expect(host.textContent).toContain('/AT-630');
  });

  it('那一版里不存在（load 回 success:false）：按普通错误态给出说明，不当 404', async () => {
    mounted = mountPanel();
    const { host } = mounted;
    setGlobalSelectedRefnoAtVersion(FTUB, {
      sesno: 573, label: 'A', load: vi.fn().mockResolvedValue({ success: false, refno: FTUB, attrs: {}, error_message: '该构件在 sesno 573 那一版不存在' }),
    });
    await flushUi();
    expect(notice(host)?.textContent).toContain('A · sesno 573');
    expect(host.textContent).toContain('该构件在 sesno 573 那一版不存在');
    expect(uiAttr).not.toHaveBeenCalled();

    // 清空：钉住复位
    setGlobalSelectedRefno(null);
    await flushUi();
    expect(getGlobalSelectedVersionPin()).toBeNull();
    expect(notice(host)).toBeNull();
  });
});
