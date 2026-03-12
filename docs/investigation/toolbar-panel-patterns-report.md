# Toolbar and Panel Architecture Investigation Report

**Date:** 2026-03-11  
**Purpose:** Understanding existing patterns for implementing a new "nearby items" feature

---

## Executive Summary

This codebase uses a **Dockview-based layout system** with:
- **Command-driven panel management** via ribbon toolbar
- **Zone-based panel organization** (left, right, bottom)
- **Global state management** for selection and viewer context
- **Spatial query utilities** for distance calculations

---

## 1. Toolbar Architecture

### Location: `src/ribbon/`

#### Command Bus System
**File:** `src/ribbon/commandBus.ts`

```typescript
// Simple pub-sub pattern for commands
export function emitCommand(commandId: string)
export function onCommand(handler: CommandHandler): () => void
```

- **Pattern:** Event-driven command emission
- **Usage:** Buttons emit commands like `panel.properties`, `panel.measurement`, etc.
- **Handlers:** Registered in `DockLayout.vue` to open/toggle panels

#### Ribbon Configuration
**File:** `src/ribbon/ribbonConfig.ts`

Defines toolbar structure with tabs and groups:
```typescript
{
  id: 'view',
  label: '视图',
  groups: [
    {
      id: 'view.panel.tree',
      items: [
        { kind: 'button', id: 'panel.tree', label: '模型树', commandId: 'panel.tree' }
      ]
    }
  ]
}
```

**Key Commands for Panels:**
- `panel.tree` → Model Tree (left panel)
- `panel.properties` → Properties Panel (right panel)
- `panel.measurement` → Measurement Panel (right panel)
- `panel.console` → Console Panel (bottom panel)
- `panel.mbdPipe` → MBD Pipe Panel (right panel)

---

## 2. Panel Management System

### Main Controller: `src/components/DockLayout.vue`

#### Panel Creation Pattern

```typescript
function ensurePanel(panelId: string) {
  const dockApi = api.value;
  if (!dockApi) return;
  const existing = dockApi.getPanel(panelId);
  if (existing) return existing;

  // Example: Create properties panel
  if (panelId === 'properties') {
    return dockApi.addPanel({
      id: 'properties',
      component: 'PropertiesPanel',
      title: '属性',
      position: measurementPanel
        ? { referencePanel: measurementPanel, direction: 'within' }
        : viewerPanel
          ? { referencePanel: viewerPanel, direction: 'right' }
          : undefined,
    });
  }
}
```

#### Toggle Panel Pattern

```typescript
function togglePanel(panelId: string) {
  const panel = dockApi.getPanel(panelId);
  if (panel) {
    panel.api.close();  // Close if exists
    return;
  }
  
  onPanelOpened(panelId);  // Auto-expand zone if collapsed
  const created = ensurePanel(panelId);
  if (created) {
    created.api.setActive();  // Activate new panel
  }
}
```

#### Command Handler Registration

```typescript
function handleRibbonCommand(commandId: string) {
  switch (commandId) {
    case 'panel.properties':
      togglePanel('properties');
      return;
    case 'panel.measurement':
      togglePanel('measurement');
      return;
    // ... other cases
  }
}

onMounted(() => {
  offCommand = onCommand(handleRibbonCommand);
});
```

---

## 3. Zone-Based Organization

### File: `src/composables/usePanelZones.ts`

Panels are organized into three zones:

```typescript
export const ZONE_PANELS: Record<ZoneName, string[]> = {
  left: ['modelTree'],
  right: [
    'measurement', 'dimension', 'annotation', 'manager', 'properties',
    'modelQuery', 'ptset', 'mbdPipe', 'materialConfig', 'review',
    // ... more panels
  ],
  bottom: ['console', 'parquetDebug'],
};
```

**Zone Management Features:**
- Collapse/expand entire zones
- Remember hidden panels when collapsed
- Auto-expand zone when panel opened
- Persistent state in localStorage

