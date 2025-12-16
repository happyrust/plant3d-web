<script setup lang="ts">
import { computed, ref, watch, type Ref } from 'vue';

import { useToolStore } from '@/composables/useToolStore';

type ToolsApi = {
  ready: Ref<boolean>;
  statusText: Ref<string>;
  flyToAnnotation: (id: string) => void;
  removeAnnotation: (id: string) => void;
  highlightAnnotationTarget?: (refno: string) => void;
  highlightAnnotationTargets?: (refnos: string[]) => void;
  flyToCloudAnnotation?: (id: string) => void;
  flyToRectAnnotation?: (id: string) => void;
  flyToObbAnnotation?: (id: string) => void;
  removeCloudAnnotation?: (id: string) => void;
  removeRectAnnotation?: (id: string) => void;
  removeObbAnnotation?: (id: string) => void;
};

const props = defineProps<{
  tools: ToolsApi;
}>();

const store = useToolStore();

const sortedText = computed(() => {
  return [...store.annotations.value].sort((a, b) => b.createdAt - a.createdAt);
});

const sortedCloud = computed(() => {
  return [...store.cloudAnnotations.value].sort((a, b) => b.createdAt - a.createdAt);
});

const sortedRect = computed(() => {
  return [...store.rectAnnotations.value].sort((a, b) => b.createdAt - a.createdAt);
});

const sortedObb = computed(() => {
  return [...store.obbAnnotations.value].sort((a, b) => b.createdAt - a.createdAt);
});

const activeText = computed(() => {
  const id = store.activeAnnotationId.value;
  if (!id) return null;
  return store.annotations.value.find((a) => a.id === id) || null;
});

const activeCloud = computed(() => {
  const id = store.activeCloudAnnotationId.value;
  if (!id) return null;
  return store.cloudAnnotations.value.find((a) => a.id === id) || null;
});

const activeRect = computed(() => {
  const id = store.activeRectAnnotationId.value;
  if (!id) return null;
  return store.rectAnnotations.value.find((a) => a.id === id) || null;
});

const activeObb = computed(() => {
  const id = store.activeObbAnnotationId.value;
  if (!id) return null;
  return store.obbAnnotations.value.find((a) => a.id === id) || null;
});

const activeAny = computed(() => {
  return activeText.value || activeCloud.value || activeRect.value || activeObb.value;
});

function setMode(mode: 'none' | 'annotation' | 'annotation_cloud' | 'annotation_rect' | 'annotation_obb') {
  store.setToolMode(mode);
}

function setActiveText(id: string) {
  store.activeAnnotationId.value = id;
  store.activeCloudAnnotationId.value = null;
  store.activeRectAnnotationId.value = null;
  store.activeObbAnnotationId.value = null;
}

function setActiveCloudAnno(id: string) {
  store.activeCloudAnnotationId.value = id;
  store.activeAnnotationId.value = null;
  store.activeRectAnnotationId.value = null;
  store.activeObbAnnotationId.value = null;
}

function setActiveRectAnno(id: string) {
  store.activeRectAnnotationId.value = id;
  store.activeAnnotationId.value = null;
  store.activeCloudAnnotationId.value = null;
  store.activeObbAnnotationId.value = null;
}

function setActiveObbAnno(id: string) {
  store.activeObbAnnotationId.value = id;
  store.activeAnnotationId.value = null;
  store.activeCloudAnnotationId.value = null;
  store.activeRectAnnotationId.value = null;
}

function toggleTextVisible(id: string, current: boolean) {
  store.updateAnnotationVisible(id, !current);
}

function toggleCloudVisible(id: string, current: boolean) {
  store.updateCloudAnnotationVisible(id, !current);
}

function toggleRectVisible(id: string, current: boolean) {
  store.updateRectAnnotationVisible(id, !current);
}

function toggleObbVisible(id: string, current: boolean) {
  store.updateObbAnnotationVisible(id, !current);
}

function flyText(id: string) {
  props.tools.flyToAnnotation(id);
}

function flyCloud(id: string) {
  props.tools.flyToCloudAnnotation?.(id);
}

function flyRect(id: string) {
  props.tools.flyToRectAnnotation?.(id);
}

function flyObb(id: string) {
  props.tools.flyToObbAnnotation?.(id);
}

function removeText(id: string) {
  props.tools.removeAnnotation(id);
}

function removeCloud(id: string) {
  if (props.tools.removeCloudAnnotation) {
    props.tools.removeCloudAnnotation(id);
  } else {
    store.removeCloudAnnotation(id);
  }
}

