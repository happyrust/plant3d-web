<template>
  <div v-if="tubes.length > 0" class="ml-2 border-l border-gray-100 pl-1" data-testid="spatial-tree-tubes" :data-unit-refno="unit.refno">
    <div v-for="tube in tubes"
      :key="tubeKey(unit.refno, tube)"
      class="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-gray-50"
      data-testid="spatial-tree-tube-row"
      :data-tube-key="tubeKey(unit.refno, tube)"
      :data-invalid="tube.invalid ? 'true' : undefined">
      <button type="button"
        class="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px]"
        :title="tubeTitle(tube)"
        @click="emit('focusTube', unit, tube)">
        <span class="shrink-0 text-gray-400">直管</span>
        <span class="truncate text-gray-800">{{ tubeLabel(tube) }}</span>
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
import { ArrowUpRight } from 'lucide-vue-next';

import type { SpatialTreeTubeNode, SpatialTreeUnitNode } from '@/api/genModelSpatialApi';

import { formatTubeLength, tubeKey, tubeLabel } from '@/composables/spatialTree';

/**
 * 房间层级树里一条 BRAN 单元下的直段行（方案 B，D5 (i) 只读 + 定位；2026-09-22）：一行一段——「直管 · REDU → BEND · 141 mm」，
 * 无效直管带告警小标，跨房带「跨 N 房」。没有眼睛、没有勾选：直管挂在 BRAN 自己的 refno 上、随单元级动作一起显隐 / 隔离
 * （`deliveryUnitScene.ts`），逐段显隐要对象级状态（T4 另议）。点整行 / 箭头 = 选中所属 BRAN + 按服务端给的直段盒飞过去。
 * 两端 noun 是唯一会被截的段（「直管」标、长度、小标 `shrink-0`）；两端 refno / 距离 / 序号进 `title`。
 */
defineProps<{
  unit: SpatialTreeUnitNode;
  tubes: SpatialTreeTubeNode[];
}>();

const emit = defineEmits<{
  focusTube: [unit: SpatialTreeUnitNode, tube: SpatialTreeTubeNode];
}>();

const METERS_TO_MM = 1000;

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
