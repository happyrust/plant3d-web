import { computed, ref, shallowRef } from 'vue';

import { useQuery } from '@tanstack/vue-query';

import type { PdmsUiAttrResponse } from '@/api/genModelPdmsAttrApi';

const selectedRefno = ref<string | null>(null);
/**
 * 当前选中的构件在当前会话里已经不存在（模型版本差异模式里的幽灵行：只在 A 版有、B 版被删）。
 * 为 true 时属性查询不发（发了也只是 404），属性面板改给「该构件已删除，属性见底部属性历史对比」；
 * 任何一次正常选中都把它复位。
 */
const selectedIsDeleted = ref(false);

/**
 * 「版本钉住」的选中：版本对比里在三维点到 A / B 隔离图层的构件，属性面板要读的是**那一版**的属性，不是当前会话的。
 * `load` 由派发方闭包住那一侧的版本几何句柄（`ModelVersionSource.attributesAt`），这里只管替掉查询函数、
 * 把 sesno 掺进 query key（同一 refno 当前会话 / 某一版各自缓存）。任何一次正常选中都把它复位。
 */
export type SelectedVersionPin = {
  sesno: number;
  /** 视口 / 面板上的版本身份：`A` / `B` */
  label: string;
  load: () => Promise<PdmsUiAttrResponse>;
};
const selectedVersionPin = shallowRef<SelectedVersionPin | null>(null);

/**
 * 属性取数经数据源端口（plan 2026-09-06 P4-1）：legacy = `pdmsGetUiAttr`（旧后端 /api/pdms/ui-attr），
 * gen-model-v1 = `POST /api/v1/element/attributes`。动态引入是为了不把整套适配器（含 DuckDB）拖进每一个
 * 引用了 selection store 的组件。
 */
async function fetchUiAttr(refno: string): Promise<PdmsUiAttrResponse> {
  const { getModelSource } = await import('@/model-source');
  return getModelSource().attributes.uiAttr(refno);
}
const selectedRefnos = ref<string[]>([]);

function normalizeSelection(refnos: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const refno of refnos) {
    const key = String(refno ?? '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(key);
  }
  return next;
}

function setSelectionState(
  refnos: (string | null | undefined)[],
  activeRefno?: string | null,
  options?: { deleted?: boolean; versionPin?: SelectedVersionPin | null },
) {
  const next = normalizeSelection(refnos);
  selectedRefnos.value = next;
  selectedIsDeleted.value = next.length > 0 && options?.deleted === true;
  selectedVersionPin.value = next.length > 0 ? options?.versionPin ?? null : null;
  if (next.length === 0) {
    selectedRefno.value = null;
    return;
  }
  const active = String(activeRefno ?? '').trim();
  selectedRefno.value = active && next.includes(active) ? active : next[next.length - 1] ?? null;
}

/**
 * 在不需要 Vue 注入上下文的场景（如异步回调、命令处理器）中直接修改 selectedRefno。
 * 不调用 useQuery，因此可以在 setup() 外安全使用。
 */
export function setGlobalSelectedRefno(refno: string | null) {
  setSelectionState(refno ? [refno] : [], refno);
}

/** 选中一个当前会话里已不存在的构件（差异模式的幽灵行）：只登记 refno，不拉属性。 */
export function setGlobalSelectedDeletedRefno(refno: string) {
  setSelectionState([refno], refno, { deleted: true });
}

/** 选中某个模型版本下的构件（版本对比里点 A / B 隔离图层）：属性按 `pin.load` 取那一版的，不查当前会话。 */
export function setGlobalSelectedRefnoAtVersion(refno: string, pin: SelectedVersionPin) {
  setSelectionState([refno], refno, { versionPin: pin });
}

/** 当前选中是否是「已删除」登记（见 `selectedIsDeleted`）；不建 TanStack Query 观察者。 */
export function getGlobalSelectedIsDeleted(): boolean {
  return selectedIsDeleted.value;
}

/** 当前选中钉在哪一版（见 `selectedVersionPin`）；没钉回 null。不建 TanStack Query 观察者。 */
export function getGlobalSelectedVersionPin(): Pick<SelectedVersionPin, 'sesno' | 'label'> | null {
  const pin = selectedVersionPin.value;
  return pin ? { sesno: pin.sesno, label: pin.label } : null;
}

/** Read the current element without creating a TanStack Query observer. */
export function getGlobalSelectedRefno(): string | null {
  return selectedRefno.value;
}

