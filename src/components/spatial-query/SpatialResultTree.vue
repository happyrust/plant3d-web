<template>
  <div class="space-y-1 text-xs" data-testid="spatial-tree">
    <div v-if="tree.rooms.length === 0" class="px-1 py-3 text-center text-[11px] text-gray-400">
      所选房间里没有命中的构件。
    </div>

    <div v-for="room in tree.rooms" :key="room.refno" data-testid="spatial-tree-room" :data-room-refno="room.refno">
      <!-- 房间 -->
      <div class="group flex items-center gap-1 rounded-md px-1 py-1 hover:bg-gray-50">
        <button type="button"
          class="shrink-0 rounded p-0.5 text-gray-500 hover:bg-white"
          :aria-expanded="isOpen(roomId(room), true)"
          data-testid="spatial-tree-toggle"
          @click="toggle(roomId(room), true)">
          <ChevronDown v-if="isOpen(roomId(room), true)" class="h-3.5 w-3.5" />
          <ChevronRight v-else class="h-3.5 w-3.5" />
        </button>
        <span class="min-w-0 flex-1 truncate font-semibold text-gray-900" :title="room.name ?? room.refno">
          {{ room.room_num }}<span v-if="room.name" class="font-normal text-gray-500"> · {{ room.name }}</span>
        </span>
        <span class="shrink-0 font-mono text-[11px] text-gray-500" data-testid="spatial-tree-count">{{ room.count }}</span>
        <SpatialResultTreeNodeActions :target="{ kind: 'room', node: room }" :busy="busy" @load="onLoad" @show-only="onShowOnly" @isolate="onIsolate" />
      </div>

      <div v-if="isOpen(roomId(room), true)" class="ml-3 border-l border-gray-100 pl-1.5">
        <!-- 专业 -->
        <div v-for="spec in room.specs" :key="spec.spec_value" data-testid="spatial-tree-spec" :data-spec-value="spec.spec_value">
          <div class="group flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-gray-50">
            <button type="button"
              class="shrink-0 rounded p-0.5 text-gray-500 hover:bg-white"
              :aria-expanded="isOpen(specId(room, spec), true)"
              data-testid="spatial-tree-toggle"
              @click="toggle(specId(room, spec), true)">
              <ChevronDown v-if="isOpen(specId(room, spec), true)" class="h-3.5 w-3.5" />
              <ChevronRight v-else class="h-3.5 w-3.5" />
            </button>
            <span class="inline-block h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: getSpecBadgeStyle(spec.spec_value).fg }" />
            <span class="min-w-0 flex-1 truncate font-medium text-gray-800">{{ getSpecValueName(spec.spec_value) }}</span>
            <span class="shrink-0 font-mono text-[11px] text-gray-500" data-testid="spatial-tree-count">{{ spec.count }}</span>
            <SpatialResultTreeNodeActions :target="{ kind: 'spec', node: spec }" :busy="busy" @load="onLoad" @show-only="onShowOnly" @isolate="onIsolate" />
          </div>

          <div v-if="isOpen(specId(room, spec), true)" class="ml-3 border-l border-gray-100 pl-1.5">
            <!-- 最小交付单元类型 -->
            <div v-for="group in spec.unit_types" :key="group.noun" data-testid="spatial-tree-unit-type" :data-noun="group.noun">
              <div class="group flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-gray-50">
                <button type="button"
                  class="shrink-0 rounded p-0.5 text-gray-500 hover:bg-white"
                  :aria-expanded="isOpen(unitTypeId(room, spec, group), true)"
                  data-testid="spatial-tree-toggle"
                  @click="toggle(unitTypeId(room, spec, group), true)">
                  <ChevronDown v-if="isOpen(unitTypeId(room, spec, group), true)" class="h-3.5 w-3.5" />
                  <ChevronRight v-else class="h-3.5 w-3.5" />
                </button>
                <span class="min-w-0 flex-1 truncate text-gray-700">
                  {{ group.noun }}<span class="text-gray-400"> · {{ group.units.length }} 个单元</span>
                </span>
                <span class="shrink-0 font-mono text-[11px] text-gray-500" data-testid="spatial-tree-count">{{ group.count }}</span>
                <SpatialResultTreeNodeActions :target="{ kind: 'unitType', node: group }" :busy="busy" @load="onLoad" @show-only="onShowOnly" @isolate="onIsolate" />
              </div>

              <div v-if="isOpen(unitTypeId(room, spec, group), true)" class="ml-3 border-l border-gray-100 pl-1.5">
                <!-- 单元 -->
                <div v-for="unit in group.units" :key="unit.refno" data-testid="spatial-tree-unit" :data-refno="unit.refno">
                  <div class="group flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-gray-50">
                    <button type="button"
                      class="shrink-0 rounded p-0.5 text-gray-500 hover:bg-white"
                      :aria-expanded="isOpen(unitId(room, unit), false)"
                      data-testid="spatial-tree-toggle"
                      @click="toggleLeaves(unitId(room, unit), unit.elements, { unit: unit.refno })">
                      <ChevronDown v-if="isOpen(unitId(room, unit), false)" class="h-3.5 w-3.5" />
                      <ChevronRight v-else class="h-3.5 w-3.5" />
                    </button>
                    <span class="min-w-0 flex-1 truncate text-gray-800" :title="unit.refno">
                      {{ unit.name || unit.refno }}<span class="text-gray-400"> · {{ formatDistance(unit.min_distance) }}</span>
                    </span>
                    <span class="shrink-0 font-mono text-[11px] text-gray-500" data-testid="spatial-tree-count">{{ unit.count }}</span>
                    <SpatialResultTreeNodeActions :target="{ kind: 'unit', node: unit }" :busy="busy" expandable @load="onLoad" @show-only="onShowOnly" @isolate="onIsolate" />
                  </div>
                  <SpatialResultTreeLeaves v-if="isOpen(unitId(room, unit), false)"
                    :leaves="unit.elements"
                    :items-by-refno="itemsByRefno"
                    :active-refno="activeRefno"
                    @focus="emit('focus', $event)"
                    @toggle-visible="emit('toggleVisible', $event)" />
                </div>
              </div>
            </div>

            <!-- 其他构件 -->
            <div v-if="spec.others.count > 0" data-testid="spatial-tree-others">
              <div class="group flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-gray-50">
                <button type="button"
                  class="shrink-0 rounded p-0.5 text-gray-500 hover:bg-white"
                  :aria-expanded="isOpen(othersId(room, spec), false)"
                  data-testid="spatial-tree-toggle"
                  @click="toggle(othersId(room, spec), false)">
                  <ChevronDown v-if="isOpen(othersId(room, spec), false)" class="h-3.5 w-3.5" />
                  <ChevronRight v-else class="h-3.5 w-3.5" />
                </button>
                <span class="min-w-0 flex-1 truncate text-gray-700">
                  其他构件<span class="text-gray-400"> · 不属任何最小交付单元</span>
                </span>
                <span class="shrink-0 font-mono text-[11px] text-gray-500" data-testid="spatial-tree-count">{{ spec.others.count }}</span>
                <SpatialResultTreeNodeActions :target="{ kind: 'others', node: spec.others }" :busy="busy" @load="onLoad" @show-only="onShowOnly" @isolate="onIsolate" />
              </div>

              <div v-if="isOpen(othersId(room, spec), false)" class="ml-3 border-l border-gray-100 pl-1.5">
                <div v-for="group in spec.others.by_noun" :key="group.noun" data-testid="spatial-tree-other-noun" :data-noun="group.noun">
                  <div class="group flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-gray-50">
                    <button type="button"
                      class="shrink-0 rounded p-0.5 text-gray-500 hover:bg-white"
                      :aria-expanded="isOpen(otherNounId(room, spec, group), false)"
                      data-testid="spatial-tree-toggle"
                      @click="toggleLeaves(otherNounId(room, spec, group), group.elements, { otherNoun: group.noun })">
                      <ChevronDown v-if="isOpen(otherNounId(room, spec, group), false)" class="h-3.5 w-3.5" />
                      <ChevronRight v-else class="h-3.5 w-3.5" />
                    </button>
                    <span class="min-w-0 flex-1 truncate text-gray-800">
                      {{ group.noun }}<span class="text-gray-400"> · {{ formatDistance(group.min_distance) }}</span>
                    </span>
                    <span class="shrink-0 font-mono text-[11px] text-gray-500" data-testid="spatial-tree-count">{{ group.count }}</span>
                    <SpatialResultTreeNodeActions :target="{ kind: 'otherNoun', node: group }" :busy="busy" expandable @load="onLoad" @show-only="onShowOnly" @isolate="onIsolate" />
                  </div>
                  <SpatialResultTreeLeaves v-if="isOpen(otherNounId(room, spec, group), false)"
                    :leaves="group.elements"
                    :items-by-refno="itemsByRefno"
                    :active-refno="activeRefno"
                    @focus="emit('focus', $event)"
                    @toggle-visible="emit('toggleVisible', $event)" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue';

