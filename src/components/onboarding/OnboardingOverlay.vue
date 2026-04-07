<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { AlertTriangle, ChevronLeft, ChevronRight, HelpCircle, X } from 'lucide-vue-next';

import type { StepPlacement } from './types';

import { useOnboardingGuide } from '@/composables/useOnboardingGuide';

const guide = useOnboardingGuide();

const tooltipRef = ref<HTMLDivElement | null>(null);
const highlightRect = ref({ top: 0, left: 0, width: 0, height: 0 });
const tooltipPos = ref({ top: 0, left: 0 });
const tooltipVisible = ref(false);
const isFallbackMode = ref(false);

function findTargetElement(): HTMLElement | null {
  const step = guide.currentStep.value;
  if (!step) return null;
  const primary = document.querySelector<HTMLElement>(step.targetSelector);
  if (primary) return primary;
  if (step.fallbackSelector) {
    return document.querySelector<HTMLElement>(step.fallbackSelector);
  }
  return null;
}

function updatePositions() {
  const el = findTargetElement();
  if (!el) {
    highlightRect.value = { top: 0, left: 0, width: 0, height: 0 };
    isFallbackMode.value = true;
    // 居中显示 tooltip
    nextTick(() => {
      const tip = tooltipRef.value;
      if (!tip) return;
      const tipRect = tip.getBoundingClientRect();
      tooltipPos.value = {
        top: Math.max(80, window.innerHeight / 2 - tipRect.height / 2 - 40),
        left: Math.max(16, window.innerWidth / 2 - tipRect.width / 2),
      };
      tooltipVisible.value = true;
    });
    return;
  }
  isFallbackMode.value = false;

  const rect = el.getBoundingClientRect();
  const pad = 6;
  highlightRect.value = {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };

  nextTick(() => positionTooltip(rect));
}

function positionTooltip(targetRect: DOMRect) {
  const tip = tooltipRef.value;
  if (!tip) return;

  const placement: StepPlacement = guide.currentStep.value?.placement ?? 'bottom';
  const tipRect = tip.getBoundingClientRect();
  const gap = 12;
  let top = 0;
  let left = 0;

  switch (placement) {
    case 'bottom':
      top = targetRect.bottom + gap;
      left = targetRect.left + targetRect.width / 2 - tipRect.width / 2;
      break;
    case 'top':
      top = targetRect.top - tipRect.height - gap;
      left = targetRect.left + targetRect.width / 2 - tipRect.width / 2;
      break;
    case 'left':
      top = targetRect.top + targetRect.height / 2 - tipRect.height / 2;
      left = targetRect.left - tipRect.width - gap;
      break;
    case 'right':
      top = targetRect.top + targetRect.height / 2 - tipRect.height / 2;
      left = targetRect.right + gap;
      break;
  }

  left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - tipRect.height - 8));

  tooltipPos.value = { top, left };
  tooltipVisible.value = true;
}

const highlightClipPath = computed(() => {
  const r = highlightRect.value;
  if (r.width === 0 && r.height === 0) return 'none';

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const x1 = r.left;
  const y1 = r.top;
  const x2 = r.left + r.width;
  const y2 = r.top + r.height;
  const radius = 6;

  return `path('M 0 0 L ${vw} 0 L ${vw} ${vh} L 0 ${vh} Z M ${x1 + radius} ${y1} L ${x2 - radius} ${y1} Q ${x2} ${y1} ${x2} ${y1 + radius} L ${x2} ${y2 - radius} Q ${x2} ${y2} ${x2 - radius} ${y2} L ${x1 + radius} ${y2} Q ${x1} ${y2} ${x1} ${y2 - radius} L ${x1} ${y1 + radius} Q ${x1} ${y1} ${x1 + radius} ${y1} Z')`;
});

let resizeObserver: ResizeObserver | null = null;

watch(
  () => guide.currentStep.value?.id,
  async () => {
    tooltipVisible.value = false;
    await nextTick();
    setTimeout(updatePositions, 100);
  },
);

onMounted(() => {
  window.addEventListener('resize', updatePositions);
  window.addEventListener('scroll', updatePositions, true);
  resizeObserver = new ResizeObserver(updatePositions);
  resizeObserver.observe(document.body);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', updatePositions);
  window.removeEventListener('scroll', updatePositions, true);
  resizeObserver?.disconnect();
});

