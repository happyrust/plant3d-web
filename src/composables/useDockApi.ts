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
