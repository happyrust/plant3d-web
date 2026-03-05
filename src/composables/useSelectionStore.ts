import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';

import { pdmsGetUiAttr } from '@/api/genModelPdmsAttrApi';

const selectedRefno = ref<string | null>(null);

/**
 * 在不需要 Vue 注入上下文的场景（如异步回调、命令处理器）中直接修改 selectedRefno。
 * 不调用 useQuery，因此可以在 setup() 外安全使用。
 */
export function setGlobalSelectedRefno(refno: string | null) {
  if (refno === selectedRefno.value) return;
  selectedRefno.value = refno;
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
    selectedRefno.value = refno;
  }

  function clearSelection() {
    selectedRefno.value = null;
  }

  function setSelectedRefno(refno: string | null) {
    if (refno === selectedRefno.value) return;
    selectedRefno.value = refno;
  }

  return {
    selectedRefno,
    propertiesLoading,
    propertiesError,
    propertiesData,
    fullName,
    loadProperties,
    clearSelection,
    setSelectedRefno,
  };
}
