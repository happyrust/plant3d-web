import { ref } from 'vue';

import { pdmsGetUiAttr, type PdmsUiAttrResponse } from '@/api/genModelPdmsAttrApi';

const selectedRefno = ref<string | null>(null);

const propertiesLoading = ref(false);
const propertiesError = ref<string | null>(null);
const propertiesData = ref<PdmsUiAttrResponse['attrs'] | null>(null);

let loadSeq = 0;

async function loadProperties(refno: string) {
  const seq = ++loadSeq;
  selectedRefno.value = refno;
  propertiesLoading.value = true;
  propertiesError.value = null;

  try {
    const resp = await pdmsGetUiAttr(refno);
    if (seq !== loadSeq) return;

    if (!resp.success) {
      propertiesData.value = null;
      propertiesError.value = resp.error_message || '属性查询失败';
      return;
    }

    propertiesData.value = resp.attrs || {};
  } catch (e) {
    if (seq !== loadSeq) return;
    propertiesData.value = null;
    propertiesError.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (seq === loadSeq) {
      propertiesLoading.value = false;
    }
  }
}

function clearSelection() {
  loadSeq++;
  selectedRefno.value = null;
  propertiesLoading.value = false;
  propertiesError.value = null;
  propertiesData.value = null;
}

export function useSelectionStore() {
  return {
    selectedRefno,
    propertiesLoading,
    propertiesError,
    propertiesData,
    loadProperties,
    clearSelection,
  };
}