function removeRect(id: string) {
  if (props.tools.removeRectAnnotation) {
    props.tools.removeRectAnnotation(id);
  } else {
    store.removeRectAnnotation(id);
  }
}

function removeObb(id: string) {
  if (props.tools.removeObbAnnotation) {
    props.tools.removeObbAnnotation(id);
  } else {
    store.removeObbAnnotation(id);
  }
}

function updateTitle(v: string) {
  if (activeText.value) {
    store.updateAnnotation(activeText.value.id, { title: v });
    return;
  }
  if (activeCloud.value) {
    store.updateCloudAnnotation(activeCloud.value.id, { title: v });
    return;
  }
  if (activeRect.value) {
    store.updateRectAnnotation(activeRect.value.id, { title: v });
    return;
  }
  if (activeObb.value) {
    store.updateObbAnnotation(activeObb.value.id, { title: v });
  }
}

function updateDescription(v: string) {
  if (activeText.value) {
    store.updateAnnotation(activeText.value.id, { description: v });
    return;
  }
  if (activeCloud.value) {
    store.updateCloudAnnotation(activeCloud.value.id, { description: v });
    return;
  }
  if (activeRect.value) {
    store.updateRectAnnotation(activeRect.value.id, { description: v });
    return;
  }
  if (activeObb.value) {
    store.updateObbAnnotation(activeObb.value.id, { description: v });
  }
}

// OBB 创建后弹窗编辑
const showObbEditDialog = ref(false);
const pendingObbTitle = ref('');
const pendingObbDescription = ref('');

// 文字批注创建后弹窗编辑
const showTextEditDialog = ref(false);
const pendingTextTitle = ref('');
const pendingTextDescription = ref('');

watch(() => store.pendingObbEditId.value, (id) => {
  if (id) {
    const rec = store.obbAnnotations.value.find((a) => a.id === id);
    if (rec) {
      pendingObbTitle.value = rec.title;
      pendingObbDescription.value = rec.description;
      showObbEditDialog.value = true;
    }
  }
});

watch(() => store.pendingTextAnnotationEditId.value, (id) => {
  if (id) {
    const rec = store.annotations.value.find((a) => a.id === id);
    if (rec) {
      pendingTextTitle.value = rec.title;
      pendingTextDescription.value = rec.description;
      showTextEditDialog.value = true;
    }
  }
});

function confirmObbEdit() {
  const id = store.pendingObbEditId.value;
  if (id) {
    store.updateObbAnnotation(id, {
      title: pendingObbTitle.value,
      description: pendingObbDescription.value,
    });
  }
  showObbEditDialog.value = false;
  store.pendingObbEditId.value = null;
}

function cancelObbEdit() {
  showObbEditDialog.value = false;
  store.pendingObbEditId.value = null;
}

function confirmTextEdit() {
  const id = store.pendingTextAnnotationEditId.value;
  if (id) {
    store.updateAnnotation(id, {
      title: pendingTextTitle.value,
      description: pendingTextDescription.value,
    });
  }
  showTextEditDialog.value = false;
  store.pendingTextAnnotationEditId.value = null;
}

function cancelTextEdit() {
  showTextEditDialog.value = false;
  store.pendingTextAnnotationEditId.value = null;
}

function highlightTextRefno(refno: string) {
  if (props.tools.highlightAnnotationTarget) {
    props.tools.highlightAnnotationTarget(refno);
  }
}

function highlightCloudRefnos(refnos: string[]) {
  if (props.tools.highlightAnnotationTargets && refnos.length > 0) {
    props.tools.highlightAnnotationTargets(refnos);
  }
}

