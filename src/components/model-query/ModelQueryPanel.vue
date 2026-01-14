<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';

import { ChevronDown, ChevronRight, Crosshair, Eye, EyeOff, Filter, MousePointerClick, Search } from 'lucide-vue-next';

import { useToolStore } from '@/composables/useToolStore';
import { useViewerContext } from '@/composables/useViewerContext';
import { cn } from '@/lib/utils';
import { SiteSpecValue, getSpecValueName } from '@/types/spec';

type RefNode = {
  id: string;
  name: string; // RefNo
  visible: boolean;
};

type DisciplineNode = {
  id: string;
  name: string;
  visible: boolean;
  expanded: boolean;
  children: RefNode[];
};

const disciplines = ref<DisciplineNode[]>([]);
const rangeRadius = ref(50);
const centerPoint = ref('0,0,0');
const isLoading = ref(false);
const errorMsg = ref('');
const pickedModelName = ref('');

const ctx = useViewerContext();
const store = useToolStore();

watch(
  () => store.pickedQueryCenter.value,
  (val) => {
    if (val) {
      centerPoint.value = `${val.worldPos[0].toFixed(2)},${val.worldPos[1].toFixed(2)},${val.worldPos[2].toFixed(2)}`;
      pickedModelName.value = val.entityId;
    }
  }
);

function startPick() {
  store.setToolMode('pick_query_center');
  store.setPickedQueryCenter(null);
  pickedModelName.value = '';
}

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

// Noun to Discipline Mapping
const NOUN_MAPPING: Record<string, string> = {
  // ARCH
  WALL: '建筑 (ARCH)',
  SLAB: '建筑 (ARCH)',
  WIND: '建筑 (ARCH)',
  DOOR: '建筑 (ARCH)',
  ROOF: '建筑 (ARCH)',
  FLOO: '建筑 (ARCH)',
  // STRU
  COLU: '结构 (STRU)',
  BEAM: '结构 (STRU)',
  // HVAC
  DUCT: '暖通 (HVAC)',
  BEND: '暖通 (HVAC)',
  // PIPING
  PIPE: '管道 (PIPING)',
  ELBO: '管道 (PIPING)',
  TEE: '管道 (PIPING)',
  VALV: '管道 (PIPING)',
  FLAN: '管道 (PIPING)',
  // ELEC
  CABL: '电气 (ELEC)',
  TRAY: '电气 (ELEC)',
  // EQUI
  EQUI: '设备 (EQUI)',
  // DEFAULT
  UNKNOWN: '其他 (OTHER)',
};

function getDisciplineName(noun: string): string {
  const n = noun.toUpperCase();
  // Simple prefix matching if needed, or exact match
  if (NOUN_MAPPING[n]) return NOUN_MAPPING[n];
  if (n.startsWith('STR')) return '结构 (STRU)';
  if (n.startsWith('H')) return '暖通 (HVAC)';
  return '其他 (OTHER)';
}

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
  // Cascade visibility to children
  node.children.forEach((child) => {
    child.visible = node.visible;
  });
  // Apply to viewer
  const ids = node.children.map((c) => c.name);
  setViewerVisibility(ids, node.visible);
}

function toggleRefVisible(child: RefNode, parent: DisciplineNode, e: Event) {
  e.stopPropagation();
  child.visible = !child.visible;
  // Apply to viewer
  setViewerVisibility([child.name], child.visible);
}

const filterText = ref('');

const filteredDisciplines = computed(() => {
  if (!filterText.value) return disciplines.value;
  return disciplines.value
    .map((d) => {
      const matchesDiscipline = d.name.toLowerCase().includes(filterText.value.toLowerCase());
      const matchingChildren = d.children.filter((c) => c.name.toLowerCase().includes(filterText.value.toLowerCase()));

      if (matchesDiscipline || matchingChildren.length > 0) {
        return {
          ...d,
          // If discipline matches, show all children (or maybe just matching ones? let's show all for now if parent matches)
          // If only children match, show only those children.
          children: matchesDiscipline ? d.children : matchingChildren,
        };
      }
      return null;
    })
    .filter(Boolean) as DisciplineNode[];
});

