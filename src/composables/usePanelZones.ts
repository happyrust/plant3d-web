import { reactive, computed } from 'vue';

// ---------------------------------------------------------------------------
// Zone-to-panel mapping
// ---------------------------------------------------------------------------

export type ZoneName = 'left' | 'right' | 'bottom';

/**
 * Static mapping from zone name to the panel IDs that belong to that zone.
 * Derived from how `ensurePanel()` positions panels in DockLayout.vue.
 */
export const ZONE_PANELS: Record<ZoneName, string[]> = {
  left: ['modelTree'],
  right: [
    'measurement', 'dimension', 'annotation', 'manager', 'properties',
    'modelQuery', 'ptset', 'materialConfig', 'review',
    'initiateReview', 'reviewerTasks', 'myTasks', 'resubmissionTasks',
    'taskMonitor', 'taskCreation', 'incrementalUpdate', 'modelExport', 'hydraulic', 'roomInfo', 'roomStatus', 'spatialCompute', 'dashboard',
  ],
  bottom: ['console', 'parquetDebug'],
};

/** Reverse lookup: panelId -> zone name */
const panelToZone = new Map<string, ZoneName>();
for (const [zone, ids] of Object.entries(ZONE_PANELS) as [ZoneName, string[]][]) {
  for (const id of ids) {
    panelToZone.set(id, zone);
  }
}

export function getZoneForPanel(panelId: string): ZoneName | undefined {
  return panelToZone.get(panelId);
}

// ---------------------------------------------------------------------------
// Per-zone collapsed state
// ---------------------------------------------------------------------------

type ZoneState = {
  /** Whether the zone is currently collapsed by the toggle button */
  collapsed: boolean;
  /** Panel IDs that were open when the zone was collapsed (used for restore) */
  hiddenPanelIds: string[];
  /** Width (left/right) or height (bottom) before the zone was collapsed */
  size: number;
}

const STORAGE_KEY = 'plant3d-web-zone-state';
const DEFAULT_ZONE_SIZE: Record<ZoneName, number> = {
  left: 350,
  right: 350,
  bottom: 200,
};

function loadState(): Record<ZoneName, ZoneState> {
  const defaults: Record<ZoneName, ZoneState> = {
    left: { collapsed: false, hiddenPanelIds: [], size: DEFAULT_ZONE_SIZE.left },
    right: { collapsed: false, hiddenPanelIds: [], size: DEFAULT_ZONE_SIZE.right },
    bottom: { collapsed: false, hiddenPanelIds: [], size: DEFAULT_ZONE_SIZE.bottom },
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, ZoneState>;
      for (const z of ['left', 'right', 'bottom'] as ZoneName[]) {
        if (parsed[z]) {
          defaults[z] = {
            collapsed: !!parsed[z].collapsed,
            hiddenPanelIds: Array.isArray(parsed[z].hiddenPanelIds)
              ? parsed[z].hiddenPanelIds
              : [],
            size: Number.isFinite(parsed[z].size) && parsed[z].size > 0
              ? parsed[z].size
              : DEFAULT_ZONE_SIZE[z],
          };
        }
      }
    }
  } catch {
    // ignore
  }
  return defaults;
}

function saveState(state: Record<ZoneName, ZoneState>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Singleton state (shared across all consumers)
// ---------------------------------------------------------------------------

const zoneState = reactive<Record<ZoneName, ZoneState>>(loadState());

// ---------------------------------------------------------------------------
// DockApi-dependent helpers (set at runtime by DockLayout)
// ---------------------------------------------------------------------------

type DockApiLike = {
  getPanel: (id: string) => PanelLike | undefined;
};

type PanelLike = {
  api: { close: () => void; setActive: () => void };
  group?: {
    api: {
      width: number;
      height: number;
      setSize: (size: { width?: number; height?: number }) => void;
    };
  };
};

type EnsurePanelFn = (panelId: string) => PanelLike | undefined;

let _dockApi: DockApiLike | null = null;
let _ensurePanel: EnsurePanelFn | null = null;

/**
 * Called by DockLayout once the dock API is ready.
 * Provides the functions needed for zone toggle operations.
 */
export function initPanelZones(
  dockApi: DockApiLike,
  ensurePanelFn: EnsurePanelFn,
) {
  _dockApi = dockApi;
  _ensurePanel = ensurePanelFn;
}

export function disposePanelZones() {
  _dockApi = null;
  _ensurePanel = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a reactive boolean indicating whether at least one panel
 * in the given zone is currently visible (or the zone is not collapsed).
 */
export function isZoneActive(zone: ZoneName) {
  return computed(() => {
    if (zoneState[zone].collapsed) return false;
    if (!_dockApi) return false;
    return ZONE_PANELS[zone].some((id) => !!_dockApi!.getPanel(id));
  });
}

/**
 * Toggle a zone: collapse all its panels or restore them.
 */
export function toggleZone(zone: ZoneName) {
  if (!_dockApi) return;

  if (!zoneState[zone].collapsed) {
    // --- Collapse: close all panels in this zone and remember them ---
    const openIds: string[] = [];
    for (const panelId of ZONE_PANELS[zone]) {
      const panel = _dockApi.getPanel(panelId);
      if (panel) {
        const size = zone === 'bottom' ? panel.group?.api.height : panel.group?.api.width;
        if (size && size > 0) zoneState[zone].size = size;
        openIds.push(panelId);
        panel.api.close();
      }
    }
    zoneState[zone].collapsed = true;
    zoneState[zone].hiddenPanelIds = openIds;
    saveState(zoneState);
  } else {
    // --- Expand: recreate previously hidden panels ---
    const toRestore = zoneState[zone].hiddenPanelIds;
    zoneState[zone].collapsed = false;
    zoneState[zone].hiddenPanelIds = [];
    saveState(zoneState);

    if (_ensurePanel && toRestore.length > 0) {
      let restoredPanel: PanelLike | undefined;
      for (const panelId of toRestore) {
        const panel = _ensurePanel(panelId);
        restoredPanel ??= panel;
      }
      if (restoredPanel?.group) {
        restoredPanel.group.api.setSize(
          zone === 'bottom'
            ? { height: zoneState[zone].size }
            : { width: zoneState[zone].size },
        );
      }
    }
  }
}

/**
 * Called when a panel is created (e.g. via ribbon command).
 * If its zone was collapsed, auto-expand it.
 */
export function onPanelOpened(panelId: string) {
  const zone = getZoneForPanel(panelId);
  if (!zone) return;
  if (zoneState[zone].collapsed) {
    zoneState[zone].collapsed = false;
    zoneState[zone].hiddenPanelIds = [];
    saveState(zoneState);
  }
}

/**
 * Reset zone state to all-visible (used by layout.reset).
 */
export function resetZoneState() {
  for (const z of ['left', 'right', 'bottom'] as ZoneName[]) {
    zoneState[z].collapsed = false;
    zoneState[z].hiddenPanelIds = [];
  }
  saveState(zoneState);
}

/**
 * Returns `true` if the zone is currently in collapsed state.
 */
export function isZoneCollapsed(zone: ZoneName) {
  return computed(() => zoneState[zone].collapsed);
}

/**
 * Return the hidden panel IDs for initial layout creation.
 * If a zone was collapsed, its default panels should not be created.
 */
export function getCollapsedZones(): ZoneName[] {
  return (['left', 'right', 'bottom'] as ZoneName[]).filter(
    (z) => zoneState[z].collapsed,
  );
}