import { ChevronDown, ChevronRight } from 'lucide-vue-next';

import SpatialResultTreeLeaves from './SpatialResultTreeLeaves.vue';
import SpatialResultTreeNodeActions from './SpatialResultTreeNodeActions.vue';

import type {
  SpatialTreeLeafNode,
  SpatialTreeLeafSelector,
  SpatialTreeOtherNounNode,
  SpatialTreeResult,
  SpatialTreeRoomNode,
  SpatialTreeSpecNode,
  SpatialTreeUnitNode,
  SpatialTreeUnitTypeNode,
} from '@/api/genModelSpatialApi';
import type { SpatialQueryResultItem } from '@/types/spatialQuery';

import { getSpecBadgeStyle, getSpecValueName } from '@/types/spec';

const METERS_TO_MM = 1000;

/**
 * 房间层级树（ADR 0068）：房间 → 专业 → 最小交付单元类型 → 单元 → 构件，专业下另有「其他构件」按 noun 分。
 * 每一层一行（标题 · 计数 · 悬停出 加载 / 仅显示 / 隔离），叶子一行（refno · noun · 距离，未加载灰字）。
 * 缺省房间 / 专业 / 单元类型展开、单元与其他构件收起。叶子未内联（服务端超上限）的单元 / noun 组第一次展开时
 * `expand` 让 store 去取那一组。
 */
