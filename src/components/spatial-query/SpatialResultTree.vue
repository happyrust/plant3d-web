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
        <div class="relative min-w-0 flex-1">
          <div class="truncate font-semibold text-gray-900" :title="roomTitle(room)">{{ room.room_num }}</div>
          <SpatialResultTreeNodeActions :target="{ kind: 'room', node: room }" :busy="busy" @load="onLoad" @show-only="onShowOnly" @isolate="onIsolate" />
        </div>
        <span class="shrink-0 font-mono text-[11px] text-gray-500" data-testid="spatial-tree-count">{{ room.count }}</span>
      </div>

      <div v-if="isOpen(roomId(room), true)" class="ml-2 border-l border-gray-100 pl-1">
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
            <div class="relative min-w-0 flex-1">
              <div class="truncate font-medium text-gray-800" :title="specTitle(spec)">{{ getSpecValueName(spec.spec_value) }}</div>
              <SpatialResultTreeNodeActions :target="{ kind: 'spec', node: spec }" :busy="busy" @load="onLoad" @show-only="onShowOnly" @isolate="onIsolate" />
            </div>
            <span class="shrink-0 font-mono text-[11px] text-gray-500" data-testid="spatial-tree-count">{{ spec.count }}</span>
          </div>

          <div v-if="isOpen(specId(room, spec), true)" class="ml-2 border-l border-gray-100 pl-1">
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
                <div class="relative min-w-0 flex-1">
                  <div class="flex min-w-0 items-center gap-1 text-gray-700" :title="`${group.noun} · ${group.units.length} 个单元 · ${countPhrase(group.count, group.tube_count)}`">
                    <span class="truncate">{{ group.noun }}</span>
                    <span class="shrink-0 text-[11px] text-gray-400">{{ group.units.length }} 个单元</span>
                  </div>
                  <SpatialResultTreeNodeActions :target="{ kind: 'unitType', node: group }" :busy="busy" @load="onLoad" @show-only="onShowOnly" @isolate="onIsolate" />
                </div>
                <span class="shrink-0 font-mono text-[11px] text-gray-500" data-testid="spatial-tree-count">{{ group.count }}</span>
              </div>

              <div v-if="isOpen(unitTypeId(room, spec, group), true)" class="ml-2 border-l border-gray-100 pl-1">
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
                    <div class="relative min-w-0 flex-1">
                      <div class="flex min-w-0 items-center gap-1 text-gray-800" :title="unitTitle(unit)">
                        <span class="truncate">{{ unit.name || unit.refno }}</span>
                        <span class="shrink-0 text-[11px] tabular-nums text-gray-400">{{ formatDistance(unit.min_distance) }}</span>
                        <span v-if="unit.tube_count"
                          class="shrink-0 text-[11px] tabular-nums text-gray-400"
                          data-testid="spatial-tree-tube-count">{{ unit.tube_count }} 段直管</span>
                      </div>
                      <SpatialResultTreeNodeActions :target="{ kind: 'unit', node: unit }" :busy="busy" expandable @load="onLoad" @show-only="onShowOnly" @isolate="onIsolate" />
                    </div>
                    <span class="shrink-0 font-mono text-[11px] text-gray-500" data-testid="spatial-tree-count">{{ unit.count }}</span>
                  </div>
                  <SpatialResultTreeLeaves v-if="isOpen(unitId(room, unit), false)"
                    :leaves="unit.elements"
                    :items-by-refno="itemsByRefno"
                    :active-refno="activeRefno"
                    @focus="emit('focus', $event)"
                    @toggle-visible="emit('toggleVisible', $event)" />
                  <!-- 直段行（方案 B）：跟着 elements 一起来（同一套内联规则），构件行之后列 -->
                  <SpatialResultTreeTubes v-if="isOpen(unitId(room, unit), false) && unit.tubes"
                    :unit="unit"
                    :tubes="unit.tubes"
                    :segment-hidden="tubeSegmentHidden"
                    :segment-loaded="tubeSegmentLoaded"
                    @focus-tube="onFocusTube"
                    @toggle-tube-visible="onToggleTubeVisible" />
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
                <div class="relative min-w-0 flex-1">
                  <div class="truncate text-gray-700" :title="`其他构件 · 不属任何最小交付单元的构件，按 noun 分 · ${spec.others.count} 个`">其他构件</div>
                  <SpatialResultTreeNodeActions :target="{ kind: 'others', node: spec.others }" :busy="busy" @load="onLoad" @show-only="onShowOnly" @isolate="onIsolate" />
                </div>
                <span class="shrink-0 font-mono text-[11px] text-gray-500" data-testid="spatial-tree-count">{{ spec.others.count }}</span>
              </div>

              <div v-if="isOpen(othersId(room, spec), false)" class="ml-2 border-l border-gray-100 pl-1">
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
                    <div class="relative min-w-0 flex-1">
                      <div class="flex min-w-0 items-center gap-1 text-gray-800" :title="`${group.noun} · 不属任何最小交付单元 · 最近 ${formatDistance(group.min_distance)} · ${group.count} 个`">
                        <span class="truncate">{{ group.noun }}</span>
                        <span class="shrink-0 text-[11px] tabular-nums text-gray-400">{{ formatDistance(group.min_distance) }}</span>
                      </div>
                      <SpatialResultTreeNodeActions :target="{ kind: 'otherNoun', node: group }" :busy="busy" expandable @load="onLoad" @show-only="onShowOnly" @isolate="onIsolate" />
                    </div>
                    <span class="shrink-0 font-mono text-[11px] text-gray-500" data-testid="spatial-tree-count">{{ group.count }}</span>
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
import SpatialResultTreeTubes from './SpatialResultTreeTubes.vue';

