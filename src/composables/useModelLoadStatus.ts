/**
 * 查看器左下角加载状态条的状态。状态条全页面只有一条，同时在跑的加载却可以有几个（连续点亮几个节点；模型树和查看器
 * 各有一个 `useModelGeneration` 实例；整库显示）。每个加载 `begin()` 一次、拿到自己的那一条：进度只写在自己那条上，
 * 结束只拿掉自己那条。状态条显示还在跑的里面最早开始的那一条，它结束了换成下一条，全都结束了才收起来。
 *
 * 原来全页面只有一份状态：谁结束谁就把它整个清掉（连「停」认的节点一起），还在跑的再写进度时状态条重新出来，
 * 「停」已经没了；几个加载的进度也互相覆盖（#164）。
 */
import { computed, ref } from 'vue';

type ModelLoadStatusState = {
  visible: boolean
  progress: number
  message: string
  currentRefno: string
  error: string | null
  /**
   * 状态条上显示的是哪个节点的加载（`a_b`）：状态条上的「停」拿它去叫停（`modelLoadSession.requestStopModelLoad`）。
   * 不是按节点显示的加载（整库显示等）为 `null`，状态条不出「停」。
   */
  stopKey: string | null
}

/** 一个加载在状态条上自己的那一条 */
export type ModelLoadStatusEntry = {
  /** 改这一条（没给的字段保持原样）。这个加载结束之后再改不起作用：不会把收起来的状态条又拉出来 */
  update(change: { message?: string; progress?: number; currentRefno?: string; error?: string | null }): void
  /**
   * 这个加载结束了：拿掉这一条（重复调只算第一次）。状态条换成下一个还在跑的；一个都没有了就收起来，
   * 留着这一条最后的文案与进度。
   */
  finish(result?: { message?: string; error?: string | null }): void
}

type Entry = Omit<ModelLoadStatusState, 'visible'>;

function hiddenState(): ModelLoadStatusState {
  return { visible: false, progress: 0, message: '', currentRefno: '', error: null, stopKey: null };
}

const state = ref<ModelLoadStatusState>(hiddenState());

/** 还在跑的加载，按开始的先后；状态条显示的是排在最前面的那一条 */
const running: Entry[] = [];

function normalizeProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function showFirst(): void {
  const first = running[0];
  if (first) state.value = { visible: true, ...first };
}

export function useModelLoadStatus() {
  const hasError = computed(() => !!state.value.error);

  /** 一个加载开始：在状态条上记一条。前面还有没结束的加载时，这一条先记着，轮到它才显示 */
  function begin(payload?: { message?: string; progress?: number; currentRefno?: string; stopKey?: string | null }): ModelLoadStatusEntry {
    const entry: Entry = {
      progress: normalizeProgress(payload?.progress ?? 0),
      message: payload?.message ?? '',
      currentRefno: payload?.currentRefno ?? '',
      error: null,
      stopKey: payload?.stopKey ?? null,
    };
    running.push(entry);
    if (running[0] === entry) showFirst();
    return {
      update(change) {
        if (!running.includes(entry)) return;
        if (change.progress !== undefined) entry.progress = normalizeProgress(change.progress);
        if (change.message !== undefined) entry.message = change.message;
        if (change.currentRefno !== undefined) entry.currentRefno = change.currentRefno;
        if (change.error !== undefined) entry.error = change.error;
        if (running[0] === entry) showFirst();
      },
      finish(result) {
        const index = running.indexOf(entry);
        if (index < 0) return;
        running.splice(index, 1);
        // 状态条上显示的不是这一条：拿掉就行，状态条不动
        if (index > 0) return;
        if (running.length > 0) {
          showFirst();
          return;
        }
        state.value = {
          visible: false,
          progress: result?.error ? entry.progress : 100,
          message: result?.message ?? entry.message,
          currentRefno: entry.currentRefno,
          error: result?.error ?? null,
          stopKey: null,
        };
      },
    };
  }

  function reset() {
    running.length = 0;
    state.value = hiddenState();
  }

  return {
    state,
    hasError,
    begin,
    reset,
  };
}
