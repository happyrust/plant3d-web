import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';

import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';

import PropertiesPanel from './PropertiesPanel.vue';

import { setGlobalSelectedDeletedRefno, setGlobalSelectedRefno } from '@/composables/useSelectionStore';
import { MODEL_VERSION_INSPECT_EVENT, takePendingModelVersionInspect } from '@/utils/modelUnitVersionCompare';

// -----------------------------------------------------------------------------------------------
// 属性面板标题栏「历史」（ADR 0066 入口之三）：选中谁查谁——发「查看历史版本」请求（事件 + 待认领的一笔），
// 再把「节点版本」面板拉起来。没选中就没有这颗按钮；已删除的幽灵行也能查。
// -----------------------------------------------------------------------------------------------

const { uiAttr, ensurePanelAndActivate } = vi.hoisted(() => ({
  uiAttr: vi.fn<(refno: string) => Promise<unknown>>(),
  ensurePanelAndActivate: vi.fn<(panelId: string) => void>(),
}));

vi.mock('@/model-source', () => ({
  getModelSource: () => ({ attributes: { uiAttr } }),
}));

vi.mock('@/composables/useDockApi', () => ({
  ensurePanelAndActivate,
}));

const REFNO = '24384_23262';
const DELETED = '24384_26481';

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

const historyButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('[data-testid="properties-history"]');

describe('PropertiesPanel 标题栏「历史」', () => {
  let mounted: { host: HTMLElement; app: App } | null = null;

  beforeEach(() => {
    uiAttr.mockReset();
    uiAttr.mockResolvedValue({ success: true, attrs: { NAME: `/N-${REFNO}`, TYPE: 'FTUB' }, full_name: `/N-${REFNO}` });
    ensurePanelAndActivate.mockReset();
    setGlobalSelectedRefno(null);
    takePendingModelVersionInspect();
  });

  afterEach(() => {
    mounted?.app.unmount();
    mounted = null;
    document.body.innerHTML = '';
    setGlobalSelectedRefno(null);
    takePendingModelVersionInspect();
  });

  it('没选中时没有按钮；选中后点「历史」= 发查看请求 + 拉起节点版本面板', async () => {
    mounted = mountPanel();
    const { host } = mounted;
    expect(historyButton(host)).toBeNull();

    setGlobalSelectedRefno(REFNO);
    await flushUi();
    const button = historyButton(host);
    expect(button).not.toBeNull();
    expect(button!.title).toContain(REFNO);

    const seen: string[] = [];
    const listener = (event: Event) => {
      seen.push((event as CustomEvent<{ refno: string }>).detail.refno);
    };
    window.addEventListener(MODEL_VERSION_INSPECT_EVENT, listener);
    try {
      button!.click();
    } finally {
      window.removeEventListener(MODEL_VERSION_INSPECT_EVENT, listener);
    }
    // 事件给已经开着的面板；待认领的那一笔给刚被拉起来的面板
    expect(seen).toEqual([REFNO]);
    expect(takePendingModelVersionInspect()).toBe(REFNO);
    expect(ensurePanelAndActivate).toHaveBeenCalledTimes(1);
    expect(ensurePanelAndActivate).toHaveBeenCalledWith('modelVersionCompare');
  });

  it('已删除的幽灵行也能查历史（它的历史正是要看的东西）', async () => {
    mounted = mountPanel();
    const { host } = mounted;

    setGlobalSelectedDeletedRefno(DELETED);
    await flushUi();
    expect(host.querySelector('[data-testid="properties-deleted-notice"]')).not.toBeNull();
    expect(uiAttr).not.toHaveBeenCalled();

    const button = historyButton(host);
    expect(button).not.toBeNull();
    button!.click();
    expect(takePendingModelVersionInspect()).toBe(DELETED);
    expect(ensurePanelAndActivate).toHaveBeenCalledWith('modelVersionCompare');
  });
});
