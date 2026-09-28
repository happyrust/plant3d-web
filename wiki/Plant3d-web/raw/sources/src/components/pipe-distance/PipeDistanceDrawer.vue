<script setup lang="ts">
import { computed, watch, onUnmounted } from 'vue';

import {
  Check,
  MousePointerClick,
  RefreshCw,
  X,
  Locate,
  Trash2,
} from 'lucide-vue-next';

import { usePipeDistanceAnnotationThree } from '@/composables/usePipeDistanceAnnotationThree';
import { usePipeDistanceStore, type PipeDistanceResult } from '@/composables/usePipeDistanceStore';
import { useToolStore } from '@/composables/useToolStore';
import { useViewerContext } from '@/composables/useViewerContext';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const store = usePipeDistanceStore();
const toolStore = useToolStore();
const ctx = useViewerContext();

const isPicking = computed(() => toolStore.toolMode.value === 'pick_refno');

// 3D 标注渲染
const annotationVis = usePipeDistanceAnnotationThree(
  computed(() => ctx.viewerRef.value),
  store.results,
  store.showAnnotations
);

onUnmounted(() => {
  annotationVis.clearAnnotations();
});

// --- pick BRAN pipe ---
function startPickBran() {
  toolStore.startPickRefno(['BRAN'], (refnos) => {
    // Enter 确认后，将拾取结果同步到 pipeDistance store
    for (const refno of refnos) {
      store.addBranRefno(refno);
    }
  });
}

// 监听拾取模式实时变化（实时同步选中的管道到 store）
watch(() => toolStore.pickedRefnos.value, (refnos) => {
  if (!isPicking.value) return;
  for (const refno of refnos) {
    store.addBranRefno(refno);
  }
}, { deep: true });

// --- detection ---
async function handleDetect() {
  await store.runDetection();
}

// --- result click ---
function onResultClick(index: number, result: PipeDistanceResult) {
  store.setActiveResult(index);
  const viewer = ctx.viewerRef.value;
  if (!viewer) return;
  try {
    // 取消之前的选中
    const prev = viewer.scene.selectedObjectIds;
    if (prev.length > 0) viewer.scene.setObjectsSelected(prev, false);
    // 高亮选中的管道对
    viewer.scene.ensureRefnos([result.pipeA, result.pipeB]);
    viewer.scene.setObjectsSelected([result.pipeA, result.pipeB], true);
    // 飞行定位到管道对
    const [s, e] = [result.start, result.end];
    const aabb: [number, number, number, number, number, number] = [
      Math.min(s[0], e[0]), Math.min(s[1], e[1]), Math.min(s[2], e[2]),
      Math.max(s[0], e[0]), Math.max(s[1], e[1]), Math.max(s[2], e[2]),
    ];
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  } catch {
    // ignore
  }
}

function close() {
  // 如果正在拾取，先取消
  if (isPicking.value) {
    toolStore.cancelPickRefno();
  }
  emit('update:open', false);
}

// --- validation helpers ---
const clampedMaxDistance = computed({
  get: () => store.maxDistance.value,
  set: (v: number) => {
    store.maxDistance.value = Math.max(50, Math.min(2000, Number(v) || 500));
  },
});

const clampedMaxAngle = computed({
  get: () => store.maxAngle.value,
  set: (v: number) => {
    store.maxAngle.value = Math.max(1, Math.min(15, Number(v) || 5));
  },
});
</script>

