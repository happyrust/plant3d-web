import { shallowRef } from 'vue';

type DockApiLike = {
  getPanel: (id: string) => unknown;
};

const dockApiRef = shallowRef<DockApiLike | null>(null);

export function setDockApi(api: DockApiLike | null) {
  dockApiRef.value = api;
}

export function dockPanelExists(panelId: string): boolean {
  const api = dockApiRef.value;
  if (!api) return false;
  return !!api.getPanel(panelId);
}

export function dockActivatePanelIfExists(panelId: string) {
  const api = dockApiRef.value;
  if (!api) return;
  const panel = api.getPanel(panelId) as unknown as { api?: { setActive?: () => void } } | null;
  if (!panel) return;
  panel.api?.setActive?.();
}

/**
 * 确保面板存在并激活。如果面板不存在，通过 commandBus 发送命令来创建它。
 */
export function ensurePanelAndActivate(panelId: string) {
  const api = dockApiRef.value;
  if (!api) return;

  const panel = api.getPanel(panelId);
  if (panel) {
    // 面板已存在，直接激活
    (panel as { api?: { setActive?: () => void } }).api?.setActive?.();
  } else {
    // 面板不存在，通过 commandBus 发送命令来创建并激活
    // commandBus 的 togglePanel 逻辑会创建面板并激活它
    import('@/ribbon/commandBus').then(({ emitCommand }) => {
      emitCommand(`panel.${panelId}`);
    });
  }
}
