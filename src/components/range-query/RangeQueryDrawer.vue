<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import {
  ChevronDown,
  ChevronRight,
  Crosshair,
  Eye,
  EyeOff,
  Filter,
  Locate,
  MousePointerClick,
  Search,
  X,
} from 'lucide-vue-next';

import { useQuickViewRequestStore } from '@/composables/useQuickViewRequestStore';
import { useRangeQuerySettingsStore } from '@/composables/useRangeQuerySettingsStore';
import { useToolStore } from '@/composables/useToolStore';
import { useViewerContext } from '@/composables/useViewerContext';
import { SiteSpecValue, getSpecValueName } from '@/types/spec';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();

// --- stores ---
const rangeSettings = useRangeQuerySettingsStore();
const store = useToolStore();
const ctx = useViewerContext();
const quickViewReq = useQuickViewRequestStore();

// --- types ---
type RefNode = {
  id: string;
  name: string;
  visible: boolean;
};

type DisciplineNode = {
  id: string;
  name: string;
  visible: boolean;
  expanded: boolean;
  children: RefNode[];
};

// --- local state ---
const centerPoint = ref('0,0,0');
const pickedModelName = ref('');
const isLoading = ref(false);
const errorMsg = ref('');
const disciplines = ref<DisciplineNode[]>([]);
const filterText = ref('');
const isIsolated = ref(false);

// --- computed ---
const totalCount = computed(() =>
  disciplines.value.reduce((sum, d) => sum + d.children.length, 0),
);

const filteredDisciplines = computed(() => {
  if (!filterText.value) return disciplines.value;
  const q = filterText.value.toLowerCase();
  return disciplines.value
    .map((d) => {
      const matchDisc = d.name.toLowerCase().includes(q);
      const matchChildren = d.children.filter((c) =>
        c.name.toLowerCase().includes(q),
      );
      if (matchDisc || matchChildren.length > 0) {
        return { ...d, children: matchDisc ? d.children : matchChildren };
      }
      return null;
    })
    .filter(Boolean) as DisciplineNode[];
});

// --- pick center ---
function startPick() {
  store.setToolMode('pick_query_center');
  store.setPickedQueryCenter(null);
  pickedModelName.value = '';
}

watch(
  () => store.pickedQueryCenter.value,
  (val) => {
    if (val) {
      centerPoint.value = `${val.worldPos[0].toFixed(2)},${val.worldPos[1].toFixed(2)},${val.worldPos[2].toFixed(2)}`;
      pickedModelName.value = val.entityId;
    }
  },
);

function useSelection() {
  const viewer = ctx.viewerRef.value;
  if (!viewer) {
    errorMsg.value = '查看器未就绪';
    return;
  }
  const selectedIds = viewer.scene.selectedObjectIds;
  if (!selectedIds || selectedIds.length === 0) {
    errorMsg.value = '请先选中一个模型';
    return;
  }
  const firstId = selectedIds[0]!;
  const entity = viewer.scene.objects[firstId];
  if (!entity || !entity.aabb) {
    errorMsg.value = '无法获取选中模型的位置';
    return;
  }
  const aabb = entity.aabb as [number, number, number, number, number, number];
  const cx = (aabb[0] + aabb[3]) / 2;
  const cy = (aabb[1] + aabb[4]) / 2;
  const cz = (aabb[2] + aabb[5]) / 2;
  centerPoint.value = `${cx.toFixed(2)},${cy.toFixed(2)},${cz.toFixed(2)}`;
  pickedModelName.value = firstId;
  errorMsg.value = '';
}