---

## 4. Example Panel Implementations

### Left-Side Panel: Model Tree

**Dock Wrapper:** `src/components/dock_panels/ModelTreePanelDock.vue`
```vue
<script setup lang="ts">
import ModelTreePanel from '@/components/model-tree/ModelTreePanel.vue';
import { useViewerContext } from '@/composables/useViewerContext';

const ctx = useViewerContext();
const viewer = shallowRef<DtxCompatViewer | null>(null);

watch(() => ctx.viewerRef.value, (v) => {
  viewer.value = v;
}, { immediate: true });
</script>

<template>
  <div class="h-full w-full overflow-auto p-2">
    <ModelTreePanel :viewer="viewer" />
  </div>
</template>
```

**Actual Panel:** `src/components/model-tree/ModelTreePanel.vue`
- **Features:** Tree visualization, search, filtering, selection sync
- **Viewer Integration:** Uses `useViewerContext()` for viewer access
- **Selection:** Two-way binding with global selection store

### Right-Side Panel: Properties

**Dock Wrapper:** `src/components/dock_panels/PropertiesPanelDock.vue`
```vue
<template>
  <div class="h-full w-full overflow-auto p-2">
    <PropertiesPanel />
  </div>
</template>
```

**Actual Panel:** `src/components/tools/PropertiesPanel.vue`
- **Features:** Display object attributes, grouped by category
- **Data Source:** `useSelectionStore()` - reacts to `selectedRefno`
- **UI Pattern:** Search, collapsible groups, inline editing

---

## 5. Viewer Integration Patterns

### Global Viewer Context

**File:** `src/composables/useViewerContext.ts`

```typescript
export type ViewerContext = {
  viewerRef: ShallowRef<DtxCompatViewer | null>;
  overlayContainerRef: ShallowRef<HTMLElement | null>;
  tools: ShallowRef<ReturnType<typeof useDtxTools> | null>;
  store: ShallowRef<ReturnType<typeof useToolStore> | null>;
  ptsetVis: ShallowRef<UsePtsetVisualizationThreeReturn | null>;
  mbdPipeVis: ShallowRef<UseMbdPipeAnnotationThreeReturn | null>;
  annotationSystem: ShallowRef<UseAnnotationThreeReturn | null>;
};

export function useViewerContext(): ViewerContext;
```

**Usage Pattern:**
```typescript
const ctx = useViewerContext();
const viewer = ctx.viewerRef.value;  // Access 3D viewer
const tools = ctx.tools.value;       // Access DTX tools (selection, highlight)
```

### Selection Store

**File:** `src/composables/useSelectionStore.ts`

```typescript
export function useSelectionStore() {
  return {
    selectedRefno,           // Current selected object ID
    propertiesLoading,       // Loading state
    propertiesError,         // Error state
    propertiesData,          // Object attributes
    fullName,                // Full object name
    loadProperties(refno),   // Load by ID
    clearSelection(),        // Clear selection
    setSelectedRefno(refno), // Set selection
  };
}
```

**Key Features:**
- Uses `@tanstack/vue-query` for caching
- Automatically fetches properties when `selectedRefno` changes
- Global singleton pattern - shared across all components

---

## 6. Spatial Query Utilities

### Clearance/Distance Calculations

**File:** `src/utils/three/geometry/clearance/pipeClearance.ts`

```typescript
export type ClearanceResult = {
  pipeSurfacePoint: THREE.Vector3
  otherSurfacePoint: THREE.Vector3
  distance: number
  normal: THREE.Vector3
}

export function computePipeToWallClearance(params: PipeToWallClearanceParams): ClearanceResult | null;
export function computePipeToColumnClearance(params: PipeToColumnClearanceParams): ClearanceResult | null;
```

**Usage:** Calculate minimum distance between objects (pipes, walls, columns)

### Selection Controller