function handleQuery() {
  const viewer = ctx.viewerRef.value;
  if (!viewer) {
    errorMsg.value = '查看器未就绪';
    return;
  }

  // Parse center
  const parts = centerPoint.value.split(',').map((s) => parseFloat(s.trim()));
  if (parts.length !== 3 || parts.some(isNaN)) {
    errorMsg.value = '中心点格式错误，应为 "x,y,z"';
    return;
  }
  const cx = parts[0]!;
  const cy = parts[1]!;
  const cz = parts[2]!;
  const r = rangeRadius.value;

  const minx = cx - r;
  const miny = cy - r;
  const minz = cz - r;
  const maxx = cx + r;
  const maxy = cy + r;
  const maxz = cz + r;

  isLoading.value = true;
  errorMsg.value = '';
  disciplines.value = [];

  try {
    // Query using xeokit scene objects
    const objects = viewer.scene.objects;
    const groups: Record<string, RefNode[]> = {};
    const metaByRefno = (viewer.scene as unknown as { __aiosMetaByRefno?: Record<string, { category: string; name: string; specValue?: SiteSpecValue }> }).__aiosMetaByRefno || {};

    for (const id of Object.keys(objects)) {
      const entity = objects[id];
      if (!entity || !entity.aabb) continue;

      const aabb = entity.aabb as [number, number, number, number, number, number];
      // Check if entity AABB intersects with query AABB
      if (
        aabb[3] >= minx && aabb[0] <= maxx &&
        aabb[4] >= miny && aabb[1] <= maxy &&
        aabb[5] >= minz && aabb[2] <= maxz
      ) {
        // Get spec_value from metadata
        const meta = metaByRefno[id];
        const specValue = meta?.specValue ?? SiteSpecValue.Unknown;
        const specName = getSpecValueName(specValue);

        if (!groups[specName]) {
          groups[specName] = [];
        }

        groups[specName].push({
          id: `node_${id}`,
          name: id,
          visible: entity.visible !== false,
        });
      }
    }

    // Convert to DisciplineNode array
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

</script>

<template>
  <div class="flex h-full flex-col bg-background">
    <!-- Query Section -->
    <div class="space-y-4 border-b border-border/60 p-4">
      <h3 class="text-sm font-semibold">范围查询</h3>
      <div class="grid gap-3">
        <div class="space-y-1">
          <div class="flex items-center justify-between">
            <label class="text-xs text-muted-foreground">中心点 (x,y,z)</label>
            <div class="flex items-center gap-2">
              <button type="button" class="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50" :disabled="store.toolMode.value === 'pick_query_center'" @click="startPick">
                <MousePointerClick class="h-3 w-3" />
                <span>{{ store.toolMode.value === 'pick_query_center' ? '点击模型...' : '拾取' }}</span>
              </button>
              <span class="text-muted-foreground/50">|</span>
              <button type="button" class="flex items-center gap-1 text-xs text-primary hover:underline" @click="useSelection">
                <Crosshair class="h-3 w-3" />
                <span>使用选中</span>
              </button>
            </div>
          </div>
          <input v-model="centerPoint"
            class="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="0,0,0" />
          <div v-if="pickedModelName" class="text-xs text-muted-foreground">
            选中: {{ pickedModelName }}
          </div>
        </div>
        <div class="space-y-1">
          <label class="text-xs text-muted-foreground">半径 (m)</label>
          <div class="flex items-center gap-2">
            <input v-model="rangeRadius" type="range" min="1" max="500" class="flex-1" />
            <span class="w-8 text-right text-xs">{{ rangeRadius }}</span>
          </div>
        </div>
        <button :disabled="isLoading"
          class="inline-flex h-8 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          @click="handleQuery">
          {{ isLoading ? '查询中...' : '查询模型' }}
        </button>
        <div v-if="errorMsg" class="text-xs text-destructive">{{ errorMsg }}</div>
      </div>
    </div>

    <!-- Filter & List Section -->
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="border-b border-border/60 p-2">
        <div class="relative">
          <Search class="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input v-model="filterText"
            placeholder="过滤专业或编号..."
            class="flex h-9 w-full rounded-md border border-input bg-background py-1 pl-8 pr-3 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
        </div>
      </div>

      <div class="flex-1 overflow-auto p-2">
        <div v-if="disciplines.length === 0 && !isLoading" class="p-4 text-center text-sm text-muted-foreground">
          暂无数据，请先进行查询
        </div>

        <div v-for="discipline in filteredDisciplines" :key="discipline.id" class="mb-1">
          <!-- Discipline Node -->
          <div class="group flex cursor-pointer select-none items-center gap-2 rounded-sm p-1.5 text-sm hover:bg-muted/50"
            @click="toggleDisciplineExpand(discipline)">
            <button type="button"
              class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-muted hover:text-foreground">
              <ChevronDown v-if="discipline.expanded" class="h-4 w-4" />
              <ChevronRight v-else class="h-4 w-4" />
            </button>

            <span class="flex-1 truncate font-medium">{{ discipline.name }}</span>
            <span class="mr-2 text-xs text-muted-foreground">{{ discipline.children.length }}</span>

            <button type="button"
              class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              :class="discipline.visible ? 'opacity-100' : 'opacity-70'"
              @click="(e) => toggleDisciplineVisible(discipline, e)">
              <Eye v-if="discipline.visible" class="h-4 w-4" />
              <EyeOff v-else class="h-4 w-4" />
            </button>
          </div>

          <!-- Children -->
          <div v-if="discipline.expanded" class="ml-4 mt-1 space-y-0.5 border-l border-border/40 pl-2">
            <div v-for="child in discipline.children" :key="child.id"
              class="group flex items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-muted/50">
              <span class="flex-1 truncate text-muted-foreground">{{ child.name }}</span>

              <button type="button"
                class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                :class="!child.visible ? 'opacity-100 text-destructive/70' : ''"
                @click="(e) => toggleRefVisible(child, discipline, e)">
                <Eye v-if="child.visible" class="h-3.5 w-3.5" />
                <EyeOff v-else class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        <div v-if="filteredDisciplines.length === 0 && disciplines.length > 0"
          class="p-4 text-center text-sm text-muted-foreground">
          无匹配结果
        </div>
      </div>
    </div>
  </div>
</template>
