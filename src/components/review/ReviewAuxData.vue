<script setup lang="ts">
import { ref, watch } from 'vue';

import type { CollisionItem, CollisionDataResponse } from '@/api/reviewApi';
import { reviewGetAuxData, reviewGetCollisionData } from '@/api/reviewApi';
import { useReviewStore } from '@/composables/useReviewStore';
import { useUserStore } from '@/composables/useUserStore';
import CollisionResultList from './CollisionResultList.vue';

const reviewStore = useReviewStore();
const userStore = useUserStore();

// 碰撞数据
const collisionRefno = ref('');
const collisionLoading = ref(false);
const collisionError = ref<string | null>(null);
const collisionData = ref<CollisionDataResponse | null>(null);

async function queryCollision() {
  collisionLoading.value = true;
  collisionError.value = null;
  try {
    collisionData.value = await reviewGetCollisionData({
      refno: collisionRefno.value.trim() || undefined,
      limit: 100,
      offset: 0,
    });
  } catch (e) {
    collisionError.value = e instanceof Error ? e.message : '查询失败';
  } finally {
    collisionLoading.value = false;
  }
}

function handleCollisionLocate(item: CollisionItem) {
  const viewer = (window as any).__xeokit_viewer;
  if (!viewer) return;
  const objectIds = [item.ObjectOne, item.ObjectTow].filter(Boolean);
  if (objectIds.length > 0) {
    viewer.cameraFlight?.flyTo({ aabb: viewer.scene?.getAABB(objectIds) }, () => {});
  }
}

function handleCollisionHighlight(item: CollisionItem) {
  const viewer = (window as any).__xeokit_viewer;
  if (!viewer) return;
  viewer.scene?.setObjectsHighlighted(viewer.scene.highlightedObjectIds, false);
  const objectIds = [item.ObjectOne, item.ObjectTow].filter(Boolean);
  if (objectIds.length > 0) {
    viewer.scene?.setObjectsHighlighted(objectIds, true);
  }
}

// 辅助数据
const AUX_UCODE_KEY = 'review_aux_ucode';
const AUX_UKEY_KEY = 'review_aux_ukey';
const auxUCode = ref(localStorage.getItem(AUX_UCODE_KEY) || '');
const auxUKey = ref(localStorage.getItem(AUX_UKEY_KEY) || '');
watch(auxUCode, (v) => localStorage.setItem(AUX_UCODE_KEY, v));
watch(auxUKey, (v) => localStorage.setItem(AUX_UKEY_KEY, v));

const auxProjectId = ref('');
const auxMajor = ref('general');
const auxFormId = ref('');
const auxLoading = ref(false);
const auxError = ref<string | null>(null);
const auxData = ref<Awaited<ReturnType<typeof reviewGetAuxData>> | null>(null);

const currentTask = reviewStore.currentTask;

async function fetchAuxDataForCurrentTask() {
  if (!currentTask.value) return;
  auxLoading.value = true;
  auxError.value = null;
  try {
    const requesterId = userStore.currentUser.value?.id || 'guest';
    const formId = auxFormId.value.trim() || currentTask.value.id;
    const projectId = auxProjectId.value.trim() || 'default';
    const refnos = currentTask.value.components.map((c) => c.refNo).filter(Boolean);
    auxData.value = await reviewGetAuxData(
      {
        project_id: projectId,
        model_refnos: refnos,
        major: auxMajor.value.trim() || 'general',
        requester_id: requesterId,
        page: 1,
        page_size: 100,
        form_id: formId,
        new_search: true,
      },
      { uCode: auxUCode.value.trim(), uKey: auxUKey.value.trim() }
    );
  } catch (e) {
    auxData.value = null;
    auxError.value = e instanceof Error ? e.message : '请求失败';
  } finally {
    auxLoading.value = false;
  }
}
</script>

<template>
  <div class="rounded-md border border-border bg-background p-3">
    <div class="text-sm font-semibold">辅助校审数据</div>
    <div class="mt-2 space-y-3">
      <!-- 碰撞数据查询 -->
      <div class="rounded-md bg-muted/30 p-2">
        <div class="text-xs font-medium">碰撞数据查询</div>
        <div class="mt-2 flex gap-2">
          <input v-model="collisionRefno"
            type="text"
            placeholder="RefNo（可选）"
            class="h-8 flex-1 rounded-md border px-2 text-xs" />
          <button type="button"
            class="h-8 rounded-md border px-3 text-xs hover:bg-muted disabled:opacity-50"
            :disabled="collisionLoading"
            @click="queryCollision">
            查询
          </button>
        </div>
        <div v-if="collisionLoading" class="mt-2 text-xs text-muted-foreground">查询中...</div>
        <div v-else-if="collisionError" class="mt-2 text-xs text-red-600">{{ collisionError }}</div>
        <CollisionResultList v-else-if="collisionData && collisionData.data.length > 0"
          class="mt-2"
          :items="collisionData.data"
          :total="collisionData.total"
          @locate="handleCollisionLocate"
          @highlight="handleCollisionHighlight" />
        <div v-else-if="collisionData && collisionData.data.length === 0" class="mt-2 text-xs text-muted-foreground">
          无碰撞数据
        </div>
      </div>

      <!-- 外部辅助数据 -->
      <div class="rounded-md bg-muted/30 p-2">
        <div class="text-xs font-medium">外部辅助数据（aux-data）</div>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <input v-model="auxProjectId" type="text" placeholder="project_id（可选）" class="h-8 rounded-md border px-2 text-xs" />
          <input v-model="auxFormId" type="text" placeholder="form_id（可选）" class="h-8 rounded-md border px-2 text-xs" />
          <input v-model="auxMajor" type="text" placeholder="major（默认 general）" class="h-8 rounded-md border px-2 text-xs" />
          <div class="flex gap-2">
            <input v-model="auxUCode" type="text" placeholder="UCode" class="h-8 flex-1 rounded-md border px-2 text-xs" />
            <input v-model="auxUKey" type="text" placeholder="UKey" class="h-8 flex-1 rounded-md border px-2 text-xs" />
          </div>
        </div>
        <div class="mt-2 flex gap-2">
          <button type="button"
            class="h-8 flex-1 rounded-md border px-3 text-xs hover:bg-muted disabled:opacity-50"
            :disabled="!currentTask || auxLoading"
            @click="fetchAuxDataForCurrentTask">
            获取当前任务辅助数据
          </button>
        </div>
        <div v-if="auxLoading" class="mt-2 text-xs text-muted-foreground">请求中...</div>
        <div v-else-if="auxError" class="mt-2 text-xs text-red-600">{{ auxError }}</div>
        <div v-else-if="auxData" class="mt-2 text-xs text-muted-foreground">
          返回 collision: {{ auxData.data.collision.length }} 条，total={{ auxData.total }}
        </div>
      </div>
    </div>
  </div>
</template>