**File:** `src/utils/three/dtx/selection/DTXSelectionController.ts`

Handles:
- GPU-based picking
- Selection highlighting
- Multi-selection
- Hover effects

---

## 7. Implementation Blueprint for "Nearby Items" Feature

### Step 1: Add Panel Definition

**In `DockLayout.vue`:**

```typescript
function ensurePanel(panelId: string) {
  // ... existing code ...
  
  if (panelId === 'nearbyItems') {
    return dockApi.addPanel({
      id: 'nearbyItems',
      component: 'NearbyItemsPanel',
      title: '附近构件',
      position: viewerPanel
        ? { referencePanel: viewerPanel, direction: 'left' }
        : undefined,
    });
  }
}
```

**Add to command handler:**
```typescript
case 'panel.nearbyItems':
  togglePanel('nearbyItems');
  return;
```

### Step 2: Update Zone Configuration

**In `src/composables/usePanelZones.ts`:**

```typescript
export const ZONE_PANELS: Record<ZoneName, string[]> = {
  left: ['modelTree', 'nearbyItems'],  // Add to left zone
  // ... rest
};
```

### Step 3: Add Ribbon Button

**In `src/ribbon/ribbonConfig.ts`:**

```typescript
{
  id: 'view.panel.nearbyItems',
  label: '附近构件',
  items: [
    { 
      kind: 'button', 
      id: 'panel.nearbyItems', 
      label: '附近构件', 
      icon: 'radius',  // Choose appropriate icon
      commandId: 'panel.nearbyItems' 
    },
  ],
}
```

### Step 4: Create Panel Components

**Create:** `src/components/dock_panels/NearbyItemsPanelDock.vue`

```vue
<script setup lang="ts">
import NearbyItemsPanel from '@/components/tools/NearbyItemsPanel.vue';
import { useViewerContext } from '@/composables/useViewerContext';

defineProps<{
  params: {
    params: unknown;
    api: unknown;
    containerApi: unknown;
  };
}>();

const ctx = useViewerContext();
</script>

<template>
  <div class="h-full w-full overflow-auto p-2">
    <NearbyItemsPanel :viewer="ctx.viewerRef.value" />
  </div>
</template>
```

**Create:** `src/components/tools/NearbyItemsPanel.vue`

```vue
<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useViewerContext } from '@/composables/useViewerContext';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';

const props = defineProps<{
  viewer: DtxCompatViewer | null;
}>();

const selection = useSelectionStore();
const searchMode = ref<'refno' | 'position'>('refno');
const searchRadius = ref(5.0); // meters
const nearbyItems = ref<Array<{ refno: string; distance: number; name: string }>>([]);

// Search logic
async function searchNearby() {
  if (!props.viewer) return;
  
  if (searchMode.value === 'refno') {
    const refno = selection.selectedRefno.value;
    if (!refno) return;
    // Query nearby items by refno
    // Use viewer's spatial index or backend API
  } else {
    // Get camera position or user input position
    // Query nearby items by position
  }
}

// Auto-search when selection changes
watch(() => selection.selectedRefno.value, () => {
  if (searchMode.value === 'refno') {
    searchNearby();
  }
});

function selectItem(refno: string) {
  selection.setSelectedRefno(refno);
  // Optional: fly to item in 3D viewer
}
</script>

<template>
  <div class="flex h-full flex-col gap-2">
    <div class="border-b pb-2">
      <h3 class="text-sm font-medium">附近构件查询</h3>
    </div>
    
    <!-- Search mode selector -->
    <div class="flex gap-2">
      <button @click="searchMode = 'refno'" 
              :class="searchMode === 'refno' ? 'bg-primary' : 'bg-muted'">
        按对象
      </button>
      <button @click="searchMode = 'position'"
              :class="searchMode === 'position' ? 'bg-primary' : 'bg-muted'">
        按位置
      </button>
    </div>
    
    <!-- Radius input -->
    <div class="flex items-center gap-2">
      <label class="text-sm">搜索半径:</label>
      <input v-model.number="searchRadius" type="number" 
             class="w-20 rounded border px-2 py-1" />
      <span class="text-sm">米</span>
    </div>
    
    <!-- Search button -->
    <button @click="searchNearby" class="rounded bg-primary px-4 py-2 text-white">
      搜索
    </button>
    
    <!-- Results list -->
    <div class="flex-1 overflow-auto border-t pt-2">
      <div v-if="nearbyItems.length === 0" class="text-sm text-muted-foreground">
        暂无结果
      </div>
      <div v-for="item in nearbyItems" :key="item.refno"
           @click="selectItem(item.refno)"
           class="cursor-pointer rounded p-2 hover:bg-muted">
        <div class="text-sm font-medium">{{ item.name }}</div>
        <div class="text-xs text-muted-foreground">
          {{ item.refno }} · {{ item.distance.toFixed(2) }}m
        </div>
      </div>
    </div>
  </div>
</template>
```

