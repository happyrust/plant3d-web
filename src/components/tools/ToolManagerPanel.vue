<script setup lang="ts">
import { computed, ref, type Ref } from 'vue';

import { setDbnoInstancesManifest } from '@/composables/useDbnoInstancesJsonLoader';
import { useModelGeneration } from '@/composables/useModelGeneration';
import { useToolStore } from '@/composables/useToolStore';
import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore';
import { useViewerContext } from '@/composables/useViewerContext';
import type { InstanceManifest } from '@/utils/instances/instanceManifest';
import { formatLengthMeters, formatVec3Meters } from '@/utils/unitFormat';

type ToolsApi = {
  ready: Ref<boolean>;
  syncFromStore: () => void;
  clearAllInScene: () => void;
};

const props = defineProps<{
  tools: ToolsApi;
}>();

const store = useToolStore();
const unitSettings = useUnitSettingsStore();
const ctx = useViewerContext();
const isDev = import.meta.env.DEV;

const exportText = computed(() => store.exportJSON());

const importText = ref('');
const importError = ref<string | null>(null);

const instancesDbno = ref('');
const instancesRootRefno = ref('');
const instancesManifest = ref<InstanceManifest | null>(null);
const instancesImportError = ref<string | null>(null);
const instancesLoading = ref(false);
const instancesStatus = ref<string>('');

const modelUnitModel = computed({
  get: () => unitSettings.modelUnit.value,
  set: (v) => unitSettings.setModelUnit(v as any),
});

const displayUnitModel = computed({
  get: () => unitSettings.displayUnit.value,
  set: (v) => unitSettings.setDisplayUnit(v as any),
});

const precisionModel = computed({
  get: () => unitSettings.precision.value,
  set: (v) => unitSettings.setPrecision(Number(v)),
});

const recenterModel = computed({
  get: () => unitSettings.recenter.value,
  set: (v) => unitSettings.setRecenter(Boolean(v)),
});

const clipModel = computed({
  get: () => unitSettings.clip.value,
  set: (v) => unitSettings.setClip(Boolean(v)),
});

const autoFitOnLoadModel = computed({
  get: () => unitSettings.autoFitOnLoad.value,
  set: (v) => unitSettings.setAutoFitOnLoad(Boolean(v)),
});

const ptsetPolicyModel = computed({
  get: () => unitSettings.ptsetDisplayPolicy.value,
  set: (v) => unitSettings.setPtsetDisplayPolicy(v as any),
});

type CameraSnapshot = {
  position: [number, number, number];
  target: [number, number, number];
  distance: number;
  near: number;
  far: number;
};

const cameraSnapshot = ref<CameraSnapshot | null>(null);

function refreshCameraSnapshot() {
  const viewer = ctx.viewerRef.value as any;
  if (!viewer) {
    cameraSnapshot.value = null;
    return;
  }

  try {
    const dtxViewer = viewer.__dtxViewer as any;
    const cam = dtxViewer?.camera as any;
    const controls = dtxViewer?.controls as any;
    const pos = cam?.position;
    const tgt = controls?.target;
    if (!pos || !tgt) {
      cameraSnapshot.value = null;
      return;
    }

    const dx = Number(pos.x) - Number(tgt.x);
    const dy = Number(pos.y) - Number(tgt.y);
    const dz = Number(pos.z) - Number(tgt.z);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    cameraSnapshot.value = {
      position: [Number(pos.x) || 0, Number(pos.y) || 0, Number(pos.z) || 0],
      target: [Number(tgt.x) || 0, Number(tgt.y) || 0, Number(tgt.z) || 0],
      distance: Number.isFinite(dist) ? dist : 0,
      near: Number(cam.near) || 0,
      far: Number(cam.far) || 0,
    };
  } catch {
    cameraSnapshot.value = null;
  }
}

async function copyCameraSnapshot() {
  if (!cameraSnapshot.value) return;
  const u = unitSettings.displayUnit.value;
  const p = unitSettings.precision.value;
  const text =
    `position=${formatVec3Meters(cameraSnapshot.value.position, u, p)}\n` +
    `target=${formatVec3Meters(cameraSnapshot.value.target, u, p)}\n` +
    `distance=${formatLengthMeters(cameraSnapshot.value.distance, u, p)}\n` +
    `clip=${cameraSnapshot.value.near.toFixed(3)}..${cameraSnapshot.value.far.toFixed(3)}`;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}

function fitToScene() {
  const viewer = ctx.viewerRef.value as any;
  if (!viewer) return;
  try {
    const layer = viewer.__dtxLayer as any;
    const box = layer?.getBoundingBox?.();
    if (!box || !box.min || !box.max) return;
    viewer.cameraFlight?.jumpTo?.({
      aabb: [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z],
    });
  } catch {
    // ignore
  }
}