function highlightObbRefnos(refnos: string[]) {
  if (props.tools.highlightAnnotationTargets && refnos.length > 0) {
    props.tools.highlightAnnotationTargets(refnos);
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- 文字批注创建后编辑弹窗 -->
    <div v-if="showTextEditDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div class="w-80 rounded-lg border border-border bg-background p-4 shadow-xl">
        <div class="text-base font-semibold">编辑文字批注</div>
        <div class="mt-1 text-xs text-muted-foreground">图钉已创建，请输入批注信息</div>

        <div class="mt-4 flex flex-col gap-3">
          <div>
            <label class="text-xs text-muted-foreground">标题</label>
            <input v-model="pendingTextTitle"
              class="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              placeholder="输入批注标题" @keyup.enter="confirmTextEdit" />
          </div>

          <div>
            <label class="text-xs text-muted-foreground">描述</label>
            <textarea v-model="pendingTextDescription"
              class="mt-1 min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="输入批注描述（可选）" />
          </div>
        </div>

        <div class="mt-4 flex justify-end gap-2">
          <button type="button"
            class="h-9 rounded-md border border-input bg-background px-4 text-sm hover:bg-muted"
            @click="cancelTextEdit">
            取消
          </button>
          <button type="button"
            class="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground hover:bg-primary/90"
            @click="confirmTextEdit">
            确定
          </button>
        </div>
      </div>
    </div>

    <!-- OBB 创建后编辑弹窗 -->
    <div v-if="showObbEditDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div class="w-80 rounded-lg border border-border bg-background p-4 shadow-xl">
        <div class="text-base font-semibold">编辑 OBB 批注</div>
        <div class="mt-1 text-xs text-muted-foreground">框选完成，请输入批注信息</div>

        <div class="mt-4 flex flex-col gap-3">
          <div>
            <label class="text-xs text-muted-foreground">标题</label>
            <input v-model="pendingObbTitle"
              class="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              placeholder="输入批注标题" @keyup.enter="confirmObbEdit" />
          </div>

          <div>
            <label class="text-xs text-muted-foreground">描述</label>
            <textarea v-model="pendingObbDescription"
              class="mt-1 min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="输入批注描述（可选）" />
          </div>
        </div>

        <div class="mt-4 flex justify-end gap-2">
          <button type="button"
            class="h-9 rounded-md border border-input bg-background px-4 text-sm hover:bg-muted"
            @click="cancelObbEdit">
            取消
          </button>
          <button type="button"
            class="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground hover:bg-primary/90"
            @click="confirmObbEdit">
            确定
          </button>
        </div>
      </div>
    </div>

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
          :class="store.toolMode.value === 'annotation' ? 'bg-muted' : ''"
          @click="setMode('annotation')">
          文字
        </button>

        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'annotation_cloud' ? 'bg-muted' : ''"
          @click="setMode('annotation_cloud')">
          云线
        </button>

        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'annotation_rect' ? 'bg-muted' : ''"
          @click="setMode('annotation_rect')">
          矩形
        </button>

        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          :class="store.toolMode.value === 'annotation_obb' ? 'bg-muted' : ''"
          @click="setMode('annotation_obb')">
          OBB框选
        </button>
      </div>

      <div class="mt-2 text-xs text-muted-foreground">
        文字/云线/矩形：点击模型表面创建。OBB框选：拖拽框选物体生成包围盒批注。
      </div>
    </div>

    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-semibold">文字批注</div>
        <div class="text-xs text-muted-foreground">共 {{ store.annotationCount }} 条</div>
      </div>

      <div v-if="sortedText.length === 0" class="mt-2 text-sm text-muted-foreground">
        暂无文字批注。
      </div>

      <div v-else class="mt-2 flex flex-col gap-2">
        <button v-for="a in sortedText"
          :key="a.id"
          type="button"
          class="w-full rounded-md border border-border p-2 text-left hover:bg-muted"
          :class="store.activeAnnotationId.value === a.id ? 'bg-muted' : ''"
          @click="setActiveText(a.id)">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm">
                <span class="font-semibold">{{ a.glyph }}</span>
                <span class="ml-2">{{ a.title }}</span>
              </div>
              <div class="mt-0.5 truncate text-xs text-muted-foreground">{{ a.description || '（无描述）' }}</div>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <span class="text-xs text-muted-foreground">{{ new Date(a.createdAt).toLocaleString() }}</span>
            </div>
          </div>

          <div class="mt-2 flex flex-wrap gap-2">
            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              @click.stop="flyText(a.id)">
              定位
            </button>

            <button v-if="a.refno" type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              @click.stop="highlightTextRefno(a.refno)">
              高亮
            </button>

            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              @click.stop="toggleTextVisible(a.id, a.visible)">
              {{ a.visible ? '隐藏' : '显示' }}
            </button>

            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs text-destructive hover:bg-muted"
              @click.stop="removeText(a.id)">
              删除
            </button>
          </div>
        </button>
      </div>
    </div>

    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-semibold">云线批注</div>
        <div class="text-xs text-muted-foreground">共 {{ store.cloudAnnotationCount }} 条</div>
      </div>

      <div v-if="sortedCloud.length === 0" class="mt-2 text-sm text-muted-foreground">
        暂无云线批注。
      </div>

      <div v-else class="mt-2 flex flex-col gap-2">
        <button v-for="a in sortedCloud"
          :key="a.id"
          type="button"
          class="w-full rounded-md border border-border p-2 text-left hover:bg-muted"
          :class="store.activeCloudAnnotationId.value === a.id ? 'bg-muted' : ''"
          @click="setActiveCloudAnno(a.id)">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm">
                <span class="font-semibold">{{ a.title }}</span>
              </div>
              <div class="mt-0.5 truncate text-xs text-muted-foreground">{{ a.description || '（无描述）' }}</div>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <span class="text-xs text-muted-foreground">{{ new Date(a.createdAt).toLocaleString() }}</span>
            </div>
          </div>

          <div class="mt-2 flex flex-wrap gap-2">
            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              @click.stop="flyCloud(a.id)">
              定位
            </button>

            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              @click.stop="toggleCloudVisible(a.id, a.visible)">
              {{ a.visible ? '隐藏' : '显示' }}
            </button>

            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs text-destructive hover:bg-muted"
              @click.stop="removeCloud(a.id)">
              删除
            </button>
          </div>
        </button>
      </div>
    </div>

    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-semibold">矩形批注</div>
        <div class="text-xs text-muted-foreground">共 {{ store.rectAnnotationCount }} 条</div>
      </div>

      <div v-if="sortedRect.length === 0" class="mt-2 text-sm text-muted-foreground">
        暂无矩形批注。
      </div>

      <div v-else class="mt-2 flex flex-col gap-2">
        <button v-for="a in sortedRect"
          :key="a.id"
          type="button"
          class="w-full rounded-md border border-border p-2 text-left hover:bg-muted"
          :class="store.activeRectAnnotationId.value === a.id ? 'bg-muted' : ''"
          @click="setActiveRectAnno(a.id)">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm">
                <span class="font-semibold">{{ a.title }}</span>
              </div>
              <div class="mt-0.5 truncate text-xs text-muted-foreground">{{ a.description || '（无描述）' }}</div>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <span class="text-xs text-muted-foreground">{{ new Date(a.createdAt).toLocaleString() }}</span>
            </div>
          </div>

          <div class="mt-2 flex flex-wrap gap-2">
            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              @click.stop="flyRect(a.id)">
              定位
            </button>

            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              @click.stop="toggleRectVisible(a.id, a.visible)">
              {{ a.visible ? '隐藏' : '显示' }}
            </button>

            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs text-destructive hover:bg-muted"
              @click.stop="removeRect(a.id)">
              删除
            </button>
          </div>
        </button>
      </div>
    </div>

    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-semibold">OBB框选批注</div>
        <div class="text-xs text-muted-foreground">共 {{ store.obbAnnotationCount }} 条</div>
      </div>

      <div v-if="sortedObb.length === 0" class="mt-2 text-sm text-muted-foreground">
        暂无OBB批注。进入OBB框选模式后拖拽框选物体即可创建。
      </div>

      <div v-else class="mt-2 flex flex-col gap-2">
        <button v-for="a in sortedObb"
          :key="a.id"
          type="button"
          class="w-full rounded-md border border-border p-2 text-left hover:bg-muted"
          :class="store.activeObbAnnotationId.value === a.id ? 'bg-muted' : ''"
          @click="setActiveObbAnno(a.id)">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm">
                <span class="font-semibold">{{ a.title }}</span>
                <span class="ml-2 text-xs text-muted-foreground">({{ a.objectIds.length }}个物体)</span>
              </div>
              <div class="mt-0.5 truncate text-xs text-muted-foreground">{{ a.description || '（无描述）' }}</div>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <span class="text-xs text-muted-foreground">{{ new Date(a.createdAt).toLocaleString() }}</span>
            </div>
          </div>

          <div class="mt-2 flex flex-wrap gap-2">
            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              @click.stop="flyObb(a.id)">
              定位
            </button>

            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              @click.stop="toggleObbVisible(a.id, a.visible)">
              {{ a.visible ? '隐藏' : '显示' }}
            </button>

            <button type="button"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs text-destructive hover:bg-muted"
              @click.stop="removeObb(a.id)">
              删除
            </button>
          </div>
        </button>
      </div>
    </div>

    <div class="rounded-md border border-border bg-background p-3">
      <div class="text-sm font-semibold">编辑</div>

      <div v-if="!activeAny" class="mt-2 text-sm text-muted-foreground">
        选择一个批注后可编辑标题与描述。
      </div>

      <div v-else class="mt-2 flex flex-col gap-2">
        <label class="text-xs text-muted-foreground">标题</label>
        <input class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          :value="activeAny.title"
          @input="updateTitle(($event.target as HTMLInputElement).value)" />

        <label class="text-xs text-muted-foreground">描述</label>
        <textarea class="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          :value="activeAny.description"
          @input="updateDescription(($event.target as HTMLTextAreaElement).value)" />

        <div class="text-xs text-muted-foreground">修改会自动同步到场景与本地存储。</div>
      </div>
    </div>
  </div>
</template>