### Step 5: Register Panel Component

**In `src/components/DockLayout.vue` script:**

Add to component imports or use dynamic registration.

---

## 8. Key Patterns to Follow

### ✅ DO:
1. **Use zone-based positioning** - Add panel to appropriate zone (left/right/bottom)
2. **Follow wrapper pattern** - Create both `*PanelDock.vue` and actual panel component
3. **Use global stores** - Leverage `useViewerContext()` and `useSelectionStore()`
4. **Emit commands** - Use `emitCommand()` to trigger panel open/close
5. **Auto-expand zones** - Call `onPanelOpened()` when creating panels
6. **Sync with viewer** - Watch viewer context for selection changes

### ❌ DON'T:
1. **Don't bypass command bus** - Always use `emitCommand()` for toolbar actions
2. **Don't create direct dock API calls** - Use `ensurePanel()` pattern
3. **Don't duplicate viewer access** - Use singleton `useViewerContext()`
4. **Don't forget zone registration** - Add to `ZONE_PANELS` mapping

---

## 9. Related Files Reference

### Core Architecture
- `src/components/DockLayout.vue` - Main layout controller
- `src/composables/usePanelZones.ts` - Zone management
- `src/composables/useDockApi.ts` - Dock API helpers
- `src/ribbon/commandBus.ts` - Command system
- `src/ribbon/ribbonConfig.ts` - Toolbar configuration

### Example Panels (Left Side)
- `src/components/dock_panels/ModelTreePanelDock.vue` - Wrapper
- `src/components/model-tree/ModelTreePanel.vue` - Implementation

### Example Panels (Right Side)
- `src/components/dock_panels/PropertiesPanelDock.vue` - Wrapper
- `src/components/tools/PropertiesPanel.vue` - Implementation
- `src/components/dock_panels/MeasurementPanelDock.vue` - Wrapper
- `src/components/tools/MeasurementPanel.vue` - Implementation

### Viewer Integration
- `src/composables/useViewerContext.ts` - Global viewer access
- `src/composables/useSelectionStore.ts` - Selection state
- `src/utils/three/dtx/selection/DTXSelectionController.ts` - Selection logic

### Spatial Utilities
- `src/utils/three/geometry/clearance/pipeClearance.ts` - Distance calculations
- `src/utils/three/dtx/selection/GPUPicker.ts` - Object picking

---

## Conclusion

The codebase has a well-structured, command-driven panel system with:
- Clear separation between dock wrappers and actual panels
- Zone-based organization with collapse/expand support
- Global singleton stores for viewer and selection state
- Existing spatial query utilities for distance calculations

**For the "nearby items" feature**, follow the established patterns by:
1. Adding command to ribbon config
2. Registering panel in DockLayout
3. Adding to zone configuration
4. Creating dock wrapper + implementation components
5. Using existing viewer context and selection stores
6. Leveraging spatial utilities for distance queries