// --- query ---
function handleQuery() {
  const viewer = ctx.viewerRef.value;
  if (!viewer) {
    errorMsg.value = '查看器未就绪';
    return;
  }
  const parts = centerPoint.value.split(',').map((s) => parseFloat(s.trim()));
  if (parts.length !== 3 || parts.some(isNaN)) {
    errorMsg.value = '中心点格式错误，应为 "x,y,z"';
    return;
  }
  const cx = parts[0]!;
  const cy = parts[1]!;
  const cz = parts[2]!;
  const r = rangeSettings.radiusM.value;

  const minx = cx - r, miny = cy - r, minz = cz - r;
  const maxx = cx + r, maxy = cy + r, maxz = cz + r;

  isLoading.value = true;
  errorMsg.value = '';
  disciplines.value = [];

  try {
    const objects = viewer.scene.objects;
    const groups: Record<string, RefNode[]> = {};
    const metaByRefno = (
      viewer.scene as unknown as {
        __aiosMetaByRefno?: Record<
          string,
          { category: string; name: string; specValue?: SiteSpecValue }
        >;
      }
    ).__aiosMetaByRefno || {};

    // spec filter set
    const specFilter = rangeSettings.specValues.value;
    const hasSpecFilter = specFilter.length > 0;

    for (const id of Object.keys(objects)) {
      const entity = objects[id];
      if (!entity || !entity.aabb) continue;

      const aabb = entity.aabb as [number, number, number, number, number, number];
      if (
        aabb[3] >= minx && aabb[0] <= maxx &&
        aabb[4] >= miny && aabb[1] <= maxy &&
        aabb[5] >= minz && aabb[2] <= maxz
      ) {
        const meta = metaByRefno[id];
        const specValue = meta?.specValue ?? SiteSpecValue.Unknown;

        // apply spec filter
        if (hasSpecFilter && !specFilter.includes(specValue)) continue;

        const specName = getSpecValueName(specValue);
        if (!groups[specName]) groups[specName] = [];
        groups[specName].push({
          id: `node_${id}`,
          name: id,
          visible: entity.visible !== false,
        });
      }
    }

    disciplines.value = Object.entries(groups)
      .map(([name, children], idx) => ({
        id: `disc_${idx}`,
        name,
        visible: true,
        expanded: true,
        children,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (disciplines.value.length === 0) {
      errorMsg.value = '未找到构件';
    }
  } catch (e) {
    errorMsg.value = String(e);
  } finally {
    isLoading.value = false;
  }
}

// --- visibility ---
function setViewerVisibility(ids: string[], visible: boolean) {
  const viewer = ctx.viewerRef.value;
  if (!viewer) return;
  viewer.scene.setObjectsVisible(ids, visible);
}

function toggleDisciplineExpand(node: DisciplineNode) {
  node.expanded = !node.expanded;
}

function toggleDisciplineVisible(node: DisciplineNode, e: Event) {
  e.stopPropagation();
  node.visible = !node.visible;
  node.children.forEach((child) => { child.visible = node.visible; });
  const ids = node.children.map((c) => c.name);
  setViewerVisibility(ids, node.visible);
}

function toggleRefVisible(child: RefNode, e: Event) {
  e.stopPropagation();
  child.visible = !child.visible;
  setViewerVisibility([child.name], child.visible);
}

// --- fly to ---
function flyToRef(refno: string) {
  const viewer = ctx.viewerRef.value;
  if (!viewer) return;
  const entity = viewer.scene.objects[refno];
  if (!entity?.aabb) return;
  viewer.cameraFlight.flyTo({ aabb: entity.aabb, duration: 0.5 });
}

// --- isolate / restore ---
function isolateResults() {
  const viewer = ctx.viewerRef.value;
  if (!viewer) return;
  const resultIds = disciplines.value.flatMap((d) =>
    d.children.map((c) => c.name),
  );
  viewer.scene.setObjectsVisible(Object.keys(viewer.scene.objects), false);
  viewer.scene.setObjectsVisible(resultIds, true);
  // sync local state
  disciplines.value.forEach((d) => {
    d.visible = true;
    d.children.forEach((c) => { c.visible = true; });
  });
  isIsolated.value = true;
}

function restoreAll() {
  const viewer = ctx.viewerRef.value;
  if (!viewer) return;
  viewer.scene.setObjectsVisible(Object.keys(viewer.scene.objects), true);
  disciplines.value.forEach((d) => {
    d.visible = true;
    d.children.forEach((c) => { c.visible = true; });
  });
  isIsolated.value = false;
}

function showAll() {
  const ids = disciplines.value.flatMap((d) => d.children.map((c) => c.name));
  setViewerVisibility(ids, true);
  disciplines.value.forEach((d) => {
    d.visible = true;
    d.children.forEach((c) => { c.visible = true; });
  });
}

function hideAll() {
  const ids = disciplines.value.flatMap((d) => d.children.map((c) => c.name));
  setViewerVisibility(ids, false);
  disciplines.value.forEach((d) => {
    d.visible = false;
    d.children.forEach((c) => { c.visible = false; });
  });
}

// --- quick view request consumption ---
watch(
  () => quickViewReq.request.value,
  (req) => {
    if (req?.kind === 'range_query_from_selection') {
      useSelection();
      nextTick(() => handleQuery());
      quickViewReq.clear();
    }
  },
);

function close() {
  emit('update:open', false);
}
</script>

<template>
  <!-- backdrop: click to close -->
  <Transition name="range-drawer-fade">
    <div
      v-if="open"
      class="absolute inset-0"
      style="z-index: 941"
      @click="close"
    />
  </Transition>

  <!-- drawer panel -->
  <Transition name="range-drawer-slide">
    <div
      v-if="open"
      class="pointer-events-auto absolute bottom-0 right-0 top-0 flex w-80 flex-col border-l border-border bg-background/95 shadow-xl backdrop-blur"
      style="z-index: 942"
      @pointerdown.stop
      @wheel.stop
      @click.stop
    >
      <!-- header -->
      <div class="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div class="text-sm font-semibold">按范围显示</div>
        <button
          type="button"
          class="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted"
          @click="close"
        >
          <X class="h-4 w-4" />
        </button>
      </div>

      <!-- settings section -->
      <div class="space-y-3 border-b border-border/60 p-3">
        <!-- center point -->
        <div class="space-y-1">
          <div class="flex items-center justify-between">
            <label class="text-xs text-muted-foreground">中心点 (x,y,z)</label>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
                :disabled="store.toolMode.value === 'pick_query_center'"
                @click="startPick"
              >
                <MousePointerClick class="h-3 w-3" />
                <span>{{ store.toolMode.value === 'pick_query_center' ? '点击模型...' : '拾取' }}</span>
              </button>
              <span class="text-muted-foreground/50">|</span>
              <button
                type="button"
                class="flex items-center gap-1 text-xs text-primary hover:underline"
                @click="useSelection"
              >
                <Crosshair class="h-3 w-3" />
                <span>使用选中</span>
              </button>
            </div>
          </div>
          <input
            v-model="centerPoint"
            class="flex h-7 w-full rounded-md border border-input bg-background px-2 py-1 text-xs shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="0,0,0"
          />
          <div v-if="pickedModelName" class="text-[11px] text-muted-foreground">
            选中: {{ pickedModelName }}
          </div>
        </div>

        <!-- radius -->
        <div class="space-y-1">
          <div class="flex items-center justify-between">
            <label class="text-xs text-muted-foreground">半径 (m)</label>
            <span class="text-xs tabular-nums text-foreground">{{ rangeSettings.radiusM.value }}</span>
          </div>
          <input
            v-model="rangeSettings.radiusM.value"
            type="range"
            min="1"
            max="500"
            class="w-full"
          />
        </div>

        <!-- spec filter -->
        <div class="space-y-1">
          <label class="text-xs text-muted-foreground">按专业过滤</label>
          <div class="grid grid-cols-2 gap-1.5">
            <label
              v-for="sv in [SiteSpecValue.Pipe, SiteSpecValue.Elec, SiteSpecValue.Inst, SiteSpecValue.Hvac]"
              :key="sv"
              class="flex cursor-pointer items-center gap-1.5 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
            >
              <input
                type="checkbox"
                :checked="rangeSettings.specValues.value.includes(sv)"
                @change="
                  () => {
                    const arr = rangeSettings.specValues.value;
                    const idx = arr.indexOf(sv);
                    if (idx >= 0) arr.splice(idx, 1);
                    else arr.push(sv);
                  }
                "
              />
              <span>{{ getSpecValueName(sv) }}</span>
            </label>
          </div>
        </div>

        <!-- query button -->
        <button
          :disabled="isLoading"
          class="inline-flex h-7 w-full items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          @click="handleQuery"
        >
          {{ isLoading ? '查询中...' : '查询模型' }}
        </button>
        <div v-if="errorMsg" class="text-xs text-destructive">{{ errorMsg }}</div>
      </div>

      <!-- filter bar -->
      <div v-if="disciplines.length > 0" class="border-b border-border/60 px-3 py-2">
        <div class="relative">
          <Search class="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            v-model="filterText"
            placeholder="过滤专业或编号..."
            class="flex h-7 w-full rounded-md border border-input bg-background py-1 pl-7 pr-2 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <div class="mt-1 text-[11px] text-muted-foreground">
          共 {{ totalCount }} 个构件
        </div>
      </div>

      <!-- result list -->
      <div class="flex-1 overflow-auto p-2">
        <div
          v-if="disciplines.length === 0 && !isLoading"
          class="p-4 text-center text-xs text-muted-foreground"
        >
          暂无数据，请先进行查询
        </div>

        <div v-for="discipline in filteredDisciplines" :key="discipline.id" class="mb-1">
          <!-- discipline header -->
          <div
            class="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs hover:bg-muted"
            @click="toggleDisciplineExpand(discipline)"
          >
            <component
              :is="discipline.expanded ? ChevronDown : ChevronRight"
              class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            />
            <span class="flex-1 truncate font-medium">
              {{ discipline.name }}
              <span class="font-normal text-muted-foreground">({{ discipline.children.length }})</span>
            </span>
            <button
              type="button"
              class="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted-foreground/20"
              :title="discipline.visible ? '隐藏该专业' : '显示该专业'"
              @click="toggleDisciplineVisible(discipline, $event)"
            >
              <component
                :is="discipline.visible ? Eye : EyeOff"
                class="h-3 w-3"
              />
            </button>
          </div>

          <!-- children -->
          <div v-if="discipline.expanded" class="ml-4">
            <div
              v-for="child in discipline.children"
              :key="child.id"
              class="group flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs hover:bg-muted"
              @click="flyToRef(child.name)"
            >
              <span class="flex-1 truncate font-mono text-[11px]">{{ child.name }}</span>
              <button
                type="button"
                class="inline-flex h-5 w-5 items-center justify-center rounded opacity-0 hover:bg-muted-foreground/20 group-hover:opacity-100"
                title="定位"
                @click.stop="flyToRef(child.name)"
              >
                <Locate class="h-3 w-3" />
              </button>
              <button
                type="button"
                class="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted-foreground/20"
                :title="child.visible ? '隐藏' : '显示'"
                @click="toggleRefVisible(child, $event)"
              >
                <component
                  :is="child.visible ? Eye : EyeOff"
                  class="h-3 w-3"
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- bottom action bar -->
      <div
        v-if="disciplines.length > 0"
        class="flex items-center gap-1.5 border-t border-border/60 px-3 py-2"
      >
        <button
          type="button"
          class="flex-1 rounded-md border border-input px-2 py-1 text-xs hover:bg-muted"
          @click="showAll"
        >
          全部显示
        </button>
        <button
          type="button"
          class="flex-1 rounded-md border border-input px-2 py-1 text-xs hover:bg-muted"
          @click="hideAll"
        >
          全部隐藏
        </button>
        <button
          type="button"
          class="flex-1 rounded-md px-2 py-1 text-xs"
          :class="
            isIsolated
              ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          "
          @click="isIsolated ? restoreAll() : isolateResults()"
        >
          {{ isIsolated ? '恢复全部' : '隔离显示' }}
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* slide transition */
.range-drawer-slide-enter-active,
.range-drawer-slide-leave-active {
  transition: transform 0.25s ease;
}
.range-drawer-slide-enter-from,
.range-drawer-slide-leave-to {
  transform: translateX(100%);
}

/* fade backdrop */
.range-drawer-fade-enter-active,
.range-drawer-fade-leave-active {
  transition: opacity 0.25s ease;
}
.range-drawer-fade-enter-from,
.range-drawer-fade-leave-to {
  opacity: 0;
}
</style>
