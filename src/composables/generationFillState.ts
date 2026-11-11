/**
 * 模型资产补齐（方案 2026-11-10 B3）在页面这一侧的两本小账，模块级、全页面一份（模型树和查看器各有一个
 * `useModelGeneration` 实例，装的是同一个场景）：
 *
 * - **还没补齐的节点**：节点显示出来了，但它下面还有没有模型的部分——人选了「只显示已有的」、后端等到预算用完还没做完、
 *   或中途被叫停。行上据此给一个「生成」按钮接着做（已加载的节点再点眼睛只是恢复可见，不会重新问）。
 *   后端的节点模型状态接口部署之后，这件事由它的「部分生成 / 未生成」判定来说，这本账可以撤。
 * - **正在补齐的节点**：分块生成进行中，行上的「生成」写成「生成中」。
 *
 * 叫停不在这里：分块生成是「显示这个节点」的一段，停它走加载会话（`modelLoadSession.requestStopModelLoad`，2026-11-11）。
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
const activeFills = reactive(new Map<string, { startedAt: number }>());

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

/** 分块生成开始：登记进行中（行上的「生成」据此写「生成中」）。`end` 在结束时调（可重复调）。 */
export function beginGenerationFill(root: string, now: number = Date.now()): { end: () => void } {
  const session = { startedAt: now };
  activeFills.set(root, session);
  return {
    end: () => {
      if (activeFills.get(root)?.startedAt === session.startedAt) activeFills.delete(root);
    },
  };
}

export function isGenerationFillActive(root: string): boolean {
  return activeFills.has(root);
}

export function __resetGenerationFillStateForTests(): void {
  pendingFills.clear();
  activeFills.clear();
}
