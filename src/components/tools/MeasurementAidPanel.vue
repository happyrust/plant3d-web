<script setup lang="ts">
import { computed, reactive, ref } from 'vue';

import { useMeasurementAidStore } from '@/composables/useMeasurementAidStore';
import { useToolStore, type Vec3 } from '@/composables/useToolStore';
import { useXeokitMeasurementStyleStore } from '@/composables/useXeokitMeasurementStyleStore';
import {
  DEFAULT_AID_PLANE_SIZE_M,
  aidDisplayName,
  type AidGeometryFailure,
  type AidGeometryResult,
  type AidLineAnchor,
  type AidVec3,
  type MeasurementAid,
} from '@/measurement/aids/designAid';

/**
 * 会话设计辅助（E3D Design Aids 的最小实现，方案 2026-09-12 §7 Q3）：
 * 新建辅助线（两点 / 位置 + 方向 + 长度，对应 `gphlineedit.pmlfrm`）与辅助面
 * （位置 + 法向 + 尺寸 / 过三点，对应 `gphplaneedit.pmlfrm`），列出、显隐、删除。
 * 输入按 E3D `!!distanceFmt` 用 mm，存进内核时换成设计 World 米。
 */
const aidStore = useMeasurementAidStore();
const toolStore = useToolStore();
const measurementStyle = useXeokitMeasurementStyleStore();

type Xyz = { x: string; y: string; z: string };

const emptyXyz = (): Xyz => ({ x: '', y: '', z: '' });

const lineMode = ref<'two-points' | 'direction'>('two-points');
const lineForm = reactive({
  start: emptyXyz(),
  end: emptyXyz(),
  position: emptyXyz(),
  anchor: 'start' as AidLineAnchor,
  direction: { x: '0', y: '0', z: '1' } as Xyz,
  lengthMm: '1000',
  description: '',
});

const planeMode = ref<'normal' | 'three-points'>('normal');
const planeForm = reactive({
  position: emptyXyz(),
  normal: { x: '0', y: '0', z: '1' } as Xyz,
  p1: emptyXyz(),
  p2: emptyXyz(),
  p3: emptyXyz(),
  xSizeMm: String(DEFAULT_AID_PLANE_SIZE_M * 1000),
  ySizeMm: String(DEFAULT_AID_PLANE_SIZE_M * 1000),
  description: '',
});

const lineError = ref<string | null>(null);
const planeError = ref<string | null>(null);

const aids = computed(() => aidStore.aids.value);
const aidFilterActive = computed(() => measurementStyle.state.measurementPickLayer.filter === 'aid');

function parseXyzMm(input: Xyz): AidVec3 | null {
  const values = [input.x, input.y, input.z].map((raw) => Number(String(raw).trim()));
  if (values.some((value) => !Number.isFinite(value)) || [input.x, input.y, input.z].some((raw) => String(raw).trim() === '')) {
    return null;
  }
  return [values[0]! / 1000, values[1]! / 1000, values[2]! / 1000];
}

function parseXyzUnitless(input: Xyz): AidVec3 | null {
  const values = [input.x, input.y, input.z].map((raw) => Number(String(raw).trim()));
  if (values.some((value) => !Number.isFinite(value))) return null;
  return [values[0]!, values[1]!, values[2]!];
}

function parseMm(raw: string): number | null {
  const value = Number(String(raw).trim());
  return Number.isFinite(value) ? value / 1000 : null;
}

const FAILURE_TEXT: Readonly<Record<AidGeometryFailure, string>> = {
  'non-finite-input': '坐标 / 数值必须是数字',
  'zero-length-line': '两点重合或长度 / 方向为零，画不出线',
  'degenerate-normal': '法向为零或三点共线，定不出面',
  'non-positive-size': '面尺寸必须大于 0',
};

function reportResult(result: AidGeometryResult<MeasurementAid>, target: typeof lineError): boolean {
  if (result.ok) {
    target.value = null;
    return true;
  }
  target.value = FAILURE_TEXT[result.reason];
  return false;
}