function handleOverlayClick(e: MouseEvent) {
  const el = findTargetElement();
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x = e.clientX;
  const y = e.clientY;
  if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
    el.click();
    setTimeout(updatePositions, 300);
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="onboarding-fade">
      <div v-if="guide.active.value" class="onboarding-root">
        <!-- 遮罩层（带高亮镂空） -->
        <div class="onboarding-mask"
          :style="{ clipPath: highlightClipPath }"
          @click="handleOverlayClick" />

        <!-- 高亮边框 -->
        <div v-if="highlightRect.width > 0"
          class="onboarding-highlight"
          :style="{
            top: highlightRect.top + 'px',
            left: highlightRect.left + 'px',
            width: highlightRect.width + 'px',
            height: highlightRect.height + 'px',
          }" />

        <!-- 提示气泡 -->
        <div ref="tooltipRef"
          class="onboarding-tooltip"
          :class="{ 'opacity-0': !tooltipVisible }"
          :style="{
            top: tooltipPos.top + 'px',
            left: tooltipPos.left + 'px',
          }">
          <!-- 标题栏 -->
          <div class="flex items-center gap-2 mb-2">
            <HelpCircle class="h-4 w-4 text-blue-500 shrink-0" />
            <span class="text-sm font-semibold text-slate-800 flex-1">
              {{ guide.currentStep.value?.title }}
            </span>
            <button class="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              title="关闭向导"
              @click="guide.dismissGuide()">
              <X class="h-3.5 w-3.5" />
            </button>
          </div>

          <!-- 描述 -->
          <p class="text-xs text-slate-600 leading-relaxed mb-3">
            {{ guide.currentStep.value?.description }}
          </p>

          <!-- 操作提示（目标元素不存在时显示） -->
          <div v-if="isFallbackMode && guide.currentStep.value?.actionHint"
            class="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
            <AlertTriangle class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" />
            <span>{{ guide.currentStep.value.actionHint }}</span>
          </div>
          <div v-else-if="isFallbackMode"
            class="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            当前步骤的目标元素尚未出现，请先完成前置操作后，点击「下一步」重试。
          </div>

          <!-- 进度条 -->
          <div class="w-full h-1 bg-slate-100 rounded-full mb-3 overflow-hidden">
            <div class="h-full bg-blue-500 rounded-full transition-all duration-300"
              :style="{ width: guide.progress.value + '%' }" />
          </div>

          <!-- 底部操作 -->
          <div class="flex items-center justify-between">
            <span class="text-[10px] text-slate-400">
              {{ guide.currentStepIndex.value + 1 }} / {{ guide.totalSteps.value }}
            </span>
            <div class="flex items-center gap-1.5">
              <button v-if="guide.currentStep.value?.canSkip"
                class="onboarding-btn-text"
                @click="guide.nextStep()">
                跳过
              </button>
              <button v-if="!guide.isFirstStep.value"
                class="onboarding-btn-secondary"
                @click="guide.prevStep()">
                <ChevronLeft class="h-3.5 w-3.5" />
                上一步
              </button>
              <button class="onboarding-btn-primary"
                @click="guide.nextStep()">
                {{ guide.isLastStep.value ? '完成' : '下一步' }}
                <ChevronRight v-if="!guide.isLastStep.value" class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.onboarding-root {
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
}

.onboarding-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  pointer-events: auto;
  transition: clip-path 0.3s ease;
}

.onboarding-highlight {
  position: fixed;
  border: 2px solid #3b82f6;
  border-radius: 6px;
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.2);
  pointer-events: none;
  transition: all 0.3s ease;
}

.onboarding-tooltip {
  position: fixed;
  width: 320px;
  max-width: calc(100vw - 32px);
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 14px 16px;
  box-shadow:
    0 10px 25px -5px rgba(0, 0, 0, 0.1),
    0 8px 10px -6px rgba(0, 0, 0, 0.1);
  pointer-events: auto;
  transition: top 0.3s ease, left 0.3s ease, opacity 0.2s ease;
}

.onboarding-btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 500;
  color: white;
  background: #3b82f6;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.onboarding-btn-primary:hover {
  background: #2563eb;
}

.onboarding-btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  color: #475569;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.onboarding-btn-secondary:hover {
  background: #e2e8f0;
}

.onboarding-btn-text {
  padding: 4px 8px;
  font-size: 11px;
  color: #94a3b8;
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.15s ease;
}
.onboarding-btn-text:hover {
  color: #64748b;
}

.onboarding-fade-enter-active,
.onboarding-fade-leave-active {
  transition: opacity 0.25s ease;
}
.onboarding-fade-enter-from,
.onboarding-fade-leave-to {
  opacity: 0;
}
</style>
