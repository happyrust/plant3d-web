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
 * 排队（#166）：连续点亮几个节点时一个个来——同一时刻全页面只有一个节点的显示在真正执行（读记录、装载、按需补齐）。
 * 装载器对「已装」的判断不是并发安全的，几条显示一起闯进去会漏装、反复重编；几个节点一起补生成还会抢浏览器的连接、
 * 撞后端的生成根锁，退避重试好几分钟。显示流程点下去当场进会话（行尾立刻是「停」），再 `waitTurn()` 等轮到；
 * 排队中的一律能停，停了当场出队；在跑的那个结束时（做完，或被叫停并把这次画出来的收回去之后）`end()` 把这一轮
 * 交给排在最前面的那个。
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
  /** 这一次显示记过「收回去了」（`markWithdrawn()` 之后为 `true`） */
  readonly withdrawn: boolean;
  /** 被叫停就抛 `ModelLoadStoppedError`；显示流程在每个等待点之后调一次 */
  throwIfStopped(): void;
  /**
   * 登记「叫停时当场要做的事」（比如取消共用的那次记录读取——它不认这里的 `signal`）。回撤销函数。
   * 已经被叫停之后才登记的当场执行。
   */
  onStop(handler: () => void): () => void;
  /** 这一段不能停 / 又能停了（说的是轮到之后；排队中的一律能停） */
  setStoppable(stoppable: boolean): void;
  /** 显示流程自己判断该停（生成到一半这个节点被隐藏了）：效果同被叫停 */
  stop(): void;
  /**
   * 排队等轮到（#166）。此刻没有别的节点在跑：当场轮到，同步回 `true`（不多等一拍）。前面有人：进队，回一个 Promise——
   * 轮到了是 `true`；排队时被叫停是 `false`（已经出队，什么都还没开始）。轮到之后一直占着这一轮，到 `end()` 才交出去。
   */
  waitTurn(): true | Promise<boolean>;
  /** 这一次画出来的已经收回去了：记一笔，发起显示的一方（模型树的眼睛）据此不再把节点同步成可见 */
  markWithdrawn(): void;
  /** 显示流程结束时调（可重复调）。占着这一轮的话，交给排在最前面的那个 */
  end(): void;
};

type SessionState = {
  stoppable: boolean;
  stopped: boolean;
  /** 在排队、还没轮到（#166）。这时一律能停：什么都还没开始，也什么都没发给后端 */
  queued: boolean;
  controller: AbortController;
  handlers: Set<() => void>;
};

/** 节点 → 它正在进行的加载（同一个节点可能同时有两路：模型树和查看器各一份显示流程） */
const sessions = reactive(new Map<string, Set<SessionState>>());
/**
 * 被叫停、已经收回去的节点 → 还有几位发起方没来问。每位问一次销一笔：同一次显示可能有几位发起方在等
 * （同一个节点又被点了一次，搭的是同一次显示，#166），各自都要问得到。
 */
const withdrawn = new Map<string, number>();

/** 占着这一轮的加载（正在真正执行的那个）；没有为 `null` */
let turnHolder: SessionState | null = null;
/** 排队等轮到的，按点击的先后。有人排队时一定有人占着这一轮 */
const turnQueue: { state: SessionState; settle: (granted: boolean) => void }[] = [];

/** 排队时被叫停（或没等到就结束了）：当场出队，等的那一方得到 `false` */
function leaveTurnQueue(state: SessionState): void {
  const waiter = turnQueue.find((entry) => entry.state === state);
  if (!waiter) return;
  turnQueue.splice(turnQueue.indexOf(waiter), 1);
  state.queued = false;
  waiter.settle(false);
}

/** 占着这一轮的结束了：交给排在最前面的那个（被叫停的当场就出队了，队里剩下的都是还要跑的） */
function passTurn(): void {
  const next = turnQueue.shift();
  turnHolder = next?.state ?? null;
  if (!next) return;
  next.state.queued = false;
  next.settle(true);
}

function addWithdrawnMark(key: string): void {
  withdrawn.set(key, (withdrawn.get(key) ?? 0) + 1);
}

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
  // 还在排队：不等前面的跑完，当场出队
  leaveTurnQueue(state);
}

/**
 * 开始一次加载。`stoppable: false`：轮到之后从头到尾都不能停（重新生成——后端已经在清旧模型）；
 * 排队的时候照样能停。
 */
