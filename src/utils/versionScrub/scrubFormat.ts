import { impactPalette } from './tickLayout';

import type { ScrubVersion, TickCluster } from './tickLayout';
import type { ModelVersionImpactKind } from '@/model-source';

import { impactLabel } from '@/components/model-version/nodeVersionPanelFormat';

/**
 * 版本时间轴的显示文案：悬停提示、游标标签、图例、视口角标（design.md §2.1、§5，Requirement 1.3–1.7、2.7、3.2、3.6、3.11、5.4、9）。
 * 纯函数：无 Vue、无 DOM、无网络。
 *
 * 时间按 RFC3339 字面值格式化（取字符串自带的日期与时分），不换算到本机时区，与 tickLayout.timeLabels 同一做法。
 * 影响类型文字统一走 nodeVersionPanelFormat.impactLabel，图例、悬停与纵向列表同词。
 */

/** 缺字段占位 */
export const MISSING_TEXT = '—';
/** 缺 Session_Time */
export const NO_TIME_TEXT = '无时间';
/** Time_Anomaly_Marker 的文字 */
export const TIME_ANOMALY_TEXT = '时间异常';

/** 只看 sesno 的版本表视图：sesno → 版本 */
export type ScrubVersionIndex = ReadonlyMap<number, ScrubVersion>;
/** 版本表范围：「仅自身」/「所有子节点」 */
export type ScrubScope = 'self' | 'subtree';

/** RFC3339 → `YYYY/MM/DD HH:mm`（字面值，不受本机时区影响）；缺失或解析不了时为 null。 */
export function formatSessionTime(text: string | null | undefined): string | null {
  if (!text) return null;
  if (!Number.isFinite(Date.parse(text))) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(text.trim());
  if (!m) return null;
  return `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}`;
}

/** 游标标签、角标里的时间：格式化后的时间，缺失写「无时间」。 */
export function sessionTimeText(text: string | null | undefined): string {
  return formatSessionTime(text) ?? NO_TIME_TEXT;
}

/** 影响类型文字：缺失写「—」，其余与纵向列表徽章同词。 */
export function impactText(kind: ModelVersionImpactKind | null | undefined): string {
  return kind == null ? MISSING_TEXT : impactLabel(kind);
}

/** 可选文本字段：null / undefined / 空白写「—」，否则原样。 */
function fieldText(value: string | null | undefined): string {
  return value == null || value.trim() === '' ? MISSING_TEXT : value;
}

/** 悬停提示里的 Session_Time：原值，缺失（或解析不了，按无时间处理）写「—」。 */
function hoverTimeText(text: string | null | undefined): string {
  return formatSessionTime(text) === null ? MISSING_TEXT : text!;
}

/**
 * 「所有子节点」范围下的 Changed_Unit 数：只改属性（noop）的会话为 0；缺数时为 null。
 */
export function changedUnitsOf(version: ScrubVersion): number | null {
  if (version.impactKind === 'noop') return 0;
  return typeof version.changedUnits === 'number' && Number.isFinite(version.changedUnits)
    ? version.changedUnits
    : null;
}

function unitsText(version: ScrubVersion): string {
  const n = changedUnitsOf(version);
  return `单元 ${n === null ? MISSING_TEXT : n}`;
}

export type TipLine = { label: string; value: string };
export type ScrubTip = { title: string; lines: TipLine[]; anomaly: boolean; text: string };

function tipOf(title: string, lines: TipLine[], anomaly: boolean): ScrubTip {
  const text = [title, ...lines.map((l) => (l.label ? `${l.label}：${l.value}` : l.value))].join('\n');
  return { title, lines, anomaly, text };
}

/**
 * 单个刻度的悬停提示：sesno、Session_Time（原值）、保存人、备注、影响类型，缺字段写「—」（Requirement 1.5）。
 * 时间异常版本附「前一个带时间版本」的 sesno 与 Session_Time（Requirement 1.3）；
 * 「所有子节点」范围附「单元 n」，只改属性为 0（Requirement 9.1）。
 */
export function tickTip(input: {
  version: ScrubVersion;
  anomalies: ReadonlyMap<number, number>;
  versions: ScrubVersionIndex;
  scope?: ScrubScope;
}): ScrubTip {
  const { version, anomalies, versions } = input;
  const lines: TipLine[] = [
    { label: '时间', value: hoverTimeText(version.sessionTime) },
    { label: '保存人', value: fieldText(version.author) },
    { label: '备注', value: fieldText(version.note) },
    { label: '影响', value: impactText(version.impactKind) },
  ];
  if (input.scope === 'subtree') lines.push({ label: '', value: unitsText(version) });

  const prevSesno = anomalies.get(version.sesno);
  const anomaly = prevSesno !== undefined;
  if (anomaly) {
    const prev = versions.get(prevSesno);
    lines.push({
      label: TIME_ANOMALY_TEXT,
      value: `早于前一个带时间版本 sesno ${prevSesno} · ${hoverTimeText(prev?.sessionTime)}`,
    });
  }
  return tipOf(`sesno ${version.sesno}`, lines, anomaly);
}

