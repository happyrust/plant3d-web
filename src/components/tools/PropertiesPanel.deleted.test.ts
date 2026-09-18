import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';

import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';

import PropertiesPanel from './PropertiesPanel.vue';

import {
  getGlobalSelectedIsDeleted,
  setGlobalSelectedDeletedRefno,
  setGlobalSelectedRefno,
} from '@/composables/useSelectionStore';

// -----------------------------------------------------------------------------------------------
// 属性面板 × 「已删除」选中（模型版本差异模式的幽灵行）：
// 幽灵行点进全局选中后，面板不去拉当前会话的属性（拉了只会 404），改给「该构件已删除，属性见底部属性历史对比」；
// 同一 refno 之前正常选中时缓存下来的 404 也不能漏出来；任何一次正常选中都把登记复位。
// 2026-09-18 真机 602→604：右侧属性面板红条「not_found (404): dbnum 8000 会话 Some(636) 的索引里没有 24384/26481」。
// -----------------------------------------------------------------------------------------------

const { uiAttr } = vi.hoisted(() => ({ uiAttr: vi.fn<(refno: string) => Promise<unknown>>() }));

vi.mock('@/model-source', () => ({
  getModelSource: () => ({ attributes: { uiAttr } }),
}));

const ALIVE = '24384_23262';
const DELETED = '24384_26481';

/** 查询函数里有一次动态 import（`@/model-source`），微任务排不完，得让出几拍宏任务。 */
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

const notice = (host: HTMLElement) => host.querySelector('[data-testid="properties-deleted-notice"]');

describe('PropertiesPanel × 已删除选中（幽灵行）', () => {
  let mounted: { host: HTMLElement; app: App } | null = null;

  beforeEach(() => {
    uiAttr.mockReset();
    uiAttr.mockImplementation(async (refno: string) => {
      if (refno === DELETED) throw new Error(`not_found (404): dbnum 8000 会话 Some(636) 的索引里没有 ${refno.replace('_', '/')}`);
      return { success: true, attrs: { NAME: `/N-${refno}`, TYPE: 'FTUB' }, full_name: `/N-${refno}` };
    });
    setGlobalSelectedRefno(null);
  });

  afterEach(() => {
    mounted?.app.unmount();
    mounted = null;
    document.body.innerHTML = '';
    setGlobalSelectedRefno(null);
  });

  it('已删除登记：不发属性查询、给提示、不算错误；正常选中把登记复位', async () => {
    mounted = mountPanel();
    const { host } = mounted;

    // 正常选中：查询发出去、属性列出来
    setGlobalSelectedRefno(ALIVE);
    await flushUi();
    expect(uiAttr).toHaveBeenCalledTimes(1);
    expect(uiAttr).toHaveBeenCalledWith(ALIVE);
    expect(host.textContent).toContain(`/N-${ALIVE}`);
    expect(host.textContent).toContain('NAME');
    expect(notice(host)).toBeNull();
    expect(getGlobalSelectedIsDeleted()).toBe(false);

    // 幽灵行进选中：一条查询都不发，给「该构件已删除」提示，头部仍显示 refno
    setGlobalSelectedDeletedRefno(DELETED);
    await flushUi();
    expect(uiAttr).toHaveBeenCalledTimes(1);
    expect(getGlobalSelectedIsDeleted()).toBe(true);
    expect(notice(host)?.textContent).toContain('该构件已删除，属性见底部属性历史对比');
    expect(host.textContent).toContain(DELETED);
    expect(host.textContent).not.toContain('not_found');
    expect(host.textContent).not.toContain('加载中');
    // 搜索框（有数据才出）不出
    expect(host.querySelector('input')).toBeNull();

    // 再正常选中：提示消失、登记复位、属性回来
    setGlobalSelectedRefno(ALIVE);
    await flushUi();
    expect(getGlobalSelectedIsDeleted()).toBe(false);
    expect(notice(host)).toBeNull();
    expect(host.textContent).toContain(`/N-${ALIVE}`);
  });

  it('同一 refno 之前正常选中时缓存下来的 404，已删除登记后不漏出来', async () => {
    mounted = mountPanel();
    const { host } = mounted;

    // 先按普通构件选一次：后端 404 → 面板报错（修前真机看到的那条红条）
    setGlobalSelectedRefno(DELETED);
    await flushUi();
    expect(uiAttr).toHaveBeenCalledWith(DELETED);
    expect(host.textContent).toContain('not_found (404)');
    expect(notice(host)).toBeNull();

    // 同一 refno 改按幽灵行登记：错误让位给提示，也不再重发查询
    const calls = uiAttr.mock.calls.length;
    setGlobalSelectedDeletedRefno(DELETED);
    await flushUi();
    expect(uiAttr.mock.calls.length).toBe(calls);
    expect(notice(host)?.textContent).toContain('该构件已删除');
    expect(host.textContent).not.toContain('not_found');

    // 清空选中：登记复位、回到「点击选择对象」
    setGlobalSelectedRefno(null);
    await flushUi();
    expect(getGlobalSelectedIsDeleted()).toBe(false);
    expect(notice(host)).toBeNull();
    expect(host.textContent).toContain('点击选择对象');
  });
});