function xyzFromMetres(point: Vec3 | readonly number[] | undefined): Xyz {
  if (!point) return emptyXyz();
  const mm = (value: number): string => String(Number((value * 1000).toFixed(3)));
  return { x: mm(point[0]!), y: mm(point[1]!), z: mm(point[2]!) };
}

/** 最近一条距离测量（按创建时间），两点是设计 World 米。 */
const latestDistance = computed(() => {
  const records = toolStore.xeokitDistanceMeasurements.value;
  if (records.length === 0) return null;
  return records.reduce((latest, record) => (record.createdAt > latest.createdAt ? record : latest), records[0]!);
});

const latestAngle = computed(() => {
  const records = toolStore.xeokitAngleMeasurements.value;
  if (records.length === 0) return null;
  return records.reduce((latest, record) => (record.createdAt > latest.createdAt ? record : latest), records[0]!);
});

function fillLineFromLatestDistance(): void {
  const record = latestDistance.value;
  if (!record?.origin.designWorldPos || !record.target.designWorldPos) return;
  lineMode.value = 'two-points';
  Object.assign(lineForm.start, xyzFromMetres(record.origin.designWorldPos));
  Object.assign(lineForm.end, xyzFromMetres(record.target.designWorldPos));
}

function fillPlaneFromLatestAngle(): void {
  const record = latestAngle.value;
  if (!record?.origin.designWorldPos || !record.corner.designWorldPos || !record.target.designWorldPos) return;
  planeMode.value = 'three-points';
  Object.assign(planeForm.p1, xyzFromMetres(record.corner.designWorldPos));
  Object.assign(planeForm.p2, xyzFromMetres(record.origin.designWorldPos));
  Object.assign(planeForm.p3, xyzFromMetres(record.target.designWorldPos));
}

function fillPlaneFromLatestDistance(): void {
  const record = latestDistance.value;
  if (!record?.origin.designWorldPos || !record.target.designWorldPos) return;
  planeMode.value = 'normal';
  Object.assign(planeForm.position, xyzFromMetres(record.origin.designWorldPos));
  const [ox, oy, oz] = record.origin.designWorldPos;
  const [tx, ty, tz] = record.target.designWorldPos;
  const round = (value: number): string => String(Number(value.toFixed(6)));
  Object.assign(planeForm.normal, { x: round(tx - ox), y: round(ty - oy), z: round(tz - oz) });
}

function createLine(): void {
  const description = lineForm.description;
  if (lineMode.value === 'two-points') {
    const start = parseXyzMm(lineForm.start);
    const end = parseXyzMm(lineForm.end);
    if (!start || !end) {
      lineError.value = FAILURE_TEXT['non-finite-input'];
      return;
    }
    if (reportResult(aidStore.addLine({ start, end, description }), lineError)) lineForm.description = '';
    return;
  }
  const position = parseXyzMm(lineForm.position);
  const direction = parseXyzUnitless(lineForm.direction);
  const length = parseMm(lineForm.lengthMm);
  if (!position || !direction || length === null) {
    lineError.value = FAILURE_TEXT['non-finite-input'];
    return;
  }
  const result = aidStore.addLineFromDirection({ position, anchor: lineForm.anchor, direction, length, description });
  if (reportResult(result, lineError)) lineForm.description = '';
}

function createPlane(): void {
  const description = planeForm.description;
  const xSize = parseMm(planeForm.xSizeMm);
  const ySize = parseMm(planeForm.ySizeMm);
  if (xSize === null || ySize === null) {
    planeError.value = FAILURE_TEXT['non-finite-input'];
    return;
  }
  if (planeMode.value === 'normal') {
    const position = parseXyzMm(planeForm.position);
    const zDir = parseXyzUnitless(planeForm.normal);
    if (!position || !zDir) {
      planeError.value = FAILURE_TEXT['non-finite-input'];
      return;
    }
    if (reportResult(aidStore.addPlane({ position, zDir, xSize, ySize, description }), planeError)) planeForm.description = '';
    return;
  }
  const p1 = parseXyzMm(planeForm.p1);
  const p2 = parseXyzMm(planeForm.p2);
  const p3 = parseXyzMm(planeForm.p3);
  if (!p1 || !p2 || !p3) {
    planeError.value = FAILURE_TEXT['non-finite-input'];
    return;
  }
  if (reportResult(aidStore.addPlaneFromThreePoints({ p1, p2, p3, xSize, ySize, description }), planeError)) planeForm.description = '';
}

