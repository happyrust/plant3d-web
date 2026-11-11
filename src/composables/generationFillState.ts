/**
 * 模型资产补齐（方案 2026-11-10 B3）在页面这一侧的两本小账，模块级、全页面一份（模型树和查看器各有一个
 * `useModelGeneration` 实例，装的是同一个场景）：
 *
 * - **还没补齐的节点**：节点显示出来了，但它下面还有没有模型的部分——人选了「只显示已有的」、后端等到预算用完还没做完、
 *   或中途被叫停。行上据此给一个「生成」按钮接着做（已加载的节点再点眼睛只是恢复可见，不会重新问）。
 *   后端的节点模型状态接口部署之后，这件事由它的「部分生成 / 未生成」判定来说，这本账可以撤。
 * - **正在补齐的节点**：分块生成进行中。`requestStopGenerationFill` 是「加载中点一下停」的口子——这一轮界面上
 *   没有接按钮（要不要做还在问用户），分块生成在块与块之间、每次自动再问之前看这个标记。
 */
import { reactive } from 'vue';

export type PendingGenerationFill = {
  root: string;
  dbnum: number;
  /** 还有几块没有模型、约多少个单元 */
  chunks: number;
  units: number;
  /** 沿树数出来的估计给 `false` */
  exact: boolean;
  /** 为什么还没补齐 */
  reason: 'declined' | 'pending' | 'stopped';
  notedAt: number;
};

const pendingFills = reactive(new Map<string, PendingGenerationFill>());
const activeFills = reactive(new Map<string, { stopRequested: boolean; startedAt: number }>());

export function notePendingGenerationFill(fill: Omit<PendingGenerationFill, 'notedAt'>, now: number = Date.now()): void {
  pendingFills.set(fill.root, { ...fill, notedAt: now });
}

export function clearPendingGenerationFill(root: string): void {
  pendingFills.delete(root);
}

export function pendingGenerationFill(root: string): PendingGenerationFill | null {
  return pendingFills.get(root) ?? null;
}

const REASON_TEXT: Record<PendingGenerationFill['reason'], string> = {
  // 确认框里选了「只显示已有的」或「取消」
  declined: '上次选了先不生成',
  pending: '后端上次没做完',
  stopped: '上次中途停了',
};

/** 行上「生成」按钮要的东西；这个节点没有待补齐的部分回 `null`。 */
export function pendingGenerationFillView(root: string): { busy: boolean; label: string; title: string } | null {
  const fill = pendingFills.get(root);
  if (!fill) return null;
  const busy = activeFills.has(root);
  const units = `${fill.exact ? ' ' : '约 '}${fill.units} 个单元`;
  const where = fill.chunks > 1 ? `（分在 ${fill.chunks} 块里）` : '';
  return {
    busy,
    label: busy ? '生成中' : '生成',
    title: busy
      ? '正在生成这个节点下还没有模型的部分，进度在查看器左下角的状态栏'
      : `这个节点下还有${units}没有模型${where}，${REASON_TEXT[fill.reason]}。点「生成」补齐：不重算已有的，做完一块显示一块`,
  };
}

/** 分块生成开始：登记进行中。回的 `shouldStop` 给分块执行问「还要不要继续」，`end` 在结束时调（可重复调）。 */
export function beginGenerationFill(root: string, now: number = Date.now()): { shouldStop: () => boolean; end: () => void } {
  const session = { stopRequested: false, startedAt: now };
  activeFills.set(root, session);
  return {
    shouldStop: () => activeFills.get(root)?.stopRequested === true,
    end: () => {
      if (activeFills.get(root)?.startedAt === session.startedAt) activeFills.delete(root);
    },
  };
}

export function isGenerationFillActive(root: string): boolean {
  return activeFills.has(root);
}

/**
 * 叫停一个节点正在进行的分块生成：已经发出去的那一块后端照常算完（后端不取消），之后的块不再发，已经显示的留着。
 * 没有在进行的回 `false`。
 */
export function requestStopGenerationFill(root: string): boolean {
  const session = activeFills.get(root);
  if (!session) return false;
  session.stopRequested = true;
  return true;
}

/** 分块生成因为「节点被隐藏了」而停下的节点：显示动作收尾时不该再把它置回可见 */
const withdrawnFills = new Set<string>();

/** 分块生成到一半，这个节点被人隐藏了（显示意图撤回）。 */
export function noteGenerationFillWithdrawn(root: string): void {
  withdrawnFills.add(root);
}

/**
 * 这一次显示是不是中途被撤回了（问一次就清掉）。发起显示的一方（模型树的眼睛）在收尾时问：
 * 撤回了就不要再把节点同步成可见——人已经把它隐藏了。
 */
export function consumeGenerationFillWithdrawn(root: string): boolean {
  return withdrawnFills.delete(root);
}

export function __resetGenerationFillStateForTests(): void {
  pendingFills.clear();
  activeFills.clear();
  withdrawnFills.clear();
}
