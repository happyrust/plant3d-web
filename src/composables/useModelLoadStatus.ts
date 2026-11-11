import { computed, ref } from 'vue';

type ModelLoadStatusState = {
  visible: boolean
  progress: number
  message: string
  currentRefno: string
  error: string | null
  /**
   * 正在显示的是哪个节点（`a_b`）：状态条上的「停」拿它去叫停（`modelLoadSession.requestStopModelLoad`）。
   * 不是按节点显示的加载（整库显示等）为 `null`，状态条不出「停」。
   */
  stopKey: string | null
}

const state = ref<ModelLoadStatusState>({
  visible: false,
  progress: 0,
  message: '',
  currentRefno: '',
  error: null,
  stopKey: null,
});

function normalizeProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function useModelLoadStatus() {
  const hasError = computed(() => !!state.value.error);

  function begin(payload?: { message?: string; progress?: number; currentRefno?: string; stopKey?: string | null }) {
    state.value = {
      visible: true,
      progress: normalizeProgress(payload?.progress ?? 0),
      message: payload?.message ?? '',
      currentRefno: payload?.currentRefno ?? '',
      error: null,
      stopKey: payload?.stopKey ?? null,
    };
  }

  function update(payload: { message?: string; progress?: number; currentRefno?: string; error?: string | null }) {
    state.value = {
      visible: true,
      progress: normalizeProgress(payload.progress ?? state.value.progress),
      message: payload.message ?? state.value.message,
      currentRefno: payload.currentRefno ?? state.value.currentRefno,
      error: payload.error !== undefined ? payload.error : state.value.error,
      stopKey: state.value.stopKey,
    };
  }

  function finish(payload?: { message?: string; error?: string | null }) {
    state.value = {
      visible: false,
      progress: payload?.error ? state.value.progress : 100,
      message: payload?.message ?? state.value.message,
      currentRefno: state.value.currentRefno,
      error: payload?.error ?? null,
      stopKey: null,
    };
  }

  function reset() {
    state.value = {
      visible: false,
      progress: 0,
      message: '',
      currentRefno: '',
      error: null,
      stopKey: null,
    };
  }

  return {
    state,
    hasError,
    begin,
    update,
    finish,
    reset,
  };
}
