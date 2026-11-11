/**
 * 一个库的模型「新不新」的统一判定（方案 `docs/plans/2026-11-10-model-load-speed-generate-and-freshness-plan.md` C1）。
 *
 * 模型树的库状态圆点（`useGenModelV1DbnumStatus`）和「模型生成」面板的状态徽标（`useModelGenerationAdmin`）只认这一个
 * 函数。此前两处各判各的：圆点只看后端的 `model_verdict`（模型对**已入库数据**是否一致），面板比三枚水位——库文件已经有
 * 新会话、数据还没入库的库，圆点说「最新」，面板说「待更新」。
 *
 * 口径（2026-11-10 用户定）：库一级按**库文件最新会话**判。三枚水位都在 `/dbnums` 那一行上：
 * `file_latest_sesno`（库文件最新会话）、`applied_sesno`（数据入库到哪个会话）、`model_sesno`（模型按哪个会话生成）。
 *
 * 库一级只说得出「库文件有新会话」，说不出「某个 SITE / ZONE 的模型受不受影响」——E3D 每次登录都会让库多一个会话，
 * 多数新会话没有改到几何。所以 `file_ahead` 的措辞是中性的；节点一级的答案是另一件事（方案 C2）。
 */
import type { DbnumRow } from '@/api/genModelV1Api';

/**
 * - `latest`：三枚水位对齐；
 * - `file_ahead`：模型与已入库数据一致，但库文件还有新会话没入库；
 * - `model_behind`：模型落后于已入库数据（后端判 `lagging`，或模型水位小于数据水位）；
 * - `updating`：库正在被写（数据批次在跑 / 上一次写库还没收尾）；
 * - `uninitialized` / `awaiting`：数据水位没立过（后者是后端发现了、等人工初始化）；
 * - `blocked` / `excluded`：阻断 / 不参与（排除或不在本项目）；
 * - `unknown`：判不了（缺模型水位又没有后端判决，或模型水位反超数据水位）。
 */
export type DbnumFreshnessKind =
  | 'latest'
  | 'file_ahead'
  | 'model_behind'
  | 'updating'
  | 'uninitialized'
  | 'awaiting'
  | 'blocked'
  | 'excluded'
  | 'unknown';

export type DbnumFreshness = {
  kind: DbnumFreshnessKind;
  /** 三枚水位；这一行没带那一格就是 `null` */
  fileLatest: number | null;
  applied: number | null;
  model: number | null;
  /** 库文件最新会话比已入库数据多出几个会话（没有、或判不了时是 0） */
  sessionsNotApplied: number;
  /** 模型落后于已入库数据 */
  modelBehindData: boolean;
  /** 模型水位那个会话在 E3D 里的保存时刻（后端原样给的时间串）；没给就是 `null` */
  modelSavedAt: string | null;
  /** 这个库立没立过数据水位 */
  initialized: boolean;
};

function sesnoOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 库正在被写。全量行（带身份参数的 `/dbnums`）看 `write_state.status`——后端的取值是 `writing` / `finished`
 * （gen-model `src/data_interface/write_state.rs`；`running` 是这边早先的写法，一并认）；轻量行不带 `write_state`，
 * 看 `model_source_reason = initialization_publishing`（「这个库的数据批次任务在跑」）。
 */
function isBeingWritten(row: DbnumRow): boolean {
  const status = String(row.write_state?.status ?? '').toLowerCase();
  if (status === 'writing' || status === 'running') return true;
  return String(row.model_source_reason ?? '') === 'initialization_publishing';
}

