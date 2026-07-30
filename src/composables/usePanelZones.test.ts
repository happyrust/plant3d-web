import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  disposePanelZones,
  initPanelZones,
  resetZoneState,
  toggleZone,
  type ZoneName,
} from './usePanelZones';

describe('usePanelZones', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    resetZoneState();
  });

  it.each([
    ['left', 'modelTree', 286, { width: 286 }],
    ['right', 'measurement', 412, { width: 412 }],
    ['bottom', 'console', 176, { height: 176 }],
  ] as const)('restores the last %s zone size', (zone, panelId, size, expected) => {
    const panels = new Map<string, ReturnType<typeof createPanel>>();
    const create = () => createPanel(zone, size, () => panels.delete(panelId));
    panels.set(panelId, create());
    const ensurePanel = vi.fn(() => {
      const panel = create();
      panels.set(panelId, panel);
      return panel;
    });

    initPanelZones({ getPanel: (id) => panels.get(id) }, ensurePanel);
    toggleZone(zone as ZoneName);
    toggleZone(zone as ZoneName);

    expect(ensurePanel).toHaveBeenCalledWith(panelId);
    expect(panels.get(panelId)?.group.api.setSize).toHaveBeenCalledWith(expected);
    disposePanelZones();
  });

  it('restores every panel that was open in a zone', () => {
    const panels = new Map(
      ['measurement', 'dimension'].map((id) => [
        id,
        createPanel('right', 412, () => panels.delete(id)),
      ]),
    );
    const ensurePanel = vi.fn((id: string) => {
      const panel = createPanel('right', 412, () => panels.delete(id));
      panels.set(id, panel);
      return panel;
    });

    initPanelZones({ getPanel: (id) => panels.get(id) }, ensurePanel);
    toggleZone('right');
    toggleZone('right');

    expect(ensurePanel.mock.calls.map(([id]) => id)).toEqual(['measurement', 'dimension']);
    disposePanelZones();
  });
});

function createPanel(zone: ZoneName, size: number, close: () => void) {
  return {
    api: { close: vi.fn(close), setActive: vi.fn() },
    group: {
      api: {
        width: zone === 'bottom' ? 800 : size,
        height: zone === 'bottom' ? size : 600,
        setSize: vi.fn(),
      },
    },
  };
}
