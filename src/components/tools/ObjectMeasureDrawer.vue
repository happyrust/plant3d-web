<script setup lang="ts">
import { Check, GitCompare, MousePointerClick, RotateCcw, X } from 'lucide-vue-next';

const props = defineProps<{
  title?: string;
  subtitle?: string;
  statusText: string;
  sourceRefno?: string | null;
  targetRefno?: string | null;
  busy?: boolean;
  canReset?: boolean;
}>();

defineEmits<{
  close: [];
  reset: [];
}>();

type StepState = 'idle' | 'active' | 'done';

function getStepState(value: string | null | undefined, previousReady = true): StepState {
  if (value) return 'done';
  return previousReady ? 'active' : 'idle';
}
</script>

<template>
  <div class="pointer-events-auto absolute right-[60px] top-[120px] z-[950] flex w-[340px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
    @pointerdown.stop
    @wheel.stop>
    <div class="flex items-center justify-between border-b border-gray-100 px-4 py-3">
      <div>
        <div class="font-ui text-base font-semibold text-gray-900">{{ title || '构件最近点测量' }}</div>
        <div class="mt-0.5 text-xs text-gray-500">{{ subtitle || '依次选择两个构件，自动生成最近点距离' }}</div>
      </div>
      <button type="button"
        class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
        title="关闭"
        @click="$emit('close')">
        <X class="h-4 w-4" />
      </button>
    </div>

    <div class="flex flex-col gap-3 px-4 py-4">
      <section class="rounded-xl border border-gray-100 bg-gray-50/70 p-3">
        <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">选择方式</div>
        <div class="mt-2 flex flex-wrap gap-2">
          <div class="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600">
            <MousePointerClick class="h-3.5 w-3.5 text-[#FF6B00]" />
            <span>点击模型</span>
          </div>
          <div class="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600">
            <GitCompare class="h-3.5 w-3.5 text-[#FF6B00]" />
            <span>模型树双选</span>
          </div>
        </div>
      </section>

      <section class="grid gap-2">
        <div class="rounded-xl border px-3 py-3 transition-colors"
          :class="
            getStepState(sourceRefno) === 'done'
              ? 'border-[#FFD8BF] bg-[#FFF7F2]'
              : getStepState(sourceRefno) === 'active'
                ? 'border-[#FFE7D6] bg-[#FFFDFC]'
                : 'border-gray-100 bg-gray-50/60'
          ">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">第一个构件</div>
              <div class="mt-1 font-mono text-sm text-gray-900">
                {{ sourceRefno || '等待选择' }}
              </div>
            </div>
            <div class="flex h-7 w-7 items-center justify-center rounded-full"
              :class="getStepState(sourceRefno) === 'done' ? 'bg-[#FF6B00] text-white' : 'bg-white text-gray-400 border border-gray-200'">
              <Check v-if="getStepState(sourceRefno) === 'done'" class="h-4 w-4" />
              <span v-else class="text-xs font-semibold">1</span>
            </div>
          </div>
        </div>

        <div class="rounded-xl border px-3 py-3 transition-colors"
          :class="
            getStepState(targetRefno, !!sourceRefno) === 'done'
              ? 'border-[#FFD8BF] bg-[#FFF7F2]'
              : getStepState(targetRefno, !!sourceRefno) === 'active'
                ? 'border-[#FFE7D6] bg-[#FFFDFC]'
                : 'border-gray-100 bg-gray-50/60'
          ">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">第二个构件</div>
              <div class="mt-1 font-mono text-sm text-gray-900">
                {{ targetRefno || (sourceRefno ? '等待选择' : '先选第一个构件') }}
              </div>
            </div>
            <div class="flex h-7 w-7 items-center justify-center rounded-full"
              :class="getStepState(targetRefno, !!sourceRefno) === 'done' ? 'bg-[#FF6B00] text-white' : 'bg-white text-gray-400 border border-gray-200'">
              <Check v-if="getStepState(targetRefno, !!sourceRefno) === 'done'" class="h-4 w-4" />
              <span v-else class="text-xs font-semibold">2</span>
            </div>
          </div>
        </div>
      </section>

      <section class="rounded-xl border px-3 py-2.5 text-sm"
        :class="busy ? 'border-[#FFD8BF] bg-[#FFF7F2] text-[#C84D00]' : 'border-gray-100 bg-gray-50/60 text-gray-600'">
        {{ statusText }}
      </section>

      <div class="grid grid-cols-2 gap-2">
        <button type="button"
          class="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!canReset"
          @click="$emit('reset')">
          <RotateCcw class="h-4 w-4" />
          <span>重置选择</span>
        </button>
        <button type="button"
          class="inline-flex h-10 items-center justify-center rounded-xl bg-[#FF6B00] px-3 text-sm font-medium text-white transition-colors hover:bg-[#E35F00]"
          @click="$emit('close')">
          结束测量
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.font-ui {
  font-family: 'Fira Sans', system-ui, sans-serif;
}
</style>
