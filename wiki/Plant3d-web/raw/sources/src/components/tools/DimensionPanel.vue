<script setup lang="ts">
import { computed, ref, watch, type Ref } from 'vue';

import { useToolStore } from '@/composables/useToolStore';
import { useViewerContext } from '@/composables/useViewerContext';

type ToolsApi = {
  ready: Ref<boolean>;
  statusText: Ref<string>;
  flyToDimension: (id: string) => void;
  removeDimension: (id: string) => void;
};

const props = defineProps<{
  tools: ToolsApi;
}>();

const store = useToolStore();
const ctx = useViewerContext();

const sorted = computed(() => {
  return [...store.dimensions.value].sort((a, b) => b.createdAt - a.createdAt);
});

function setMode(mode: 'none' | 'dimension_linear' | 'dimension_angle') {
  store.setToolMode(mode);
}

function toggleVisible(id: string, current: boolean) {
  store.updateDimensionVisible(id, !current);
}

function remove(id: string) {
  props.tools.removeDimension(id);
}

function fly(id: string) {
  props.tools.flyToDimension(id);
}

const editingId = ref<string | null>(null);
const editingText = ref<string>('');

function beginEdit(id: string) {
  const rec = store.dimensions.value.find((d) => d.id === id);
  if (!rec) return;
  editingId.value = id;
  editingText.value = (rec.textOverride ?? '').toString();
  store.activeDimensionId.value = id;
  try {
    ctx.annotationSystem.value?.selectAnnotation(`dim_${id}`);
  } catch {
    // ignore
  }
}

function cancelEdit() {
  editingId.value = null;
  editingText.value = '';
}

function saveEdit() {
  const id = editingId.value;
  if (!id) return;
  const t = String(editingText.value ?? '').trim();
  store.updateDimension(id, { textOverride: t ? t : undefined });
  cancelEdit();
}

function clearOverride(id: string) {
  store.updateDimension(id, { textOverride: undefined });
}

watch(
  () => store.pendingDimensionEditId.value,
  (id) => {
    if (!id) return;
    try {
      beginEdit(id);
    } finally {
      store.pendingDimensionEditId.value = null;
    }
  }
);

watch(
  () => store.activeDimensionId.value,
  (id) => {
    if (!id) return;
    try {
      ctx.annotationSystem.value?.selectAnnotation(`dim_${id}`);
    } catch {
      // ignore
    }
  }
);
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="rounded-md border border-border bg-background p-3">
      <div class="text-sm font-semibold">工具状态</div>
      <div class="mt-1 text-xs text-muted-foreground">{{ tools.statusText }}</div>

      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'none' ? 'bg-muted' : ''"
          @click="setMode('none')">
          关闭
        </button>

        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'dimension_linear' ? 'bg-muted' : ''"
          @click="setMode('dimension_linear')">
          距离
        </button>

        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'dimension_angle' ? 'bg-muted' : ''"
          @click="setMode('dimension_angle')">
          角度
        </button>
      </div>

      <div class="mt-2 text-xs text-muted-foreground">
        点击模型表面按提示点选即可创建（3D 文字 + 3D 尺寸线）。
      </div>
    </div>

    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-semibold">尺寸列表</div>
        <div class="text-xs text-muted-foreground">共 {{ store.dimensionCount }} 条</div>
      </div>

      <div v-if="sorted.length === 0" class="mt-2 text-sm text-muted-foreground">
        暂无尺寸标注。
      </div>

      <div v-else class="mt-2 flex flex-col gap-2">
        <div v-for="d in sorted" :key="d.id" class="rounded-md border border-border p-2">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm">
                <span class="font-semibold">{{ d.kind === 'linear_distance' ? '距离' : '角度' }}</span>
                <span class="ml-2 text-xs text-muted-foreground">{{ new Date(d.createdAt).toLocaleString() }}</span>
              </div>
              <div class="mt-0.5 truncate text-xs text-muted-foreground">ID: {{ d.id }}</div>
              <div v-if="d.textOverride" class="mt-1 truncate text-xs text-muted-foreground">
                自定义文字：<span class="font-semibold">{{ d.textOverride }}</span>
              </div>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <button type="button"
                class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
                @click="fly(d.id)">
                定位
              </button>

              <button type="button"
                class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
                @click="beginEdit(d.id)">
                编辑
              </button>

              <button type="button"
                class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
                @click="toggleVisible(d.id, d.visible)">
                {{ d.visible ? '隐藏' : '显示' }}
              </button>

              <button type="button"
                class="h-8 rounded-md border border-input bg-background px-2 text-xs text-destructive hover:bg-muted"
                @click="remove(d.id)">
                删除
              </button>
            </div>
          </div>

          <div v-if="editingId === d.id" class="mt-2 rounded-md border border-border bg-muted/20 p-2">
            <div class="text-xs text-muted-foreground">自定义文字（留空=恢复自动显示）</div>
            <input v-model="editingText"
              type="text"
              class="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              placeholder="例如：100mm"
              @keydown.enter.prevent="saveEdit()"
              @keydown.esc.prevent="cancelEdit()" />
            <div class="mt-2 flex items-center justify-end gap-2">
              <button type="button"
                class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
                @click="cancelEdit()">
                取消
              </button>
              <button v-if="d.textOverride" type="button"
                class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
                @click="clearOverride(d.id)">
                清除覆盖
              </button>
              <button type="button"
                class="h-8 rounded-md border border-input bg-background px-2 text-xs font-semibold hover:bg-muted"
                @click="saveEdit()">
                保存
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-3 flex justify-end">
        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm text-destructive hover:bg-muted"
          @click="store.clearDimensions()">
          清空尺寸标注
        </button>
      </div>
    </div>
  </div>
</template>