export function judgeDbnumFreshness(row: DbnumRow): DbnumFreshness {
  const fileLatest = sesnoOf(row.file_latest_sesno);
  const applied = sesnoOf(row.applied_sesno);
  const model = sesnoOf(row.model_sesno);
  const modelSavedAt = typeof row.model_sesno_time === 'string' && row.model_sesno_time ? row.model_sesno_time : null;
  const initialized = typeof row.initialized === 'boolean' ? row.initialized : (applied ?? 0) > 0;
  const sessionsNotApplied = initialized ? Math.max(0, (fileLatest ?? 0) - (applied ?? 0)) : 0;
  const facts = { fileLatest, applied, model, sessionsNotApplied, modelBehindData: false, modelSavedAt, initialized };

  if (row.excluded || row.not_in_project) return { ...facts, kind: 'excluded' };
  if (row.blocked) return { ...facts, kind: 'blocked' };
  if (isBeingWritten(row)) return { ...facts, kind: 'updating' };
  if (!initialized) return { ...facts, kind: row.awaiting_manual_initialization ? 'awaiting' : 'uninitialized' };

  const dbType = String(row.db_type ?? '').toUpperCase();
  const verdict = String(row.model_verdict ?? '').toLowerCase();
  // 只有 DESI 库生成模型；行上没写库类型（稀疏行）但带着模型那几格的，照有模型的库判
  const hasModel = dbType === 'DESI' || (dbType === '' && (verdict !== '' || model !== null));
  if (!hasModel) return { ...facts, kind: sessionsNotApplied > 0 ? 'file_ahead' : 'latest' };

  // 后端的 `model_verdict` 是模型对数据的唯一判决（`in_sync` 还要求没有根在追），表态了就用；没表态才自己比水位
  if (verdict === 'lagging') return { ...facts, modelBehindData: true, kind: 'model_behind' };
  if (verdict !== 'in_sync') {
    if (model === null || applied === null || model > applied) return { ...facts, kind: 'unknown' };
    if (model < applied) return { ...facts, modelBehindData: true, kind: 'model_behind' };
  }
  return { ...facts, kind: sessionsNotApplied > 0 ? 'file_ahead' : 'latest' };
}

export type DbnumFreshnessText = {
  /** 一句话结论 */
  headline: string;
  /** 补充说明；没有就是空串 */
  detail: string;
  /** 三枚水位那一行；一个水位都说不出就是空串 */
  watermarks: string;
};

/** 后端给的保存时刻 → `YYYY-MM-DD HH:mm`（浏览器本地时区，与增量记录面板同一读法）；解析不了回 `null`。 */
function formatSavedAt(stamp: string | null): string | null {
  if (!stamp) return null;
  const at = new Date(stamp);
  if (Number.isNaN(at.getTime())) return null;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function watermarksLine(freshness: DbnumFreshness): string {
  const parts: string[] = [];
  // 没初始化的库模型 / 数据水位是 0：那不是「按会话 0 生成」，不写
  if (freshness.initialized) {
    if (freshness.model !== null) {
      const savedAt = formatSavedAt(freshness.modelSavedAt);
      parts.push(savedAt ? `模型 ${freshness.model}（${savedAt} 保存）` : `模型 ${freshness.model}`);
    }
    if (freshness.applied !== null) parts.push(`数据 ${freshness.applied}`);
  }
  if (freshness.fileLatest !== null) parts.push(`库文件最新 ${freshness.fileLatest}`);
  return parts.join(' · ');
}

/** 判定结果 → 界面上的说法。圆点的提示文字和面板徽标的提示文字都从这里出，免得两处各写一套。 */
export function describeDbnumFreshness(freshness: DbnumFreshness): DbnumFreshnessText {
  const watermarks = watermarksLine(freshness);
  const pendingSessions = freshness.sessionsNotApplied > 0 ? `库文件还有 ${freshness.sessionsNotApplied} 个新会话未入库` : '';
  switch (freshness.kind) {
    case 'latest':
      return { headline: '模型已是最新', detail: '', watermarks };
    case 'file_ahead':
      return {
        headline: `库有 ${freshness.sessionsNotApplied} 个新会话未更新`,
        detail: '有新会话，尚未核对是否影响模型（只登录不修改也会多一个会话）',
        watermarks,
      };
    case 'model_behind':
      return { headline: '模型落后于已入库数据', detail: pendingSessions, watermarks };
    case 'updating':
      return { headline: '库正在更新', detail: '数据批次在写库，写完再看', watermarks };
    case 'uninitialized':
      return { headline: '库未初始化，模型按需生成', detail: '', watermarks };
    case 'awaiting':
      return { headline: '库未初始化，等人工初始化', detail: '', watermarks };
    // 阻断 / 不参与的库不会被更新，但库文件照样在长：有几个新会话没入库照写出来（数据有就写，没有就不写），
    // 免得面板写「不参与」、别处却按水位说「有 N 个新会话」，两边对不上（2026-11-11）
    case 'blocked':
      return { headline: '库被阻断', detail: pendingSessions, watermarks };
    case 'excluded':
      return { headline: '库不参与（已排除或不在本项目）', detail: pendingSessions, watermarks };
    default:
      return {
        headline: '模型状态未判定',
        detail: freshness.model !== null && freshness.applied !== null && freshness.model > freshness.applied
          ? '模型水位超过了数据水位'
          : '后端没有给出模型判决',
        watermarks,
      };
  }
}