function formatMm(value: number): string {
  return `${Number((value * 1000).toFixed(1))}`;
}

function formatPoint(point: AidVec3): string {
  return `E ${formatMm(point[0])} N ${formatMm(point[1])} U ${formatMm(point[2])}`;
}

function formatDirection(direction: AidVec3): string {
  const round = (value: number): string => String(Number(value.toFixed(4)));
  return `(${round(direction[0])}, ${round(direction[1])}, ${round(direction[2])})`;
}

function aidSummary(aid: MeasurementAid): string {
  if (aid.kind === 'line') {
    const length = Math.hypot(aid.end[0] - aid.start[0], aid.end[1] - aid.start[1], aid.end[2] - aid.start[2]);
    return `${formatPoint(aid.start)} → ${formatPoint(aid.end)} · 长 ${formatMm(length)} mm`;
  }
  return `位置 ${formatPoint(aid.position)} · 法向 ${formatDirection(aid.zDir)} · ${formatMm(aid.xSize)} × ${formatMm(aid.ySize)} mm`;
}

function useAidFilter(): void {
  measurementStyle.updateMeasurementPickLayer({ filter: 'aid' });
}
</script>

<template>
  <details data-testid="measurement-aid-panel" class="mt-2 rounded-md border border-border bg-muted/20 px-2 py-1">
    <summary class="cursor-pointer select-none text-sm font-medium">
      设计辅助（Aid）
      <span data-testid="measurement-aid-count" class="ml-1 text-xs text-muted-foreground">{{ aids.length }} 条</span>
    </summary>

    <div class="mt-2 flex flex-col gap-2 text-xs">
      <div class="text-muted-foreground">
        E3D 设计辅助线 / 面（GPHLINE / GPHPLANE）的等价物：会话级，不持久化。拾取过滤器选 <b>Aid</b> 后可拾——线上任意处可拾
        （Snap 取近端、Mid-Point 等沿线派生）、面取射线与面的交点；Perpendicular to / Intersect 以它们为无限线 / 面。坐标为设计 World（E / N / U，mm）。
      </div>
      <div class="flex items-center gap-2">
        <span class="text-muted-foreground">当前拾取过滤器：{{ aidFilterActive ? 'Aid' : measurementStyle.state.measurementPickLayer.filter }}</span>
        <button v-if="!aidFilterActive"
          type="button"
          data-testid="measurement-aid-use-filter"
          class="h-6 rounded-md border border-input bg-background px-2 hover:bg-muted"
          @click="useAidFilter">
          切到 Aid 过滤器
        </button>
      </div>

      <!-- 新建辅助线 -->
      <div data-testid="measurement-aid-line-form" class="rounded-md border border-border bg-background/80 p-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="font-medium">新建辅助线</div>
          <div class="flex items-center gap-2">
            <label class="flex items-center gap-1">
              <input v-model="lineMode" type="radio" value="two-points" data-testid="measurement-aid-line-mode-two-points" />
              <span>两点</span>
            </label>
            <label class="flex items-center gap-1">
              <input v-model="lineMode" type="radio" value="direction" data-testid="measurement-aid-line-mode-direction" />
              <span>位置 + 方向 + 长度</span>
            </label>
          </div>
        </div>

        <template v-if="lineMode === 'two-points'">
          <div class="mt-2 grid grid-cols-[3rem_1fr_1fr_1fr] items-center gap-1">
            <span class="text-muted-foreground">起点</span>
            <input v-model="lineForm.start.x" data-testid="measurement-aid-line-start-x" type="number" step="any" placeholder="E" class="h-7 rounded-md border border-input bg-background px-1" />
            <input v-model="lineForm.start.y" data-testid="measurement-aid-line-start-y" type="number" step="any" placeholder="N" class="h-7 rounded-md border border-input bg-background px-1" />
            <input v-model="lineForm.start.z" data-testid="measurement-aid-line-start-z" type="number" step="any" placeholder="U" class="h-7 rounded-md border border-input bg-background px-1" />
            <span class="text-muted-foreground">终点</span>
            <input v-model="lineForm.end.x" data-testid="measurement-aid-line-end-x" type="number" step="any" placeholder="E" class="h-7 rounded-md border border-input bg-background px-1" />
            <input v-model="lineForm.end.y" data-testid="measurement-aid-line-end-y" type="number" step="any" placeholder="N" class="h-7 rounded-md border border-input bg-background px-1" />
            <input v-model="lineForm.end.z" data-testid="measurement-aid-line-end-z" type="number" step="any" placeholder="U" class="h-7 rounded-md border border-input bg-background px-1" />
          </div>
          <button type="button"
            data-testid="measurement-aid-line-fill-distance"
            class="mt-1 h-6 rounded-md border border-input bg-background px-2 hover:bg-muted disabled:opacity-50"
            :disabled="!latestDistance"
            @click="fillLineFromLatestDistance">
            填入最近一条距离测量的两点
          </button>
        </template>
        <template v-else>
          <div class="mt-2 grid grid-cols-[3rem_1fr_1fr_1fr] items-center gap-1">
            <span class="text-muted-foreground">位置</span>
            <input v-model="lineForm.position.x" data-testid="measurement-aid-line-position-x" type="number" step="any" placeholder="E" class="h-7 rounded-md border border-input bg-background px-1" />
            <input v-model="lineForm.position.y" data-testid="measurement-aid-line-position-y" type="number" step="any" placeholder="N" class="h-7 rounded-md border border-input bg-background px-1" />
            <input v-model="lineForm.position.z" data-testid="measurement-aid-line-position-z" type="number" step="any" placeholder="U" class="h-7 rounded-md border border-input bg-background px-1" />
            <span class="text-muted-foreground">方向</span>
            <input v-model="lineForm.direction.x" data-testid="measurement-aid-line-direction-x" type="number" step="any" placeholder="E 分量" class="h-7 rounded-md border border-input bg-background px-1" />
            <input v-model="lineForm.direction.y" data-testid="measurement-aid-line-direction-y" type="number" step="any" placeholder="N 分量" class="h-7 rounded-md border border-input bg-background px-1" />
            <input v-model="lineForm.direction.z" data-testid="measurement-aid-line-direction-z" type="number" step="any" placeholder="U 分量" class="h-7 rounded-md border border-input bg-background px-1" />
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-2">
            <label class="flex items-center gap-1">
              <span class="text-muted-foreground">位置是</span>
              <select v-model="lineForm.anchor" data-testid="measurement-aid-line-anchor" class="h-7 rounded-md border border-input bg-background px-1">
                <option value="start">起点</option>
                <option value="mid">中点</option>
                <option value="end">终点</option>
              </select>
            </label>
            <label class="flex items-center gap-1">
              <span class="text-muted-foreground">长度 (mm)</span>
              <input v-model="lineForm.lengthMm" data-testid="measurement-aid-line-length" type="number" step="any" min="0" class="h-7 w-24 rounded-md border border-input bg-background px-1" />
            </label>
          </div>
        </template>

        <div class="mt-1 flex flex-wrap items-center gap-2">
          <input v-model="lineForm.description" data-testid="measurement-aid-line-description" type="text" placeholder="描述（可选，默认 Line [n]）" class="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2" />
          <button type="button"
            data-testid="measurement-aid-line-create"
            class="h-7 rounded-md border border-input bg-background px-2 hover:bg-muted"
            @click="createLine">
            新建辅助线
          </button>
        </div>
        <div v-if="lineError" data-testid="measurement-aid-line-error" class="mt-1 text-destructive">{{ lineError }}</div>
      </div>

      <!-- 新建辅助面 -->
      <div data-testid="measurement-aid-plane-form" class="rounded-md border border-border bg-background/80 p-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="font-medium">新建辅助面</div>
          <div class="flex items-center gap-2">
            <label class="flex items-center gap-1">
              <input v-model="planeMode" type="radio" value="normal" data-testid="measurement-aid-plane-mode-normal" />
              <span>位置 + 法向</span>
            </label>
            <label class="flex items-center gap-1">
              <input v-model="planeMode" type="radio" value="three-points" data-testid="measurement-aid-plane-mode-three-points" />
              <span>过三点</span>
            </label>
          </div>
        </div>

        <template v-if="planeMode === 'normal'">
          <div class="mt-2 grid grid-cols-[3rem_1fr_1fr_1fr] items-center gap-1">
            <span class="text-muted-foreground">位置</span>
            <input v-model="planeForm.position.x" data-testid="measurement-aid-plane-position-x" type="number" step="any" placeholder="E" class="h-7 rounded-md border border-input bg-background px-1" />
            <input v-model="planeForm.position.y" data-testid="measurement-aid-plane-position-y" type="number" step="any" placeholder="N" class="h-7 rounded-md border border-input bg-background px-1" />
            <input v-model="planeForm.position.z" data-testid="measurement-aid-plane-position-z" type="number" step="any" placeholder="U" class="h-7 rounded-md border border-input bg-background px-1" />
            <span class="text-muted-foreground">法向</span>
            <input v-model="planeForm.normal.x" data-testid="measurement-aid-plane-normal-x" type="number" step="any" placeholder="E 分量" class="h-7 rounded-md border border-input bg-background px-1" />
            <input v-model="planeForm.normal.y" data-testid="measurement-aid-plane-normal-y" type="number" step="any" placeholder="N 分量" class="h-7 rounded-md border border-input bg-background px-1" />
            <input v-model="planeForm.normal.z" data-testid="measurement-aid-plane-normal-z" type="number" step="any" placeholder="U 分量" class="h-7 rounded-md border border-input bg-background px-1" />
          </div>
          <button type="button"
            data-testid="measurement-aid-plane-fill-distance"
            class="mt-1 h-6 rounded-md border border-input bg-background px-2 hover:bg-muted disabled:opacity-50"
            :disabled="!latestDistance"
            @click="fillPlaneFromLatestDistance">
            填入最近一条距离测量：过起点、法向 = 起点 → 终点
          </button>
        </template>
        <template v-else>
          <div class="mt-2 grid grid-cols-[3rem_1fr_1fr_1fr] items-center gap-1">
            <span class="text-muted-foreground">点 1</span>
            <input v-model="planeForm.p1.x" data-testid="measurement-aid-plane-p1-x" type="number" step="any" placeholder="E" class="h-7 rounded-md border border-input bg-background px-1" />
            <input v-model="planeForm.p1.y" data-testid="measurement-aid-plane-p1-y" type="number" step="any" placeholder="N" class="h-7 rounded-md border border-input bg-background px-1" />
            <input v-model="planeForm.p1.z" data-testid="measurement-aid-plane-p1-z" type="number" step="any" placeholder="U" class="h-7 rounded-md border border-input bg-background px-1" />
            <span class="text-muted-foreground">点 2</span>
            <input v-model="planeForm.p2.x" data-testid="measurement-aid-plane-p2-x" type="number" step="any" placeholder="E" class="h-7 rounded-md border border-input bg-background px-1" />
            <input v-model="planeForm.p2.y" data-testid="measurement-aid-plane-p2-y" type="number" step="any" placeholder="N" class="h-7 rounded-md border border-input bg-background px-1" />
            <input v-model="planeForm.p2.z" data-testid="measurement-aid-plane-p2-z" type="number" step="any" placeholder="U" class="h-7 rounded-md border border-input bg-background px-1" />
            <span class="text-muted-foreground">点 3</span>
            <input v-model="planeForm.p3.x" data-testid="measurement-aid-plane-p3-x" type="number" step="any" placeholder="E" class="h-7 rounded-md border border-input bg-background px-1" />
            <input v-model="planeForm.p3.y" data-testid="measurement-aid-plane-p3-y" type="number" step="any" placeholder="N" class="h-7 rounded-md border border-input bg-background px-1" />
            <input v-model="planeForm.p3.z" data-testid="measurement-aid-plane-p3-z" type="number" step="any" placeholder="U" class="h-7 rounded-md border border-input bg-background px-1" />
          </div>
          <button type="button"
            data-testid="measurement-aid-plane-fill-angle"
            class="mt-1 h-6 rounded-md border border-input bg-background px-2 hover:bg-muted disabled:opacity-50"
            :disabled="!latestAngle"
            @click="fillPlaneFromLatestAngle">
            填入最近一条角度测量的三点（顶点为点 1）
          </button>
        </template>

        <div class="mt-1 flex flex-wrap items-center gap-2">
          <label class="flex items-center gap-1">
            <span class="text-muted-foreground">X 尺寸 (mm)</span>
            <input v-model="planeForm.xSizeMm" data-testid="measurement-aid-plane-x-size" type="number" step="any" min="0" class="h-7 w-24 rounded-md border border-input bg-background px-1" />
          </label>
          <label class="flex items-center gap-1">
            <span class="text-muted-foreground">Y 尺寸 (mm)</span>
            <input v-model="planeForm.ySizeMm" data-testid="measurement-aid-plane-y-size" type="number" step="any" min="0" class="h-7 w-24 rounded-md border border-input bg-background px-1" />
          </label>
        </div>
        <div class="mt-1 flex flex-wrap items-center gap-2">
          <input v-model="planeForm.description" data-testid="measurement-aid-plane-description" type="text" placeholder="描述（可选，默认 Plane [n]）" class="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2" />
          <button type="button"
            data-testid="measurement-aid-plane-create"
            class="h-7 rounded-md border border-input bg-background px-2 hover:bg-muted"
            @click="createPlane">
            新建辅助面
          </button>
        </div>
        <div v-if="planeError" data-testid="measurement-aid-plane-error" class="mt-1 text-destructive">{{ planeError }}</div>
      </div>

      <!-- 列表 -->
      <div class="rounded-md border border-border bg-background/80 p-2">
        <div class="flex items-center justify-between gap-2">
          <div class="font-medium">当前辅助</div>
          <button type="button"
            data-testid="measurement-aid-clear"
            class="h-6 rounded-md border border-input bg-background px-2 hover:bg-muted disabled:opacity-50"
            :disabled="aids.length === 0"
            @click="aidStore.clear()">
            清空
          </button>
        </div>
        <div v-if="aids.length === 0" data-testid="measurement-aid-empty" class="mt-1 text-muted-foreground">
          还没有辅助线 / 面。
        </div>
        <table v-else class="mt-1 w-full text-left">
          <thead class="text-muted-foreground">
            <tr>
              <th class="pb-1 font-medium">#</th>
              <th class="pb-1 font-medium">名称</th>
              <th class="pb-1 font-medium">几何</th>
              <th class="pb-1 text-center font-medium">显示</th>
              <th class="pb-1 font-medium" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="aid in aids" :key="aid.id" :data-testid="`measurement-aid-row-${aid.number}`" class="border-t border-border align-top">
              <td class="py-1 pr-2">{{ aid.number }}</td>
              <td class="py-1 pr-2">
                <div class="font-medium text-foreground">{{ aidDisplayName(aid) }}</div>
                <div class="text-muted-foreground">{{ aid.kind === 'line' ? '辅助线' : '辅助面' }}</div>
              </td>
              <td class="py-1 pr-2 text-muted-foreground" :data-testid="`measurement-aid-summary-${aid.number}`">{{ aidSummary(aid) }}</td>
              <td class="py-1 text-center">
                <input type="checkbox"
                  :data-testid="`measurement-aid-visible-${aid.number}`"
                  :checked="aid.visible"
                  @change="aidStore.setVisible(aid.id, ($event.target as HTMLInputElement).checked)" />
              </td>
              <td class="py-1 text-right">
                <button type="button"
                  :data-testid="`measurement-aid-remove-${aid.number}`"
                  class="h-6 rounded-md border border-input bg-background px-2 hover:bg-muted"
                  @click="aidStore.remove(aid.id)">
                  删除
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </details>
</template>
