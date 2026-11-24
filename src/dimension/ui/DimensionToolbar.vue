<script setup lang="ts">
import { computed } from 'vue';

import type { DimensionSessionStatus } from '../interaction/pointerController';

import { emitCommand } from '@/ribbon/commandBus';

const props = withDefaults(defineProps<{
  disabled?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  /** 进行中的创建 / 编辑会话；没有时为 null。 */
  session?: DimensionSessionStatus | null;
}>(), {
  disabled: false,
  canUndo: false,
  canRedo: false,
  session: null,
});
const emit = defineEmits<(event: 'export-svg') => void>();

const creationCommands = [
  ['dimension.create.linear', '线性'],
  ['dimension.create.projected', '投影'],
  ['dimension.create.angular', '角度'],
  ['dimension.create.radial', '半径/直径'],
] as const;

const steps = [
  ['pick', '拾点'],
  ['frame', '定轴'],
  ['place', '放置'],
  ['ready', '就绪'],
] as const;

/** 布局前校验（`validation.ts`）的错误码 → 提示。 */
const VALIDATION_MESSAGES: Readonly<Record<string, string>> = {
  DIMENSION_DIRECTION_PARALLEL_VIEW: '尺寸方向与视线平行，请转动视图',
  PROJECTION_DIRECTION_PARALLEL_VIEW: '投影方向与视线平行，请转动视图',
  PROJECTION_DIRECTION_PARALLEL_DIMENSION: '投影方向与尺寸方向平行',
  DEGENERATE_DIMENSION_DIRECTION: '两点在尺寸方向上重合，长度为零',
  DEGENERATE_PROJECTION_DIRECTION: '投影轴 / 法向为零向量',
  DEGENERATE_RADIAL_RADIUS: '圆的半径为零',
  DEGENERATE_ANGULAR_RAY: '角度的一条射线长度为零',
  COLLINEAR_ANGULAR_RAYS: '两条射线共线，没有角度',
  UNRESOLVED_DIMENSION_POINT: '有尺寸点没解析出坐标',
  INVALID_DIMENSION_POINT_TYPE: '拾到的点类型不能用于该尺寸',
};

const validationMessages = computed(() =>
  (props.session?.validationErrors ?? []).map(code => VALIDATION_MESSAGES[code] ?? code));
</script>

<template>
  <div class="border-b border-slate-200 bg-white p-2" aria-label="尺寸创建工具">
    <div class="grid grid-cols-2 gap-1">
      <button v-for="[command, label] in creationCommands"
        :key="command"
        type="button"
        class="rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        :data-testid="command"
        :disabled="disabled"
        @click="emitCommand(command)">
        {{ label }}
      </button>
    </div>
    <div class="mt-2 flex flex-wrap gap-1">
      <button type="button" class="rounded border px-2 py-1 text-xs disabled:opacity-50"
        :disabled="disabled" data-testid="dimension.axis.x" @click="emitCommand('dimension.axis.x')">
        X轴
      </button>
      <button type="button" class="rounded border px-2 py-1 text-xs disabled:opacity-50"
        :disabled="disabled" data-testid="dimension.axis.y" @click="emitCommand('dimension.axis.y')">
        Y轴
      </button>
      <button type="button" class="rounded border px-2 py-1 text-xs disabled:opacity-50"
        :disabled="disabled" data-testid="dimension.axis.z" @click="emitCommand('dimension.axis.z')">
        Z轴
      </button>
      <button type="button" class="rounded border px-2 py-1 text-xs disabled:opacity-50"
        :disabled="disabled" data-testid="dimension.flip" @click="emitCommand('dimension.flip')">
        翻面
      </button>
      <button type="button" class="rounded border px-2 py-1 text-xs disabled:opacity-50"
        :disabled="disabled || session?.kind !== 'angular'"
        data-testid="dimension.angular.orthogonal-snap"
        @click="emitCommand('dimension.angular.orthogonal-snap')">
        近 90° 吸附
      </button>
      <button type="button" class="rounded border px-2 py-1 text-xs disabled:opacity-50"
        :disabled="disabled || !canUndo" data-testid="dimension.undo" @click="emitCommand('dimension.undo')">
        撤销
      </button>
      <button type="button" class="rounded border px-2 py-1 text-xs disabled:opacity-50"
        :disabled="disabled || !canRedo" data-testid="dimension.redo" @click="emitCommand('dimension.redo')">
        重做
      </button>
      <button type="button" class="rounded border px-2 py-1 text-xs disabled:opacity-50"
        :disabled="disabled || !session" data-testid="dimension.back" @click="emitCommand('dimension.back')">
        上一步
      </button>
      <button type="button" class="rounded border px-2 py-1 text-xs disabled:opacity-50"
        :disabled="disabled" data-testid="dimension.cancel" @click="emitCommand('dimension.cancel')">
        取消
      </button>
      <button type="button" class="rounded border px-2 py-1 text-xs disabled:opacity-50"
        :disabled="disabled" data-testid="dimension.export.svg"
        @click="emit('export-svg')">
        导出 SVG
      </button>
    </div>
    <div v-if="session" class="mt-2 text-xs" data-testid="dimension.session-status">
      <ol class="flex gap-1" aria-label="尺寸创建步骤">
        <li v-for="[step, label] in steps"
          :key="step"
          class="rounded px-1.5 py-0.5"
          :class="session.step === step ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-500'"
          :aria-current="session.step === step ? 'step' : undefined"
          :data-testid="`dimension.step.${step}`">
          {{ label }}
        </li>
      </ol>
      <ul v-if="validationMessages.length > 0" class="mt-1 text-amber-700" data-testid="dimension.validation">
        <li v-for="message in validationMessages" :key="message">{{ message }}</li>
      </ul>
    </div>
  </div>
</template>
