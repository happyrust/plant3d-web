<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import CollisionResultList from './CollisionResultList.vue';

import type { CollisionItem, CollisionDataResponse, PmsCollisionItem, PmsQualityItem, PmsOtVerificationItem, PmsRuleItem, AuxDataResponse } from '@/api/reviewApi';

import { reviewGetAuxData, reviewGetCollisionData, AUX_DATA_DEFAULT_AUTH } from '@/api/reviewApi';
import { useReviewStore } from '@/composables/useReviewStore';
import { useUserStore } from '@/composables/useUserStore';
import { useViewerContext } from '@/composables/useViewerContext';

const reviewStore = useReviewStore();
const userStore = useUserStore();
const viewerContext = useViewerContext();

type AuxContextStatus = 'ready' | 'degraded' | 'blocked';

type AuxContextSummary = {
  status: AuxContextStatus;
  projectId: string | null;
  formId: string | null;
  requesterId: string | null;
  refnos: string[];
  missingFields: string[];
};

function readProjectIdFromSession(): string | null {
  if (typeof sessionStorage === 'undefined') return null;

  try {
    const raw = sessionStorage.getItem('embed_mode_params');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { projectId?: string | null };
    const projectId = parsed.projectId?.trim();
    return projectId || null;
  } catch {
    return null;
  }
}

function normalizeCollisionObjectIds(item: CollisionItem): string[] {
  return [item.ObjectOne, item.ObjectTow]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value);
}

function clearViewerHighlight(): void {
  const viewer = viewerContext.viewerRef.value as {
    scene?: {
      highlightedObjectIds?: string[];
      setObjectsHighlighted?: (objectIds: string[], highlighted: boolean) => void;
    };
  } | null;

  if (!viewer?.scene?.setObjectsHighlighted) return;

  const highlighted = Array.isArray(viewer.scene.highlightedObjectIds)
    ? viewer.scene.highlightedObjectIds
    : [];

  if (highlighted.length > 0) {
    viewer.scene.setObjectsHighlighted(highlighted, false);
  }
}

const currentTask = reviewStore.currentTask;
const sessionProjectId = computed(() => readProjectIdFromSession());
const currentTaskRefnos = computed(() =>
  (currentTask.value?.components || [])
    .map((component) => component.refNo?.trim())
    .filter((refno): refno is string => !!refno)
);
const currentRequesterId = computed(() => {
  const userId = userStore.currentUser.value?.id?.trim();
  return userId || null;
});
const currentFormId = computed(() => currentTask.value?.formId?.trim() || null);
const auxContextSummary = computed<AuxContextSummary>(() => {
  const projectId = auxProjectId.value.trim() || sessionProjectId.value;
  const formId = currentFormId.value;
  const requesterId = currentRequesterId.value;
  const refnos = currentTaskRefnos.value;
  const missingFields: string[] = [];

  if (!projectId) missingFields.push('project_id');
  if (!formId) missingFields.push('formId');
  if (!requesterId) missingFields.push('requester_id');
  if (refnos.length === 0) missingFields.push('refNo');

  return {
    status: missingFields.length === 0 ? 'ready' : refnos.length > 0 ? 'degraded' : 'blocked',
    projectId: projectId || null,
    formId,
    requesterId,
    refnos,
    missingFields,
  };
});
const canQueryAuxData = computed(() => !!currentTask.value && auxContextSummary.value.missingFields.length === 0);
const canQueryCollision = computed(() => !!currentTask.value && currentTaskRefnos.value.length > 0);

// 碰撞数据
const collisionRefno = ref('');
const collisionLoading = ref(false);
const collisionError = ref<string | null>(null);
const collisionData = ref<CollisionDataResponse | null>(null);