function extractDbnoFromRefno(refno: string): number | null {
  const normalized = String(refno || '').trim().replace('/', '_');
  const head = normalized.split('_')[0];
  const n = Number(head);
  return Number.isFinite(n) ? n : null;
}

function guessRootRefnoFromManifest(manifest: InstanceManifest): string | null {
  const v0 = (manifest as any)?.instances;
  if (Array.isArray(v0) && v0.length > 0 && v0[0] && typeof v0[0] === 'object') {
    const r = String(v0[0]?.refno ?? '').trim().replace('/', '_');
    return r || null;
  }
  return null;
}

async function handleInstancesFileSelect(event: Event) {
  instancesImportError.value = null;
  instancesStatus.value = '';
  instancesManifest.value = null;

  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as InstanceManifest;
    instancesManifest.value = parsed;

    const guessedRoot = guessRootRefnoFromManifest(parsed);
    if (guessedRoot && !instancesRootRefno.value) {
      instancesRootRefno.value = guessedRoot;
    }

    const guessedDbno = extractDbnoFromRefno(instancesRootRefno.value || guessedRoot || '');
    if (guessedDbno !== null && !instancesDbno.value) {
      instancesDbno.value = String(guessedDbno);
    }

    instancesStatus.value = `已读取: ${file.name}`;
  } catch (e) {
    instancesImportError.value = e instanceof Error ? e.message : String(e);
  } finally {
    input.value = '';
  }
}

async function importInstancesAndLoadDtx() {
  instancesImportError.value = null;
  instancesStatus.value = '';

  const viewer = ctx.viewerRef.value;
  if (!viewer) {
    instancesImportError.value = 'Viewer 未就绪，请先等待 3D Viewer 初始化完成';
    return;
  }
  const manifest = instancesManifest.value;
  if (!manifest) {
    instancesImportError.value = '请先选择 instances_*.json 文件';
    return;
  }

  const dbno = Number(instancesDbno.value);
  if (!Number.isFinite(dbno) || dbno <= 0) {
    instancesImportError.value = '请输入有效的 dbno（例如 1112）';
    return;
  }

  const rootRefno = String(instancesRootRefno.value || '').trim().replace('/', '_');
  if (!rootRefno) {
    instancesImportError.value = '请输入要加载的 root refno（例如 17496_106028）';
    return;
  }

  instancesLoading.value = true;
  try {
    setDbnoInstancesManifest(dbno, manifest);
    const gen = useModelGeneration({ viewer, db_num: dbno });
    const ok = await gen.showModelByRefno(rootRefno);
    instancesStatus.value = ok ? 'DTX 加载完成' : (gen.error.value || 'DTX 加载失败');
    if (ok) {
      try {
        const layer = (viewer as any).__dtxLayer as any;
        const box = layer?.getBoundingBox?.();
        if (box && box.min && box.max) {
          viewer.cameraFlight?.jumpTo?.({
            aabb: [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z],
          });
        }
      } catch {
        // ignore
      }
    }
  } catch (e) {
    instancesImportError.value = e instanceof Error ? e.message : String(e);
  } finally {
    instancesLoading.value = false;
  }
}

async function copyExport() {
  const text = exportText.value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}

function doImport() {
  importError.value = null;
  try {
    store.importJSON(importText.value);
    props.tools.syncFromStore();
  } catch (e) {
    importError.value = e instanceof Error ? e.message : String(e);
  }
}

