<script setup lang="ts">
import { emitCommand } from '@/ribbon/commandBus';

withDefaults(defineProps<{
  disabled?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
}>(), {
  disabled: false,
  canUndo: false,
  canRedo: false,
});
const emit = defineEmits<(event: 'export-svg') => void>();

const creationCommands = [
  ['dimension.create.linear', '线性'],
  ['dimension.create.projected', '投影'],
  ['dimension.create.angular', '角度'],
  ['dimension.create.radial', '半径/直径'],
] as const;
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
        :disabled="disabled || !canUndo" data-testid="dimension.undo" @click="emitCommand('dimension.undo')">
        撤销
      </button>
      <button type="button" class="rounded border px-2 py-1 text-xs disabled:opacity-50"
        :disabled="disabled || !canRedo" data-testid="dimension.redo" @click="emitCommand('dimension.redo')">
        重做
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
  </div>
</template>