async function queryCollision() {
  if (!canQueryCollision.value) {
    collisionData.value = null;
    collisionError.value = '当前任务缺少可用的 refNo，无法查询碰撞数据';
    return;
  }

  collisionLoading.value = true;
  collisionError.value = null;
  try {
    const fallbackRefno = currentTaskRefnos.value[0] || undefined;
    collisionData.value = await reviewGetCollisionData({
      refno: collisionRefno.value.trim() || fallbackRefno,
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
  const viewer = viewerContext.viewerRef.value;
  const objectIds = normalizeCollisionObjectIds(item);
  if (!viewer || objectIds.length === 0) return;

  const aabb = viewer.scene?.getAABB?.(objectIds) ?? null;
  if (!aabb) return;

  viewer.cameraFlight?.flyTo?.({ aabb, fit: true, duration: 0.8 });
}

function handleCollisionHighlight(item: CollisionItem) {
  const viewer = viewerContext.viewerRef.value;
  const objectIds = normalizeCollisionObjectIds(item);
  if (!viewer?.scene?.setObjectsHighlighted || objectIds.length === 0) return;

  clearViewerHighlight();

  const existingObjectIds = objectIds.filter((objectId) => !!viewer.scene?.getAABB?.([objectId]));
  if (existingObjectIds.length === 0) return;

  viewer.scene.setObjectsHighlighted(existingObjectIds, true);
}

// 辅助数据
const AUX_UCODE_KEY = 'review_aux_ucode';
const AUX_UKEY_KEY = 'review_aux_ukey';
const auxUCode = ref(localStorage.getItem(AUX_UCODE_KEY) || AUX_DATA_DEFAULT_AUTH.uCode);
const auxUKey = ref(localStorage.getItem(AUX_UKEY_KEY) || AUX_DATA_DEFAULT_AUTH.uKey);
watch(auxUCode, (v) => localStorage.setItem(AUX_UCODE_KEY, v));
watch(auxUKey, (v) => localStorage.setItem(AUX_UKEY_KEY, v));

const auxProjectId = ref('');
const auxMajor = ref('BZ');
const auxLoading = ref(false);
const auxError = ref<string | null>(null);
const auxData = ref<AuxDataResponse | null>(null);
const activeAuxTab = ref<'collision' | 'quality' | 'otverification' | 'rules'>('collision');

async function fetchAuxDataForCurrentTask() {
  if (!currentTask.value) return;
  if (!canQueryAuxData.value) {
    auxData.value = null;
    auxError.value = `缺少关键上下文：${auxContextSummary.value.missingFields.join(' / ')}`;
    return;
  }

  auxLoading.value = true;
  auxError.value = null;
  try {
    auxData.value = await reviewGetAuxData(
      {
        project_id: auxContextSummary.value.projectId!,
        model_refnos: auxContextSummary.value.refnos,
        major: auxMajor.value.trim() || 'general',
        requester_id: auxContextSummary.value.requesterId!,
        page: 1,
        page_size: 100,
        form_id: auxContextSummary.value.formId!,
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

watch(currentTask, () => {
  collisionRefno.value = '';
  collisionLoading.value = false;
  collisionError.value = null;
  collisionData.value = null;

  auxLoading.value = false;
  auxError.value = null;
  auxData.value = null;
  auxProjectId.value = '';

  clearViewerHighlight();
}, { immediate: true });
</script>

<template>
  <div class="rounded-md border border-border bg-background p-3">
    <div class="text-sm font-semibold">辅助校审数据</div>
    <div class="mt-2 space-y-3">
      <!-- 碰撞数据查询 -->
      <div class="rounded-md bg-muted/30 p-2">
        <div class="text-xs font-medium">碰撞数据查询</div>
        <div class="mt-2 rounded-md border px-2 py-1.5 text-[11px]"
          :class="canQueryCollision ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'">
          <span v-if="canQueryCollision">
            将优先使用当前任务构件 RefNo 进行碰撞查询；如需缩小范围，可手动输入单个 RefNo。
          </span>
          <span v-else>
            当前任务缺少可用的 RefNo，碰撞查询已降级并阻止请求。
          </span>
        </div>
        <div class="mt-2 flex gap-2">
          <input v-model="collisionRefno"
            type="text"
            placeholder="RefNo（可选）"
            class="h-8 flex-1 rounded-md border px-2 text-xs" />
          <button type="button"
            class="h-8 rounded-md border px-3 text-xs hover:bg-muted disabled:opacity-50"
            :disabled="collisionLoading || !canQueryCollision"
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
        <div class="mt-2 rounded-md border px-2 py-1.5 text-[11px]"
          :class="auxContextSummary.status === 'ready' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : auxContextSummary.status === 'degraded' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-700'">
          <span v-if="auxContextSummary.status === 'ready'">
            当前任务上下文完整，将使用激活任务的 `formId`、当前会话 `project_id`、用户身份和构件 RefNo 发起查询。
          </span>
          <span v-else>
            缺少关键上下文：{{ auxContextSummary.missingFields.join(' / ') }}。M4 工作台不会再默认回落为 task.id、default 或 guest。
          </span>
        </div>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <input v-model="auxProjectId" type="text" placeholder="project_id（会话缺失时可补充）" class="h-8 rounded-md border px-2 text-xs" />
          <input :value="auxContextSummary.formId || '未绑定 formId'" type="text" readonly class="h-8 rounded-md border bg-muted/40 px-2 text-xs text-muted-foreground" />
          <input v-model="auxMajor" type="text" placeholder="major（默认 general）" class="h-8 rounded-md border px-2 text-xs" />
          <div class="flex gap-2">
            <input v-model="auxUCode" type="text" placeholder="UCode" class="h-8 flex-1 rounded-md border px-2 text-xs" />
            <input v-model="auxUKey" type="text" placeholder="UKey" class="h-8 flex-1 rounded-md border px-2 text-xs" />
          </div>
        </div>
        <div class="mt-2 flex gap-2">
          <button type="button"
            class="h-8 flex-1 rounded-md border px-3 text-xs hover:bg-muted disabled:opacity-50"
            :disabled="!currentTask || auxLoading || !canQueryAuxData"
            @click="fetchAuxDataForCurrentTask">
            获取当前任务辅助数据
          </button>
        </div>
        <div class="mt-2 text-[11px] text-muted-foreground">
          当前上下文：project_id={{ auxContextSummary.projectId || '未绑定' }}，formId={{ auxContextSummary.formId || '未绑定' }}，refNo={{ auxContextSummary.refnos.length }} 个。
        </div>
        <div v-if="auxLoading" class="mt-2 text-xs text-muted-foreground">请求中...</div>
        <div v-else-if="auxError" class="mt-2 text-xs text-red-600">{{ auxError }}</div>
        <template v-else-if="auxData">
          <div class="mt-2 flex gap-1">
            <button v-for="tab in (['collision', 'quality', 'otverification', 'rules'] as const)" :key="tab"
              type="button"
              class="rounded-md px-2 py-1 text-[11px] transition-colors"
              :class="activeAuxTab === tab ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:bg-muted'"
              @click="activeAuxTab = tab">
              {{ { collision: '碰撞', quality: '质量', otverification: '二三维', rules: '规则' }[tab] }}
              ({{ auxData!.data[tab]?.length || 0 }})
            </button>
          </div>
          <div class="mt-2 max-h-64 overflow-auto rounded-md border text-[11px]">
            <table v-if="activeAuxTab === 'collision' && auxData!.data.collision.length > 0" class="w-full">
              <thead class="sticky top-0 bg-muted">
                <tr>
                  <th class="px-2 py-1 text-left font-medium">物项1(所属)</th>
                  <th class="px-2 py-1 text-left font-medium">物项2(所属)</th>
                  <th class="px-2 py-1 text-left font-medium">专业</th>
                  <th class="px-2 py-1 text-left font-medium">碰撞类型</th>
                  <th class="px-2 py-1 text-left font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(item, i) in auxData!.data.collision" :key="i" class="border-t hover:bg-muted/30">
                  <td class="px-2 py-1">{{ (item as PmsCollisionItem).First || (item as CollisionItem).ObjectOne }}</td>
                  <td class="px-2 py-1">{{ (item as PmsCollisionItem).Second || (item as CollisionItem).ObjectTow }}</td>
                  <td class="px-2 py-1">{{ (item as PmsCollisionItem).FirstSpeciality || (item as CollisionItem).ObjectOneMajor }}</td>
                  <td class="px-2 py-1">{{ (item as PmsCollisionItem).TypeDesc || (item as CollisionItem).ErrorMsg }}</td>
                  <td class="px-2 py-1">{{ (item as PmsCollisionItem).StatusDesc || (item as CollisionItem).ErrorStatus }}</td>
                </tr>
              </tbody>
            </table>
            <table v-else-if="activeAuxTab === 'quality' && auxData!.data.quality.length > 0" class="w-full">
              <thead class="sticky top-0 bg-muted">
                <tr>
                  <th class="px-2 py-1 text-left font-medium">分支</th>
                  <th class="px-2 py-1 text-left font-medium">元素</th>
                  <th class="px-2 py-1 text-left font-medium">规则</th>
                  <th class="px-2 py-1 text-left font-medium">专业</th>
                  <th class="px-2 py-1 text-left font-medium">错误信息</th>
                  <th class="px-2 py-1 text-left font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(item, i) in auxData!.data.quality" :key="i" class="border-t hover:bg-muted/30">
                  <td class="px-2 py-1">{{ item.BranchName }}</td>
                  <td class="px-2 py-1">{{ item.ElementName }}</td>
                  <td class="px-2 py-1">{{ item.RuleName }}</td>
                  <td class="px-2 py-1">{{ item.ProfessionalName }}</td>
                  <td class="px-2 py-1">{{ item.ErrorMessage }}</td>
                  <td class="px-2 py-1">{{ item.ErrorStatus }}</td>
                </tr>
              </tbody>
            </table>
            <table v-else-if="activeAuxTab === 'otverification' && auxData!.data.otverification.length > 0" class="w-full">
              <thead class="sticky top-0 bg-muted">
                <tr>
                  <th class="px-2 py-1 text-left font-medium">分支</th>
                  <th class="px-2 py-1 text-left font-medium">E3D对象</th>
                  <th class="px-2 py-1 text-left font-medium">PID对象</th>
                  <th class="px-2 py-1 text-left font-medium">E3D值</th>
                  <th class="px-2 py-1 text-left font-medium">PID值</th>
                  <th class="px-2 py-1 text-left font-medium">错误信息</th>
                  <th class="px-2 py-1 text-left font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(item, i) in auxData!.data.otverification" :key="i" class="border-t hover:bg-muted/30">
                  <td class="px-2 py-1">{{ item.BranchName }}</td>
                  <td class="px-2 py-1">{{ item.E3DElement }}</td>
                  <td class="px-2 py-1">{{ item.PIDElement }}</td>
                  <td class="px-2 py-1">{{ item.E3DValue }}</td>
                  <td class="px-2 py-1">{{ item.PIDValue }}</td>
                  <td class="px-2 py-1">{{ item.Message }}</td>
                  <td class="px-2 py-1">{{ item.Status }}</td>
                </tr>
              </tbody>
            </table>
            <table v-else-if="activeAuxTab === 'rules' && auxData!.data.rules.length > 0" class="w-full">
              <thead class="sticky top-0 bg-muted">
                <tr>
                  <th class="px-2 py-1 text-left font-medium">所属</th>
                  <th class="px-2 py-1 text-left font-medium">元素</th>
                  <th class="px-2 py-1 text-left font-medium">专业</th>
                  <th class="px-2 py-1 text-left font-medium">错误信息</th>
                  <th class="px-2 py-1 text-left font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(item, i) in auxData!.data.rules" :key="i" class="border-t hover:bg-muted/30">
                  <td class="px-2 py-1">{{ item.ChkElmOwnerName }}</td>
                  <td class="px-2 py-1">{{ item.ChkElmName }}</td>
                  <td class="px-2 py-1">{{ item.Department }}</td>
                  <td class="px-2 py-1">{{ item.Message }}</td>
                  <td class="px-2 py-1">{{ item.Status }}</td>
                </tr>
              </tbody>
            </table>
            <div v-else class="p-3 text-center text-muted-foreground">
              该类别暂无数据
            </div>
          </div>
          <div class="mt-1 text-[10px] text-muted-foreground">
            合计：碰撞 {{ auxData!.data.collision.length }}，质量 {{ auxData!.data.quality.length }}，二三维 {{ auxData!.data.otverification.length }}，规则 {{ auxData!.data.rules.length }}
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