function usePdmsUiAttrQuery(refno: { value: string | null }) {
  return useQuery({
    // 钉住版本时 sesno 进 key：同一 refno 的「当前会话」与「某一版」各自缓存，切回普通选中不会拿到那一版的旧值
    queryKey: computed(() => ['pdms', 'ui-attr', refno.value, selectedVersionPin.value ? `sesno:${selectedVersionPin.value.sesno}` : 'current']),
    queryFn: () => {
      const pin = selectedVersionPin.value;
      return pin ? pin.load() : fetchUiAttr(refno.value!);
    },
    // 已删除登记的选中不发查询：当前会话里没有它，发了只会 404
    enabled: computed(() => !!refno.value && !selectedIsDeleted.value),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
}

export function useSelectionStore() {
  const {
    data,
    isLoading: propertiesLoading,
    error,
    isError,
  } = usePdmsUiAttrQuery(selectedRefno);

  // 当外部逻辑（如 loadProperties）修改 selectedRefno 时，我们需要确保 query 能感知到。
  // 注意：在 store 模式下，selectedRefno 是全局单例。

  // 暴露给外界的响应式属性。已删除登记时一律当没有数据：同一 key 上可能还留着上次正常选中时缓存的 404 / 旧属性。
  const propertiesData = computed(() => (!selectedIsDeleted.value && data.value?.success ? data.value.attrs : null));
  const fullName = computed(() =>
    !selectedIsDeleted.value && data.value?.success && data.value?.full_name ? String(data.value.full_name) : null,
  );
  // 引用类属性（OWNER/REFNO 等，值为 pe:<refno>）解析出的 full_name，键为属性名。
  const refFullNames = computed<Record<string, string> | null>(() =>
    !selectedIsDeleted.value && data.value?.success && data.value?.ref_full_names ? data.value.ref_full_names : null,
  );
  const propertiesError = computed(() => {
    if (selectedIsDeleted.value) return null;
    if (isError.value) return error.value instanceof Error ? error.value.message : String(error.value);
    if (data.value && !data.value.success) return data.value.error_message || '属性查询失败';
    return null;
  });
  // 属性来源的诊断（gen-model-v1 直读源才有：未解码 / 形状冲突 / 是否完整），面板尾部给一行提示。
  const propertiesDiagnostics = computed(() => (!selectedIsDeleted.value && data.value?.success ? data.value.diagnostics ?? null : null));

  async function loadProperties(refno: string) {
    setSelectionState([refno], refno);
  }

  function clearSelection() {
    setSelectionState([]);
  }

  function setSelectedRefno(refno: string | null) {
    setSelectionState(refno ? [refno] : [], refno);
  }

  /** 选中一个当前会话里已不存在的构件（差异模式的幽灵行）：属性面板给提示、不拉属性。 */
  function setSelectedDeletedRefno(refno: string) {
    setSelectionState([refno], refno, { deleted: true });
  }

  /** 选中某个模型版本下的构件（版本对比里点 A / B 隔离图层）：属性面板读那一版，标题栏注明来源。 */
  function setSelectedRefnoAtVersion(refno: string, pin: SelectedVersionPin) {
    setSelectionState([refno], refno, { versionPin: pin });
  }

  function setSelectedRefnos(refnos: (string | null | undefined)[], activeRefno?: string | null) {
    setSelectionState(refnos, activeRefno);
  }

  function clearSelectedRefnos() {
    setSelectionState([]);
  }

  function isSelected(refno: string): boolean {
    return selectedRefnos.value.includes(String(refno ?? '').trim());
  }

  function toggleSelectedRefno(refno: string) {
    const key = String(refno ?? '').trim();
    if (!key) return;
    if (selectedRefnos.value.includes(key)) {
      setSelectionState(selectedRefnos.value.filter((item) => item !== key));
      return;
    }
    setSelectionState([...selectedRefnos.value, key], key);
  }

  return {
    selectedRefno,
    selectedRefnos,
    selectedIsDeleted: computed(() => selectedIsDeleted.value),
    /** 当前选中钉在哪一版（`{ sesno, label }`）；普通选中为 null */
    selectedVersionPin: computed(() => {
      const pin = selectedVersionPin.value;
      return pin ? { sesno: pin.sesno, label: pin.label } : null;
    }),
    propertiesLoading,
    propertiesError,
    propertiesData,
    propertiesDiagnostics,
    fullName,
    refFullNames,
    loadProperties,
    clearSelection,
    clearSelectedRefnos,
    isSelected,
    setSelectedRefno,
    setSelectedDeletedRefno,
    setSelectedRefnoAtVersion,
    setSelectedRefnos,
    toggleSelectedRefno,
  };
}