/**
 * 簇刻度的悬停提示：刻度数，簇内 sesno 最小与最大版本的 sesno 与 Session_Time（Requirement 1.7）；
 * 簇内有时间异常时注明。
 */
export function clusterTip(cluster: TickCluster, versions: ScrubVersionIndex): ScrubTip {
  const first = Math.min(cluster.first, cluster.last);
  const last = Math.max(cluster.first, cluster.last);
  const lines: TipLine[] = [
    { label: '最早', value: `sesno ${first} · ${hoverTimeText(versions.get(first)?.sessionTime)}` },
    { label: '最晚', value: `sesno ${last} · ${hoverTimeText(versions.get(last)?.sessionTime)}` },
  ];
  if (cluster.anomaly) lines.push({ label: '', value: `含${TIME_ANOMALY_TEXT}版本` });
  return tipOf(`${cluster.sesnos.length} 个版本`, lines, cluster.anomaly);
}

/**
 * 游标标签：`sesno N · 时间`，缺时间写「无时间」，异常追加「时间异常」（Requirement 2.7）；
 * 「所有子节点」范围追加「单元 n」。
 */
export function cursorLabel(input: {
  version: ScrubVersion;
  anomalies: ReadonlyMap<number, number>;
  scope?: ScrubScope;
}): string {
  const { version, anomalies } = input;
  const parts = [`sesno ${version.sesno}`, sessionTimeText(version.sessionTime)];
  if (anomalies.has(version.sesno)) parts.push(TIME_ANOMALY_TEXT);
  if (input.scope === 'subtree') parts.push(unitsText(version));
  return parts.join(' · ');
}

export type LegendItem = { kind: ModelVersionImpactKind; label: string; color: string; hollow: boolean };

/** 图例：版本表中出现的每种 impact_kind 一项，颜色取 impactPalette，文字与纵向列表同词（Requirement 1.4）。 */
export function impactLegend(kinds: readonly ModelVersionImpactKind[]): LegendItem[] {
  return [...impactPalette(kinds)].map(([kind, style]) => ({ kind, label: impactLabel(kind), ...style }));
}

/** 视口角标状态 */
export type BrowseBadgeState =
  /** 已装入 Version_Frame；单钉时带 pin；子树部分失败时带 failedUnits */
  | {
    kind: 'shown'; sesno: number; sessionTime: string | null;
    pin?: { side: 'a' | 'b'; sesno: number } | null;
    failedUnits?: number;
  }
  /** 游标请求进行中（含 HISTORY_BUSY 等待） */
  | { kind: 'loading'; sesno: number }
  /** UNIT_NOT_PRESENT */
  | { kind: 'missing'; sesno: number; reason: 'not-yet' | 'deleted' }
  /** 子树：等待用户在确认对话框中选择 */
  | { kind: 'awaiting-confirm'; sesno: number }
  /** 子树：确认对话框选了「取消」 */
  | { kind: 'cancelled'; sesno: number }
  /** 子树：游标就是范围内最新版本 */
  | { kind: 'latest'; sesno: number };

/**
 * 视口角标文本（Requirement 3.2、3.6、3.11、5.4、9.2、9.6、9.8）。
 */
export function browseBadgeText(state: BrowseBadgeState): string {
  switch (state.kind) {
    case 'shown': {
      const parts = ['浏览', `sesno ${state.sesno}`, sessionTimeText(state.sessionTime)];
      if (state.pin) parts.push(`对照 ${state.pin.side.toUpperCase()}`, `sesno ${state.pin.sesno}`);
      const failed = state.failedUnits ?? 0;
      if (failed > 0) parts.push(`${failed} 个单元加载失败`);
      return parts.join(' · ');
    }
    case 'loading':
      return `正在加载 sesno ${state.sesno}`;
    case 'missing':
      return `浏览 · sesno ${state.sesno} · ${state.reason === 'deleted' ? '该版本单元已删除' : '该版本没有这个单元'}`;
    case 'awaiting-confirm':
      return `浏览 · sesno ${state.sesno} · 等待确认`;
    case 'cancelled':
      return `sesno ${state.sesno} 未加载（已取消）`;
    case 'latest':
      return `浏览 · sesno ${state.sesno} · 最新版本，无历史差异`;
  }
}