const props = defineProps<{
  tree: SpatialTreeResult;
  /** store 里的条目（loaded / visible 由它来），按 refno 查 */
  items: SpatialQueryResultItem[];
  activeRefno: string | null;
  busy?: boolean;
}>();

const emit = defineEmits<{
  focus: [item: SpatialQueryResultItem];
  toggleVisible: [item: SpatialQueryResultItem];
  load: [refnos: string[], label: string];
  showOnly: [refnos: string[]];
  isolate: [refnos: string[]];
  expand: [selector: SpatialTreeLeafSelector];
}>();

const itemsByRefno = computed(() => new Map(props.items.map((item) => [item.refno, item])));

/** 折叠状态只记「被点过的」；没点过的按各层缺省。 */
const toggled = reactive(new Map<string, boolean>());
/** 已经为它发过 `expand` 的节点，免得反复请求 */
const requested = reactive(new Set<string>());

function isOpen(id: string, defaultOpen: boolean): boolean {
  return toggled.get(id) ?? defaultOpen;
}

function toggle(id: string, defaultOpen: boolean): void {
  toggled.set(id, !isOpen(id, defaultOpen));
}

/** 单元 / noun 组：展开时叶子还没内联就去取一次。 */
function toggleLeaves(id: string, leaves: SpatialTreeLeafNode[] | undefined, selector: SpatialTreeLeafSelector): void {
  const opening = !isOpen(id, false);
  toggle(id, false);
  if (opening && !leaves && !requested.has(id)) {
    requested.add(id);
    emit('expand', selector);
  }
}

const roomId = (room: SpatialTreeRoomNode) => `room:${room.refno}`;
const specId = (room: SpatialTreeRoomNode, spec: SpatialTreeSpecNode) => `spec:${room.refno}:${spec.spec_value}`;
const unitTypeId = (room: SpatialTreeRoomNode, spec: SpatialTreeSpecNode, group: SpatialTreeUnitTypeNode) =>
  `ut:${room.refno}:${spec.spec_value}:${group.noun}`;
const unitId = (room: SpatialTreeRoomNode, unit: SpatialTreeUnitNode) => `unit:${room.refno}:${unit.refno}`;
const othersId = (room: SpatialTreeRoomNode, spec: SpatialTreeSpecNode) => `others:${room.refno}:${spec.spec_value}`;
const otherNounId = (room: SpatialTreeRoomNode, spec: SpatialTreeSpecNode, group: SpatialTreeOtherNounNode) =>
  `on:${room.refno}:${spec.spec_value}:${group.noun}`;

function formatDistance(distance: number): string {
  const meters = distance / METERS_TO_MM;
  return `${meters >= 10 ? meters.toFixed(0) : meters.toFixed(2)} m`;
}

function onLoad(refnos: string[], label: string): void {
  emit('load', refnos, label);
}

function onShowOnly(refnos: string[]): void {
  emit('showOnly', refnos);
}

function onIsolate(refnos: string[]): void {
  emit('isolate', refnos);
}
</script>