<template>
  <div>
    <!-- drawer panel -->
    <Transition name="pd-drawer-slide">
      <div v-if="open"
        class="pointer-events-auto absolute bottom-0 right-0 top-0 flex w-80 flex-col border-l border-border bg-background/95 shadow-xl backdrop-blur"
        style="z-index: 942"
        @pointerdown.stop
        @wheel.stop
        @click.stop>
        <!-- header -->
        <div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div class="text-sm font-semibold">距离标注控制</div>
          <button type="button"
            class="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted"
            @click="close">
            <X class="h-4 w-4" />
          </button>
        </div>

        <!-- scrollable content -->
        <div class="flex-1 overflow-auto">
          <!-- 1. 显示控制 -->
          <div class="border-b border-border/60 px-4 py-3">
            <label class="flex cursor-pointer items-center gap-2">
              <span class="flex h-4 w-4 items-center justify-center rounded"
                :class="store.showAnnotations.value
                  ? 'bg-[#FF6B00]'
                  : 'border border-gray-300 bg-white'">
                <Check v-if="store.showAnnotations.value" class="h-3 w-3 text-white" />
              </span>
              <input v-model="store.showAnnotations.value" type="checkbox" class="sr-only" />
              <span class="text-sm">显示管道间距离标注</span>
            </label>
          </div>

          <!-- 2. 框选 BRAN 管道 -->
          <div class="space-y-2 border-b border-border/60 px-4 py-3">
            <button type="button"
              class="inline-flex w-full items-center justify-center gap-2 rounded-md border-2 border-[#FF6B00] px-3 py-2 text-sm font-medium text-[#FF6B00] transition-colors hover:bg-[#FF6B00]/10"
              :class="isPicking ? 'bg-[#FF6B00]/10' : ''"
              @click="startPickBran">
              <MousePointerClick class="h-4 w-4" />
              <span>{{ isPicking ? '点击选择管道... (Enter 确认 / ESC 取消)' : '选择 BRAN 管道' }}</span>
            </button>

            <!-- 已选管道列表 -->
            <div v-if="store.selectedBranRefnos.value.length > 0" class="space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-xs text-muted-foreground">已选 {{ store.selectedBranRefnos.value.length }} 根管道</span>
                <button type="button"
                  class="text-xs text-destructive hover:underline"
                  @click="store.clearBranRefnos()">
                  清空
                </button>
              </div>
              <div class="flex flex-wrap gap-1">
                <span v-for="refno in store.selectedBranRefnos.value" :key="refno"
                  class="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                  {{ refno }}
                  <button type="button"
                    class="hover:text-destructive"
                    @click="store.removeBranRefno(refno)">
                    <X class="h-3 w-3" />
                  </button>
                </span>
              </div>
            </div>
          </div>

          <!-- 3. 参数设置 -->
          <div class="space-y-3 border-b border-border/60 px-4 py-3">
            <!-- 最大距离 -->
            <div class="space-y-1">
              <label class="text-xs font-medium text-foreground">最大距离</label>
              <div class="flex items-center gap-2">
                <input v-model.number="clampedMaxDistance"
                  type="number"
                  min="50" max="2000"
                  class="flex h-8 flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                <span class="text-xs text-muted-foreground">mm</span>
              </div>
            </div>

            <!-- 最大夹角 -->
            <div class="space-y-1">
              <label class="text-xs font-medium text-foreground">最大夹角</label>
              <div class="flex items-center gap-2">
                <input v-model.number="clampedMaxAngle"
                  type="number"
                  min="1" max="15"
                  class="flex h-8 flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                <span class="text-xs text-muted-foreground">°</span>
              </div>
            </div>

            <!-- 重新检测 -->
            <button type="button"
              :disabled="store.isDetecting.value || store.selectedBranRefnos.value.length < 2"
              class="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#FF6B00] px-4 text-sm font-medium text-white shadow transition-colors hover:bg-[#FF6B00]/90 disabled:pointer-events-none disabled:opacity-50"
              @click="handleDetect">
              <RefreshCw class="h-4 w-4" :class="store.isDetecting.value ? 'animate-spin' : ''" />
              <span>{{ store.isDetecting.value ? '检测中...' : '重新检测' }}</span>
            </button>
            <div v-if="store.selectedBranRefnos.value.length < 2 && !store.isDetecting.value"
              class="text-xs text-muted-foreground">
              至少选择 2 根 BRAN 管道才能检测
            </div>

            <!-- 错误提示 -->
            <div v-if="store.detectError.value"
              class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {{ store.detectError.value }}
            </div>
          </div>

          <!-- 4. 检测结果 -->
          <div class="px-4 py-3">
            <div class="mb-2 flex items-center justify-between">
              <span class="text-xs font-semibold text-foreground">检测结果 ({{ store.results.value.length }})</span>
              <button v-if="store.results.value.length > 0" type="button"
                class="inline-flex items-center gap-1 text-xs text-destructive hover:underline"
                @click="store.clearResults()">
                <Trash2 class="h-3 w-3" />
                清空
              </button>
            </div>

            <div v-if="store.results.value.length === 0"
              class="py-4 text-center text-xs text-muted-foreground">
              暂无检测结果
            </div>

            <!-- result list (scrollable) -->
            <div v-else
              class="max-h-[200px] overflow-auto rounded-md border border-border">
              <div v-for="(result, idx) in store.results.value"
                :key="result.id"
                class="flex cursor-pointer items-center gap-3 border-b border-border/40 px-3 py-2.5 transition-colors last:border-b-0"
                :class="store.activeResultIndex.value === idx
                  ? 'bg-[#FFF0E6] border-l-2 border-l-[#FF6B00]'
                  : 'hover:bg-muted'"
                @click="onResultClick(idx, result)">
                <span class="font-mono text-sm font-semibold"
                  :class="store.activeResultIndex.value === idx ? 'text-[#FF6B00]' : 'text-foreground'">
                  {{ result.distance }}
                </span>
                <span class="text-xs text-muted-foreground">mm</span>
                <span class="flex-1 truncate text-xs text-muted-foreground">
                  {{ result.pipeA }} ↔ {{ result.pipeB }}
                </span>
                <button type="button"
                  class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 hover:bg-muted-foreground/20 group-hover:opacity-100"
                  title="定位"
                  @click.stop="onResultClick(idx, result)">
                  <Locate class="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.pd-drawer-slide-enter-active,
.pd-drawer-slide-leave-active {
  transition: transform 0.25s ease;
}
.pd-drawer-slide-enter-from,
.pd-drawer-slide-leave-to {
  transform: translateX(100%);
}
.pd-drawer-fade-enter-active,
.pd-drawer-fade-leave-active {
  transition: opacity 0.25s ease;
}
.pd-drawer-fade-enter-from,
.pd-drawer-fade-leave-to {
  opacity: 0;
}
</style>