export function beginModelLoadSession(root: string, options: { stoppable?: boolean } = {}): ModelLoadSession {
  const key = toRefnoKey(root);
  // 新的一次显示开始：这个节点之前没人来问的「收回去了」作废。有的发起方从来不问，留着会让后面的显示被当成收回去了
  withdrawn.delete(key);
  // 放进响应式表里的是代理：之后一律经它读写，行上的转圈才跟着变
  const bucket = sessions.get(key) ?? (sessions.set(key, new Set()), sessions.get(key)!);
  bucket.add({
    stoppable: options.stoppable !== false,
    stopped: false,
    queued: false,
    controller: new AbortController(),
    handlers: new Set(),
  });
  const state = [...bucket].at(-1)!;
  let ended = false;
  let markedWithdrawn = false;
  let waiting: Promise<boolean> | null = null;
  return {
    root: key,
    signal: state.controller.signal,
    get stopped() {
      return state.stopped;
    },
    get withdrawn() {
      return markedWithdrawn;
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
    waitTurn() {
      if (turnHolder === state) return true;
      if (waiting) return waiting;
      // 还没排上就已经被叫停 / 结束了：不占这一轮
      if (state.stopped || ended) return (waiting = Promise.resolve(false));
      if (turnHolder === null) {
        turnHolder = state;
        return true;
      }
      state.queued = true;
      return (waiting = new Promise<boolean>((settle) => { turnQueue.push({ state, settle }); }));
    },
    markWithdrawn() {
      if (markedWithdrawn) return;
      markedWithdrawn = true;
      addWithdrawnMark(key);
    },
    end() {
      if (ended) return;
      ended = true;
      const current = sessions.get(key);
      if (current) {
        current.delete(state);
        if (current.size === 0) sessions.delete(key);
      }
      leaveTurnQueue(state);
      if (turnHolder === state) passTurn();
    },
  };
}

/**
 * 叫停这个节点正在进行的加载。回 `true` = 这一下真的叫停了什么；没有在加载、此刻不能停、已经在停了都回 `false`。
 * 叫停是立刻的：信号当场 abort，之后不再发新请求；已经画出来的由显示流程在它的下一个等待点收回去。
 * 还在排队的（#166）一律能停，当场出队，不等前面的节点跑完。
 */
export function requestStopModelLoad(root: string): boolean {
  const key = toRefnoKey(root);
  const bucket = sessions.get(key);
  if (!bucket) return false;
  let stoppedAny = false;
  for (const state of bucket) {
    if (state.stopped || !(state.stoppable || state.queued)) continue;
    stopSession(state, key);
    stoppedAny = true;
  }
  return stoppedAny;
}

/**
 * 行尾转圈 / 状态条要的东西：这个节点没有在加载回 `null`。响应式。
 * `queued` = 这个节点的加载都还在排队、没有一条轮到（#166）。
 */
export function modelLoadSessionView(root: string): { stoppable: boolean; stopping: boolean; queued: boolean } | null {
  const bucket = sessions.get(toRefnoKey(root));
  if (!bucket || bucket.size === 0) return null;
  let stoppable = false;
  let stopping = false;
  let queued = true;
  for (const state of bucket) {
    if ((state.stoppable || state.queued) && !state.stopped) stoppable = true;
    if (state.stopped) stopping = true;
    if (!state.queued) queued = false;
  }
  return { stoppable, stopping, queued };
}

/**
 * 这个节点的上一次显示是不是被叫停、收回去了（每位发起方问一次销一笔）。发起显示的一方在显示流程回来之后问：
 * 是的话不要再把节点同步成可见、也不要去「显示部分加载的数据」——人已经不要它了。
 */
export function consumeModelLoadStopped(root: string): boolean {
  const key = toRefnoKey(root);
  const left = withdrawn.get(key) ?? 0;
  if (left <= 0) return false;
  if (left === 1) withdrawn.delete(key);
  else withdrawn.set(key, left - 1);
  return true;
}

/**
 * 搭在别人那一次显示上的发起方（同一个节点又被点了一次，#166）：那一次被收回去了，替这一位也记一笔——
 * 它回来之后同样要问得到。
 */
export function noteModelLoadWithdrawn(root: string): void {
  addWithdrawnMark(toRefnoKey(root));
}

export function __resetModelLoadSessionsForTests(): void {
  sessions.clear();
  withdrawn.clear();
  turnHolder = null;
  turnQueue.length = 0;
}
