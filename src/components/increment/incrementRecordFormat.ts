/**
 * 「增量记录」面板的纯格式化层：把 `/api/v1/tasks` 的一行（`TaskListEntryDto`）
 * 折成界面直接可画的字符串组，不做任何二次推断——与 plant-ui `increment_records.rs`
 * 同一套口径：
 *
 * - 增 / 删 / 改三数只在拿得到时画（老服务端不发这一组，缺省全 0；真零与缺席不可分，
 *   两者都只报总数或不画，绝不把 0/0/0 摆成「无变化」）；
 * - 保存窗口时刻对不齐就整格不画，不回落成 sesno；
 * - 并入清单漏任何一条就只报条数；
 * - `kind=transform`（ADR-066 刚体前移）单独标出来，旧回执缺省是 `regen`。
 */

import type { TaskBatchDto, TaskListEntryDto, TaskOutcomeDto, TaskUnitDto } from '@/api/genModelV1Api';

export type RecordKind = 'data_batch' | 'room_recalc' | 'model_rebuild' | 'model_drain' | 'other';

/** 服务端 `kind` 串 → 账本里的类型名。认不出的串按原样透出，不藏。 */
export function recordKindLabel(kind: string | undefined): { key: RecordKind; label: string } {
  switch (kind) {
    case 'data_batch': return { key: 'data_batch', label: '数据批次' };
    case 'room_recalc': return { key: 'room_recalc', label: '房间重算' };
    case 'model_rebuild': return { key: 'model_rebuild', label: '模型重建' };
    case 'model_drain': return { key: 'model_drain', label: '模型排水' };
    default: return { key: 'other', label: kind || '任务' };
  }
}

export type RecordStateChip = { text: string; tone: 'success' | 'warn' | 'error' | 'neutral' | 'info' };

/** 任务行 `state` → 状态芯片文案与语气。 */
export function recordStateChip(state: string | undefined): RecordStateChip {
  switch (state) {
    case 'succeeded': return { text: '成功', tone: 'success' };
    case 'partial': return { text: '部分成功', tone: 'warn' };
    case 'failed': return { text: '失败', tone: 'error' };
    case 'yielded': return { text: '已让位', tone: 'neutral' };
    case 'queued': return { text: '排队中', tone: 'neutral' };
    case 'running': return { text: '运行中', tone: 'info' };
    default: return { text: state || '未知', tone: 'neutral' };
  }
}

function parseTime(stamp: string | null | undefined): Date | null {
  if (!stamp) return null;
  const at = new Date(stamp);
  return Number.isNaN(at.getTime()) ? null : at;
}