import type {
  SpatialTreeLeafNode,
  SpatialTreeLeafSelector,
  SpatialTreeOtherNounNode,
  SpatialTreeResult,
  SpatialTreeRoomNode,
  SpatialTreeSpecNode,
  SpatialTreeTubeNode,
  SpatialTreeUnitNode,
  SpatialTreeUnitTypeNode,
} from '@/api/genModelSpatialApi';
import type { SpatialQueryResultItem } from '@/types/spatialQuery';

import { countPhrase } from '@/composables/spatialTree';
import { getSpecBadgeStyle, getSpecValueName } from '@/types/spec';

const METERS_TO_MM = 1000;

/**
 * 房间层级树（ADR 0068）：房间 → 专业 → 最小交付单元类型 → 单元 → 构件，专业下另有「其他构件」按 noun 分。
 * 每一层一行（标题 · 计数 · 悬停出 加载 / 仅显示 / 隔离），叶子一行（refno · noun · 距离，未加载灰字）。
 * 缺省房间 / 专业 / 单元类型展开、单元与其他构件收起。叶子未内联（服务端超上限）的单元 / noun 组第一次展开时
 * `expand` 让 store 去取那一组。
 *
 * 行文字（336 px 抽屉）：只把一个主标识放行上——房间行是房号、单元行是名字（没有名字才 refno）、其他构件行只四个字；
 * 名字 / refno / 说明 / 构件数全进 `title`，悬停可读。距离、「N 个单元」这类短尾巴 `shrink-0` 不被截，长的主标识 `truncate`。
 * 三个动作按钮不占行宽（见 `SpatialResultTreeNodeActions`），计数始终贴右。
 *
 * 直段（方案 B，2026-09-22）：服务端认 `tubes=1` 时 BRAN 单元下多一组直段行（`SpatialResultTreeTubes`，构件行之后），
 * 单元行尾巴「N 段直管」，各层 `title` 的计数句改成「N 个构件 · M 段直管」；计数格仍是构件数——直段不是构件。
 * 直段行点行 / 箭头选中所属 BRAN 并定位（D5 (i)），眼睛逐段显隐那一段直管对象（T4，D5 (ii)）；老服务端没有这些键时一切照旧。
 */
const props = defineProps<{
  tree: SpatialTreeResult;
  /** store 里的条目（loaded / visible 由它来），按 refno 查 */
  items: SpatialQueryResultItem[];
  activeRefno: string | null;
  busy?: boolean;
  /** 直段行眼睛的状态源（测试注桩；缺省读 DTX 加载链的运行时索引，见 `SpatialResultTreeTubes`） */
  tubeSegmentHidden?: (key: string) => boolean;
  tubeSegmentLoaded?: (key: string) => boolean;
}>();

const emit = defineEmits<{
  focus: [item: SpatialQueryResultItem];
  toggleVisible: [item: SpatialQueryResultItem];
  load: [refnos: string[], label: string];
  showOnly: [refnos: string[]];
  isolate: [refnos: string[]];
  expand: [selector: SpatialTreeLeafSelector];
  /** 直段行：选中所属 BRAN + 按直段盒定位（D5 (i)） */
  focusTube: [unit: SpatialTreeUnitNode, tube: SpatialTreeTubeNode];
  /** 直段行的眼睛：只显 / 隐那一段直管对象（T4） */
  toggleTubeVisible: [unit: SpatialTreeUnitNode, tube: SpatialTreeTubeNode];
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

/** 专业行的 title：名字 · 专业 N（服务端给了直段数才追「· N 个构件 · M 段直管」，老服务端下与改前一字不差） */
function specTitle(spec: SpatialTreeSpecNode): string {
  const base = `${getSpecValueName(spec.spec_value)} · 专业 ${spec.spec_value}`;
  return typeof spec.tube_count === 'number' ? `${base} · ${countPhrase(spec.count, spec.tube_count)}` : base;
}

/** 房间行的 title：房号 · 名字 · refno · 构件数（· 直段数）（行上只显房号） */
function roomTitle(room: SpatialTreeRoomNode): string {
  return [room.room_num, room.name, room.refno, countPhrase(room.count, room.tube_count)].filter(Boolean).join(' · ');
}

/** 单元行的 title：名字 · noun refno · 最近距离 · 构件数（· 直段数）（行上只显名字，没名字才显 refno） */
function unitTitle(unit: SpatialTreeUnitNode): string {
  return [unit.name, `${unit.noun} ${unit.refno}`, `最近 ${formatDistance(unit.min_distance)}`, countPhrase(unit.count, unit.tube_count)].filter(Boolean).join(' · ');
}

function onLoad(refnos: string[], label: string): void {
  emit('load', refnos, label);
}

function onFocusTube(unit: SpatialTreeUnitNode, tube: SpatialTreeTubeNode): void {
  emit('focusTube', unit, tube);
}

function onToggleTubeVisible(unit: SpatialTreeUnitNode, tube: SpatialTreeTubeNode): void {
  emit('toggleTubeVisible', unit, tube);
}

function onShowOnly(refnos: string[]): void {
  emit('showOnly', refnos);
}

function onIsolate(refnos: string[]): void {
  emit('isolate', refnos);
}
</script>
