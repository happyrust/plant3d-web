import { computed, ref } from 'vue';

type ModelLoadStatusState = {
  visible: boolean
  progress: number
  message: string
  currentRefno: string
  error: string | null
}

const state = ref<ModelLoadStatusState>({
  visible: false,
  progress: 0,
  message: '',
  currentRefno: '',
  error: null,
});

function normalizeProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function useModelLoadStatus() {
  const hasError = computed(() => !!state.value.error);

  function begin(payload?: { message?: string; progress?: number; currentRefno?: string }) {
    state.value = {
      visible: true,
      progress: normalizeProgress(payload?.progress ?? 0),
      message: payload?.message ?? '',
      currentRefno: payload?.currentRefno ?? '',
      error: null,
    };
  }

  function update(payload: { message?: string; progress?: number; currentRefno?: string; error?: string | null }) {
    state.value = {
      visible: true,
      progress: normalizeProgress(payload.progress ?? state.value.progress),
      message: payload.message ?? state.value.message,
      currentRefno: payload.currentRefno ?? state.value.currentRefno,
      error: payload.error !== undefined ? payload.error : state.value.error,
    };
  }

  function finish(payload?: { message?: string; error?: string | null }) {
    state.value = {
      visible: false,
      progress: payload?.error ? state.value.progress : 100,
      message: payload?.message ?? state.value.message,
      currentRefno: state.value.currentRefno,
      error: payload?.error ?? null,
    };
  }

  function reset() {
    state.value = {
      visible: false,
      progress: 0,
      message: '',
      currentRefno: '',
      error: null,
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
