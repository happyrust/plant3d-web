/**
 * 加载会话：一次「显示这个节点」从开始到结束的那一段，以及中途叫停它的入口
 * （方案 `docs/plans/2026-11-10-model-load-speed-generate-and-freshness-plan.md` 第三轮；ADR 0072）。
 *
 * 用户 2026-11-11 定的语义：加载中可以停——停掉剩下的批次，把这个节点已经画出来的部分收起来，回到没显示的状态；
 * 已经取到的数据留在缓存里，再点眼睛会更快。读记录、取网格、分块生成三个阶段都能停。
 *
 * 分工：
 * - 这里只管「有哪些节点正在加载、能不能停、被叫停了没有」，以及把「停」变成一个 `AbortSignal`；
 * - 显示流程（`useModelGeneration.showModelByRefno`）把 `signal` 交给取记录、取网格、生成请求，在每个等待点之后
 *   问一次 `throwIfStopped()`，被叫停时自己把这一次画出来的收回去；
 * - 入口是模型树行尾的转圈和查看器左下角的状态条，它们调 `requestStopModelLoad(节点)`。
 *
 * 模块级、全页面一份：模型树和查看器各有一个 `useModelGeneration` 实例，装的是同一个场景。
 */
import { reactive } from 'vue';

import { toRefnoKey } from '@/utils/refnoKey';

/** 加载被叫停时，显示流程内部用它跳出（不是失败：不记错误、不弹错误提示） */
export class ModelLoadStoppedError extends Error {
  constructor(root: string) {
    super(`已停止加载 ${root}`);
    this.name = 'ModelLoadStoppedError';
  }
}

export type ModelLoadSession = {
  /** 正在显示的节点（`a_b`） */
  readonly root: string;
  /** 被叫停时 abort：交给取记录、取网格、生成请求 */
  readonly signal: AbortSignal;
  /** 被叫停了（或显示流程自己 `stop()` 了） */
  readonly stopped: boolean;
  /** 被叫停就抛 `ModelLoadStoppedError`；显示流程在每个等待点之后调一次 */
  throwIfStopped(): void;
  /**
   * 登记「叫停时当场要做的事」（比如取消共用的那次记录读取——它不认这里的 `signal`）。回撤销函数。
   * 已经被叫停之后才登记的当场执行。
   */
  onStop(handler: () => void): () => void;
  /** 这一段不能停 / 又能停了 */
  setStoppable(stoppable: boolean): void;
  /** 显示流程自己判断该停（生成到一半这个节点被隐藏了）：效果同被叫停 */
  stop(): void;
  /** 这一次画出来的已经收回去了：记一笔，发起显示的一方（模型树的眼睛）据此不再把节点同步成可见 */
  markWithdrawn(): void;
  /** 显示流程结束时调（可重复调） */
  end(): void;
};

type SessionState = {
  stoppable: boolean;
  stopped: boolean;
  controller: AbortController;
  handlers: Set<() => void>;
};

/** 节点 → 它正在进行的加载（同一个节点可能同时有两路：模型树和查看器各一份显示流程） */
const sessions = reactive(new Map<string, Set<SessionState>>());
/** 被叫停、已经收回去的节点：发起显示的一方问一次就清掉 */
const withdrawn = new Set<string>();

function stopSession(state: SessionState, root: string): void {
  if (state.stopped) return;
  state.stopped = true;
  state.stoppable = false;
  state.controller.abort(new ModelLoadStoppedError(root));
  for (const handler of [...state.handlers]) {
    try {
      handler();
    } catch {
      // 一个收尾动作出错不影响叫停，也不影响别的收尾动作
    }
  }
}

/** 开始一次加载。`stoppable: false`：从头到尾都不能停（重新生成——后端已经在清旧模型）。 */
export function beginModelLoadSession(root: string, options: { stoppable?: boolean } = {}): ModelLoadSession {
  const key = toRefnoKey(root);
  // 放进响应式表里的是代理：之后一律经它读写，行上的转圈才跟着变
  const bucket = sessions.get(key) ?? (sessions.set(key, new Set()), sessions.get(key)!);
  bucket.add({ stoppable: options.stoppable !== false, stopped: false, controller: new AbortController(), handlers: new Set() });
  const state = [...bucket].at(-1)!;
  let ended = false;
  return {
    root: key,
    signal: state.controller.signal,
    get stopped() {
      return state.stopped;
    },
    throwIfStopped() {
      if (state.stopped) throw new ModelLoadStoppedError(key);
    },
    onStop(handler) {
      if (state.stopped) {
        try {
          handler();
        } catch {
          // 同 stopSession
        }
        return () => {};
      }
      state.handlers.add(handler);
      return () => { state.handlers.delete(handler); };
    },
    setStoppable(stoppable) {
      if (!state.stopped) state.stoppable = stoppable;
    },
    stop() {
      stopSession(state, key);
    },
    markWithdrawn() {
      withdrawn.add(key);
    },
    end() {
      if (ended) return;
      ended = true;
      const current = sessions.get(key);
      if (!current) return;
      current.delete(state);
      if (current.size === 0) sessions.delete(key);
    },
  };
}

/**
 * 叫停这个节点正在进行的加载。回 `true` = 这一下真的叫停了什么；没有在加载、此刻不能停、已经在停了都回 `false`。
 * 叫停是立刻的：信号当场 abort，之后不再发新请求；已经画出来的由显示流程在它的下一个等待点收回去。
 */
export function requestStopModelLoad(root: string): boolean {
  const key = toRefnoKey(root);
  const bucket = sessions.get(key);
  if (!bucket) return false;
  let stoppedAny = false;
  for (const state of bucket) {
    if (!state.stoppable || state.stopped) continue;
    stopSession(state, key);
    stoppedAny = true;
  }
  return stoppedAny;
}

/** 行尾转圈 / 状态条要的东西：这个节点没有在加载回 `null`。响应式。 */
export function modelLoadSessionView(root: string): { stoppable: boolean; stopping: boolean } | null {
  const bucket = sessions.get(toRefnoKey(root));
  if (!bucket || bucket.size === 0) return null;
  let stoppable = false;
  let stopping = false;
  for (const state of bucket) {
    if (state.stoppable && !state.stopped) stoppable = true;
    if (state.stopped) stopping = true;
  }
  return { stoppable, stopping };
}

/**
 * 这个节点的上一次显示是不是被叫停、收回去了（问一次就清掉）。发起显示的一方在显示流程回来之后问：
 * 是的话不要再把节点同步成可见、也不要去「显示部分加载的数据」——人已经不要它了。
 */
export function consumeModelLoadStopped(root: string): boolean {
  return withdrawn.delete(toRefnoKey(root));
}

/** 正在进行的整库显示数（整库显示不是按节点的加载，没有上面那种会话） */
let wholeLibraryLoads = 0;

/** 整库显示开始时记一笔；回的函数在它结束时调（可重复调）。 */
export function beginWholeLibraryLoad(): () => void {
  wholeLibraryLoads += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    wholeLibraryLoads = Math.max(0, wholeLibraryLoads - 1);
  };
}

/** 此刻有没有任何加载在进行：按节点的显示 / 重载 / 生成，或整库显示（「取最新」据此等它们结束，不打断）。 */
export function hasActiveModelLoad(): boolean {
  return sessions.size > 0 || wholeLibraryLoads > 0;
}

export function __resetModelLoadSessionsForTests(): void {
  sessions.clear();
  withdrawn.clear();
  wholeLibraryLoads = 0;
}