function fmtMdHm(at: Date): string {
  const mm = String(at.getMonth() + 1).padStart(2, '0');
  const dd = String(at.getDate()).padStart(2, '0');
  const hh = String(at.getHours()).padStart(2, '0');
  const mi = String(at.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

function fmtHm(at: Date): string {
  const hh = String(at.getHours()).padStart(2, '0');
  const mi = String(at.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}

/** 保存窗口两端：`MM-DD HH:mm → MM-DD HH:mm`；任一端缺就整格空串（不调 sesno 冒充）。 */
export function saveWindowLabel(entry: TaskListEntryDto): string {
  const start = parseTime(entry.start_sesno_time);
  const end = parseTime(entry.end_sesno_time);
  if (!start || !end) return '';
  return `${fmtMdHm(start)} → ${fmtMdHm(end)}`;
}

/** 会话区间 `647 → 648`；两端都在才画。 */
export function sesnoRangeLabel(entry: TaskListEntryDto): string {
  if (entry.start_sesno == null || entry.end_sesno == null) return '';
  return `会话 ${entry.start_sesno} → ${entry.end_sesno}`;
}

/** 增删改摘要：三数缺席时退回「共 N 项变化」，真零批次整格不画。 */
export function changeSummary(batch: TaskBatchDto | null | undefined): string {
  if (!batch) return '';
  const added = batch.added_elements ?? 0;
  const modified = batch.modified_elements ?? 0;
  const deleted = batch.deleted_elements ?? 0;
  if (added + modified + deleted > 0) return `增 ${added} · 改 ${modified} · 删 ${deleted}`;
  const changed = batch.changed_elements ?? 0;
  return changed > 0 ? `共 ${changed} 项变化` : '';
}

function outcomeOf(entry: TaskListEntryDto): TaskOutcomeDto | null {
  const result = entry.result as TaskOutcomeDto | null | undefined;
  return result && typeof result === 'object' ? result : null;
}

export function batchOf(entry: TaskListEntryDto): TaskBatchDto | null {
  const batch = outcomeOf(entry)?.batch;
  return batch && typeof batch === 'object' ? batch : null;
}

export function unitsOf(entry: TaskListEntryDto): TaskUnitDto[] {
  const units = outcomeOf(entry)?.units;
  return Array.isArray(units) ? units : [];
}

export function warningsOf(entry: TaskListEntryDto): string[] {
  const warnings = outcomeOf(entry)?.warnings;
  return Array.isArray(warnings) ? warnings.filter((w): w is string => typeof w === 'string') : [];
}

/** 被运行中批次吸收的收口（ADR-011 §5）：新标志位与旧 status 两种说法并成一个判读。 */
export function isAbsorbed(entry: TaskListEntryDto): boolean {
  const outcome = outcomeOf(entry);
  return !!outcome && (outcome.absorbed === true || outcome.status === 'absorbed_by_running');
}

/** 并入保存的写入时刻；有任何一条读不到就整列不给（宁报条数不挂半张清单）。 */
export function mergedSavesLabel(batch: TaskBatchDto): string | null {
  const sesnos = batch.merged_sesnos ?? [];
  const times = batch.merged_sesno_times ?? [];
  if (sesnos.length === 0) return null;
  if (times.length !== sesnos.length) return null;
  const parsed = times.map((t) => parseTime(t));
  if (parsed.some((t) => t === null)) return null;
  const list = parsed as Date[];
  const sameDay = list.every((at) => at.toDateString() === list[0]!.toDateString());
  return list.map((at, i) => (sameDay && i > 0 ? fmtHm(at) : fmtMdHm(at))).join(' / ');
}

/** 单元一行的发布方式标注；`transform` 才单独说，缺省/老回执按整根重算不标。 */
export function unitKindLabel(kind: string | undefined): string {
  return kind === 'transform' ? '刚体前移' : '整根重算';
}

/** 刚体前移便宜路交付的根数（只数生成成功的 transform 单元）。 */
export function transformRoots(entry: TaskListEntryDto): number {
  return unitsOf(entry).filter((u) => u.status === 'generated' && u.kind === 'transform').length;
}

export type RoomCountsDto = { panels: number; elements: number; dead_letters: number };

/** 房间轮的 `{panels, elements, dead_letters}`；其它 kind 的这格不是这个形状。 */
export function roomCounts(entry: TaskListEntryDto): RoomCountsDto | null {
  if (entry.kind !== 'room_recalc') return null;
  const detail = entry.detail as Partial<RoomCountsDto> | null | undefined;
  if (!detail || typeof detail !== 'object') return null;
  return {
    panels: detail.panels ?? 0,
    elements: detail.elements ?? 0,
    dead_letters: detail.dead_letters ?? 0,
  };
}

/** `入队 MM-DD HH:mm · 开跑 HH:mm · 耗时 mm:ss`；起不全就不说这句。 */
export function terminalTimes(entry: TaskListEntryDto): string {
  const queued = parseTime(entry.created_at);
  const started = parseTime(entry.started_at);
  if (!queued || !started) return '';
  const parts = [`入队 ${fmtMdHm(queued)}`, `开跑 ${fmtHm(started)}`];
  const finished = parseTime(entry.finished_at);
  if (finished && finished.getTime() >= started.getTime()) {
    parts.push(`耗时 ${clock(finished.getTime() - started.getTime())}`);
  }
  return parts.join(' · ');
}

/** 行尾的耗时：终态用真耗时，在跑的爬到此刻；起点缺席就不摆秒表。 */
export function elapsedLabel(entry: TaskListEntryDto, now: number = Date.now()): string {
  const started = parseTime(entry.started_at);
  if (!started) return '';
  const end = parseTime(entry.finished_at)?.getTime() ?? now;
  const ms = end - started.getTime();
  return ms >= 0 ? clock(ms) : '';
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  if (mm < 60) return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  const hh = Math.floor(mm / 60);
  return `${hh}:${String(mm % 60).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