function clearAll() {
  props.tools.clearAllInScene();
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-semibold">总览</div>
        <div class="text-xs text-muted-foreground">
          测量 {{ store.measurementCount }} 条 / 批注 {{ store.annotationCount }} 条
        </div>
      </div>

      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm text-destructive hover:bg-muted"
          @click="clearAll">
          清空全部
        </button>
      </div>

      <div class="mt-2 text-xs text-muted-foreground">
        清空会同时删除场景中的标记，并清除本地存储。
      </div>
    </div>

    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-semibold">单位与视角</div>
        <div class="flex items-center gap-2">
          <button type="button"
            class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
            @click="fitToScene">
            重新适配视角
          </button>
          <button type="button"
            class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
            @click="refreshCameraSnapshot">
            刷新视角
          </button>
          <button type="button"
            class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted disabled:opacity-50"
            :disabled="!cameraSnapshot"
            @click="copyCameraSnapshot">
            复制
          </button>
        </div>
      </div>

      <div class="mt-3 grid grid-cols-1 gap-2 text-sm">
        <label class="flex items-center justify-between gap-3">
          <span class="text-xs text-muted-foreground">模型单位（DTX 源数据）</span>
          <select class="h-9 w-44 rounded-md border border-input bg-background px-2 text-sm"
            v-model="modelUnitModel">
            <option value="mm">毫米(mm) → 归一化到米</option>
            <option value="m">米(m) → 原样</option>
            <option value="raw">原始(raw) → 原样</option>
          </select>
        </label>

        <label class="flex items-center justify-between gap-3">
          <span class="text-xs text-muted-foreground">显示单位</span>
          <select class="h-9 w-44 rounded-md border border-input bg-background px-2 text-sm"
            v-model="displayUnitModel">
            <option value="m">米(m)</option>
            <option value="cm">厘米(cm)</option>
            <option value="mm">毫米(mm)</option>
          </select>
        </label>

        <label class="flex items-center justify-between gap-3">
          <span class="text-xs text-muted-foreground">小数位</span>
          <input type="number"
            class="h-9 w-44 rounded-md border border-input bg-background px-3 text-sm"
            min="0" max="6" step="1"
            v-model.number="precisionModel" />
        </label>

        <div class="flex flex-wrap items-center gap-4 pt-1 text-xs">
          <label class="inline-flex items-center gap-2">
            <input type="checkbox" v-model="recenterModel" />
            <span>重心归位(recenter)</span>
          </label>
          <label class="inline-flex items-center gap-2">
            <input type="checkbox" v-model="clipModel" />
            <span>裁剪面自适应(clip)</span>
          </label>
          <label class="inline-flex items-center gap-2">
            <input type="checkbox" v-model="autoFitOnLoadModel" />
            <span>加载后自动适配(auto-fit)</span>
          </label>
        </div>

        <label class="flex items-center justify-between gap-3">
          <span class="text-xs text-muted-foreground">点集显示策略</span>
          <select class="h-9 w-44 rounded-md border border-input bg-background px-2 text-sm"
            v-model="ptsetPolicyModel">
            <option value="use_display_unit">使用显示单位</option>
            <option value="follow_backend">跟随后端 unit_info</option>
          </select>
        </label>

        <div class="mt-2 rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
          <div v-if="cameraSnapshot">
            <div>position: {{ formatVec3Meters(cameraSnapshot.position, unitSettings.displayUnit.value, unitSettings.precision.value) }}</div>
            <div>target: {{ formatVec3Meters(cameraSnapshot.target, unitSettings.displayUnit.value, unitSettings.precision.value) }}</div>
            <div>distance: {{ formatLengthMeters(cameraSnapshot.distance, unitSettings.displayUnit.value, unitSettings.precision.value) }}</div>
            <div>clip: {{ cameraSnapshot.near.toFixed(3) }} .. {{ cameraSnapshot.far.toFixed(3) }}</div>
          </div>
          <div v-else>未获取到视角信息（请先打开 3D Viewer 并点击“刷新视角”）</div>
        </div>

        <div class="mt-1 text-xs text-muted-foreground">
          说明：显示单位仅影响数值展示；模型单位会影响 bbox/auto-fit/拾取/裁剪。变更模型单位可能需要清空现有测量/批注/点集。
        </div>
      </div>
    </div>

    <div class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-semibold">导出</div>
        <button type="button"
          class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
          @click="copyExport">
          复制
        </button>
      </div>

      <textarea class="mt-2 min-h-40 w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
        readonly
        :value="exportText" />
    </div>

    <div class="rounded-md border border-border bg-background p-3">
      <div class="text-sm font-semibold">导入</div>
      <textarea v-model="importText"
        class="mt-2 min-h-40 w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
        placeholder="粘贴 JSON 后点击导入" />

      <div v-if="importError" class="mt-2 text-sm text-destructive">
        {{ importError }}
      </div>

      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
          @click="doImport">
          导入并同步
        </button>
      </div>

      <div class="mt-2 text-xs text-muted-foreground">
        导入后会覆盖当前本地数据，并尝试同步到当前场景。
      </div>
    </div>

    <div class="rounded-md border border-border bg-background p-3" v-if="isDev">
      <div class="text-sm font-semibold">DTX / Instances 导入（开发用）</div>
      <div class="mt-2 text-xs text-muted-foreground">
        说明：把本地 instances_*.json 注入到前端缓存，然后复用现有 DTX 加载链路渲染（不写回后端）。
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <label class="h-9 cursor-pointer rounded-md border border-input bg-background px-3 text-sm hover:bg-muted flex items-center">
          选择 JSON 文件
          <input type="file" accept="application/json" class="hidden" @change="handleInstancesFileSelect" />
        </label>

        <input v-model="instancesDbno"
          class="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm"
          placeholder="dbno" />

        <input v-model="instancesRootRefno"
          class="h-9 min-w-[220px] flex-1 rounded-md border border-input bg-background px-3 text-sm"
          placeholder="root refno（如 1112_12345）" />

        <button type="button"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted disabled:opacity-50"
          :disabled="instancesLoading"
          @click="importInstancesAndLoadDtx">
          导入并加载
        </button>
      </div>

      <div v-if="instancesImportError" class="mt-2 text-sm text-destructive">
        {{ instancesImportError }}
      </div>
      <div v-else-if="instancesStatus" class="mt-2 text-xs text-muted-foreground">
        {{ instancesStatus }}
      </div>
    </div>
  </div>
</template>
