<template>
  <div v-if="tubes.length > 0" class="ml-2 border-l border-gray-100 pl-1" data-testid="spatial-tree-tubes" :data-unit-refno="unit.refno">
    <div v-for="tube in tubes"
      :key="tubeKey(unit.refno, tube)"
      class="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-gray-50"
      data-testid="spatial-tree-tube-row"
      :data-tube-key="tubeKey(unit.refno, tube)"
      :data-invalid="tube.invalid ? 'true' : undefined"
      :data-tube-hidden="segmentState(tube) === 'hidden' ? 'true' : undefined"
      :data-tube-loaded="segmentState(tube) === 'unloaded' ? 'false' : 'true'">
      <button type="button"
        class="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px]"
        :class="segmentState(tube) === 'hidden' ? 'text-gray-400' : ''"
        :title="tubeTitle(tube)"
        @click="emit('focusTube', unit, tube)">
        <span class="shrink-0 text-gray-400">直管</span>
        <span class="truncate" :class="segmentState(tube) === 'hidden' ? 'text-gray-400' : 'text-gray-800'">{{ tubeLabel(tube) }}</span>
        <span class="shrink-0 tabular-nums text-gray-400">{{ formatTubeLength(tube.length) }}</span>
        <span v-if="tube.invalid"
          class="shrink-0 rounded bg-danger-subtle px-1 text-[10px] text-danger"
          data-testid="spatial-tree-tube-invalid">
          无效
        </span>
        <span v-if="tube.shared_rooms && tube.shared_rooms > 1"
          class="shrink-0 rounded bg-warning-subtle px-1 text-[10px] text-warning"
          data-testid="spatial-tree-shared">
          跨 {{ tube.shared_rooms }} 房
        </span>
      </button>
      <button type="button"
        class="shrink-0 rounded p-0.5 hover:bg-white hover:text-gray-800"
        :class="segmentState(tube) === 'unloaded' ? 'text-gray-300' : 'text-gray-500'"
        :title="eyeTitle(tube)"
        data-testid="spatial-tree-tube-visibility"
        @click.stop="emit('toggleTubeVisible', unit, tube)">
        <EyeOff v-if="segmentState(tube) === 'hidden'" class="h-3.5 w-3.5" />
        <Eye v-else class="h-3.5 w-3.5" />
      </button>
      <button type="button"
        class="shrink-0 rounded p-0.5 text-gray-500 hover:bg-white hover:text-gray-800"
        title="飞行定位（选中所属 BRAN）"
        data-testid="spatial-tree-tube-locate"
        @click.stop="emit('focusTube', unit, tube)">
        <ArrowUpRight class="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowUpRight, Eye, EyeOff } from 'lucide-vue-next';

import type { SpatialTreeTubeNode, SpatialTreeUnitNode } from '@/api/genModelSpatialApi';

import { formatTubeLength, tubeKey, tubeLabel } from '@/composables/spatialTree';
import { dtxLoaderRevision, isDtxTubeSegmentHidden, isDtxTubeSegmentLoadedAcrossAllDbnos } from '@/composables/useDbnoInstancesDtxLoader';

/**
 * 房间层级树里一条 BRAN 单元下的直段行（方案 B，2026-09-22）：一行一段——「直管 · REDU → BEND · 141 mm」，无效直管带告警小标，
 * 跨房带「跨 N 房」。点整行 / 箭头 = 选中所属 BRAN + 按服务端给的直段盒飞过去（D5 (i)）。
 *
 * 眼睛是**逐段**的（T4，D5 (ii)）：只显 / 隐场景里那一段直管对象（`DtxCompatScene.setTubeSegmentsVisible`，按 `tubeKey` 找对象，
 * 对象级、不进 refno 状态表），所属 BRAN 的 refno 级动作一来整条覆盖。对象没装进场景（BRAN 未加载 / 老服务端 `model/records`
 * 没给 `tube`）时眼睛画淡、点了由 store 提示先加载；`data-tube-loaded` / `data-tube-hidden` 供 e2e 读。
 * 两端 noun 是唯一会被截的段（「直管」标、长度、小标 `shrink-0`）；两端 refno / 距离 / 序号进 `title`。
 */
const props = defineProps<{
  unit: SpatialTreeUnitNode;
  tubes: SpatialTreeTubeNode[];
  /** 测试注桩：这一段是否被单独藏起来 / 对象是否已在场景里；缺省读 DTX 加载链的运行时索引 */
  segmentHidden?: (key: string) => boolean;
  segmentLoaded?: (key: string) => boolean;
}>();

const emit = defineEmits<{
  focusTube: [unit: SpatialTreeUnitNode, tube: SpatialTreeTubeNode];
  toggleTubeVisible: [unit: SpatialTreeUnitNode, tube: SpatialTreeTubeNode];
}>();

const METERS_TO_MM = 1000;

type SegmentState = 'visible' | 'hidden' | 'unloaded';

/** 这一段的显隐态：单独藏起来了 / 可见 / 对象还没装进场景。读 `dtxLoaderRevision` 让装载完成后这一行跟着刷。 */
function segmentState(tube: SpatialTreeTubeNode): SegmentState {
  void dtxLoaderRevision.value;
  const key = tubeKey(props.unit.refno, tube);
  if ((props.segmentHidden ?? isDtxTubeSegmentHidden)(key)) return 'hidden';
  return (props.segmentLoaded ?? isDtxTubeSegmentLoadedAcrossAllDbnos)(key) ? 'visible' : 'unloaded';
}

function eyeTitle(tube: SpatialTreeTubeNode): string {
  switch (segmentState(tube)) {
    case 'hidden': return '显示这段直管';
    case 'visible': return '隐藏这段直管（只这一段；所属 BRAN 的显隐动作会整条覆盖）';
    default: return '这段直管还没装进场景：先对所属 BRAN 单元「加载」';
  }
}

function formatDistance(distance: number): string {
  const meters = distance / METERS_TO_MM;
  return `${meters >= 10 ? meters.toFixed(0) : meters.toFixed(2)} m`;
}

/** 直段行的 title：直管 A → B · 长度 · 距离 · from refno → to refno（· 第 n 段）（· 无效）（· 跨 N 房） */
function tubeTitle(tube: SpatialTreeTubeNode): string {
  return [
    `直管 ${tubeLabel(tube)}`,
    formatTubeLength(tube.length),
    `距 ${formatDistance(tube.distance)}`,
    `${tube.from} → ${tube.to}`,
    tube.ordinal > 0 ? `第 ${tube.ordinal + 1} 段` : null,
    tube.invalid ? '无效直管' : null,
    tube.shared_rooms && tube.shared_rooms > 1 ? `跨 ${tube.shared_rooms} 房` : null,
  ].filter(Boolean).join(' · ');
}
</script>
