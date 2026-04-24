import { computed, ref } from 'vue';

import { useQuery } from '@tanstack/vue-query';

import { pdmsGetUiAttr } from '@/api/genModelPdmsAttrApi';

const selectedRefno = ref<string | null>(null);
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

function setSelectionState(refnos: (string | null | undefined)[], activeRefno?: string | null) {
  const next = normalizeSelection(refnos);
  selectedRefnos.value = next;
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

function usePdmsUiAttrQuery(refno: { value: string | null }) {
  return useQuery({
    queryKey: computed(() => ['pdms', 'ui-attr', refno.value]),
    queryFn: () => pdmsGetUiAttr(refno.value!),
    enabled: computed(() => !!refno.value),
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

  // 暴露给外界的响应式属性
  const propertiesData = computed(() => (data.value?.success ? data.value.attrs : null));
  const fullName = computed(() =>
    data.value?.success && data.value?.full_name ? String(data.value.full_name) : null,
  );
  const propertiesError = computed(() => {
    if (isError.value) return error.value instanceof Error ? error.value.message : String(error.value);
    if (data.value && !data.value.success) return data.value.error_message || '属性查询失败';
    return null;
  });

  async function loadProperties(refno: string) {
    setSelectionState([refno], refno);
  }

  function clearSelection() {
    setSelectionState([]);
  }

  function setSelectedRefno(refno: string | null) {
    setSelectionState(refno ? [refno] : [], refno);
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
    propertiesLoading,
    propertiesError,
    propertiesData,
    fullName,
    loadProperties,
    clearSelection,
    clearSelectedRefnos,
    isSelected,
    setSelectedRefno,
    setSelectedRefnos,
    toggleSelectedRefno,
  };
}
