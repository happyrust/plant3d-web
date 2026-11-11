/**
 * 节点一级的「更新到最新」（方案 `docs/plans/2026-11-10-model-load-speed-generate-and-freshness-plan.md` 第 12 节；
 * 用户 2026-11-11 定：按需生成的库里模型落后的节点，现在就加一键更新）。
 *
 * 库一级的「更新到最新」（`useUpdateToLatest`，`update/execute`）只对「有模型水位、在后端更新范围里」的库走得通。
 * 模型按需生成的库（未初始化，模型只在后端内存里）和不在更新范围里的库没有那条路：它们的节点落后时，只能让后端把
 * **这个节点下**的单元按库文件最新会话重新生成，做完把屏幕上的换掉。这里是前一半的纯逻辑：看后端此刻的节点模型
 * 状态，定走哪条路、要不要先问人、怎么分块。不发请求、不碰场景——显示流程（`useModelGeneration`）拿着它去做。
 *
 * 两条路（gen-model 规范 §4.5、§4.5.3）：
 * - `generate`：**不带 `force`** 的 `POST model/generate`。后端逐根核对回执：不是库文件最新会话的重新生成，
 *   已是最新的跳过。规范原话「未初始化的库才对节点发不带 force 的 generate」。它不清几何，所以不踩 gen-model #142。
 * - `regenerate`：**带 `force`**，先清后生成，和右键「重新生成模型」同一条路。只在**有单元被删**时用：不带 force
 *   的生成只重算还在的根，被删单元留在后端投影里的旧回执没人清，`model/records` 按祖先查还会把它们查回来。
 *   先清会踩 #142（把别的构件、别的库共用的模型数据一起删掉），所以后端没有声明
 *   `capabilities.mesh_purge_keeps_shared` 时要先让人确认。
 */
import type { GenerationChunk, GenerationFillSummary, GenerationPlan, ListGenerationChildren } from '@/composables/generationFill';
import type { NodeModelFacts } from '@/composables/nodeModelStatus';

/** 需确认时弹的框。正文是一段话（全局对话框不分行） */
export type NodeUpdateConfirm = {
  /** `purge-risk`：先清后生成、而后端没声明 #142 已修；`scale`：单元多，要占用后端一段时间 */
  kind: 'purge-risk' | 'scale';
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
};

export type NodeUpdateDecision =
  /** 不做：`message` 是要告诉人的话；`recheck` = 行上的状态该重问一次（它已经和后端此刻说的对不上了） */
  | { kind: 'abort'; level: 'info' | 'warning'; message: string; recheck: boolean }
  /** 后端说这个节点已经是最新（别处更新过了）：不用生成，直接按最新记录把屏幕上的换掉 */
  | { kind: 'reload'; message: string }
  | {
    kind: 'generate' | 'regenerate';
    /** 这个节点下的生成单元数（不带 force 时后端逐个核对，已是最新的跳过） */
    unitsTotal: number;
    /** 生成之后被改到的单元数 */
    unitsLagging: number;
    /** 已经被删掉的单元数（> 0 才走 `regenerate`） */
    unitsRemoved: number;
    /** 需确认的阈值（后端给的；0 = 从不要求确认） */
    thresholdUnits: number;
    confirm: NodeUpdateConfirm | null;
  };

/** 这个库有没有库一级的更新可走（有就不该按节点重新生成：后端会把范围里的根整根重算，而且水位不前进） */
function hasLibraryUpdate(facts: NodeModelFacts): boolean {
  return facts.library.inWatchScope && facts.generatedAt?.basis !== 'own_generation';
}

/** 「这个库的模型按需生成」/「这个库不在后端的更新范围里」——为什么只能按节点更新 */
function whyNodeLevel(facts: NodeModelFacts): string {
  return facts.generatedAt?.basis === 'own_generation'
    ? '这个库的模型按需生成'
    : '这个库不在后端的更新范围里（不参与）';
}

/**
 * 点了行上的「更新」（节点一级）之后怎么办。`facts` 是**此刻**重新问到的节点模型状态（不用行上那份旧的）；
 * `null` = 服务端没有那个接口。`purgeKeepsShared`：后端声明了清几何不再带走别人共用的东西（#142 已修）。
 */
export function decideNodeUpdate(input: { facts: NodeModelFacts | null; purgeKeepsShared: boolean }): NodeUpdateDecision {
  const { facts } = input;
  if (!facts) {
    return {
      kind: 'abort',
      level: 'warning',
      message: '后端没有节点模型状态接口（旧构建），不知道这个节点下哪些单元落后，没有更新；右键「重新生成模型」可以换成最新的',
      recheck: false,
    };
  }
  switch (facts.verdict) {
    case 'updating':
      return { kind: 'abort', level: 'info', message: '这个库正在更新，等它做完再看', recheck: true };
    case 'unknown':
      return {
        kind: 'abort',
        level: 'warning',
        message: `后端判不了这个节点的状态${facts.verdictReason ? `（${facts.verdictReason}）` : ''}，没有更新`,
        recheck: true,
      };
    case 'empty':
      return { kind: 'abort', level: 'info', message: '这个节点下没有生成单元，没有要更新的', recheck: true };
    case 'not_generated':
    case 'partial':
      return {
        kind: 'abort',
        level: 'info',
        message: `这个节点现在是「${facts.verdict === 'partial' ? '部分生成' : '未生成'}」（${facts.units.total} 个单元里 `
          + `${facts.units.missing + facts.units.failed} 个没有模型；后端重启过的话，按需生成的模型就不在了），先按行上的按钮补齐`,
        recheck: true,
      };
    case 'latest':
      return { kind: 'reload', message: '后端说这个节点已经是最新（别处更新过了），直接按最新记录换上' };
    default:
      break;
  }
  // lagging
  if (hasLibraryUpdate(facts)) {
    return {
      kind: 'abort',
      level: 'info',
      message: '这个库在后端的更新范围里：落后的节点走库一级的更新，按行上的「更新」来',
      recheck: true,
    };
  }
  const unitsTotal = facts.units.total;
  const unitsLagging = facts.units.lagging;
  const unitsRemoved = facts.changes?.unitsRemoved ?? 0;
  const thresholdUnits = facts.precheck.thresholdUnits;
  const kind = unitsRemoved > 0 ? 'regenerate' : 'generate';
  const large = thresholdUnits > 0 && unitsTotal > thresholdUnits;
  const takesTime = '要占用后端一段时间，状态栏有进度；做完自动换到屏幕上。';
  let confirm: NodeUpdateConfirm | null = null;
  if (kind === 'regenerate' && !input.purgeKeepsShared) {
    confirm = {
      kind: 'purge-risk',
      title: '更新到最新',
      message: `这个节点下有 ${unitsRemoved} 个单元已经被删掉。要把它们的旧模型一起清掉，只能先清后生成（同右键「重新生成模型」）：`
        + `这个节点范围内的模型先清掉，再把 ${unitsTotal} 个单元按库文件最新会话重新生成。`
        + '这个后端版本上，重新生成可能连带删掉别的构件、别的库共用的模型数据（标准图元和支管的管身；不报错，要整库重建才补得回来）。'
        + '确认要继续吗？取消的话模型保持现在的样子，等后端修好之后再点「更新」。',
      confirmText: '知道风险，继续',
      cancelText: '取消',
    };
  } else if (large) {
    confirm = {
      kind: 'scale',
      title: '更新到最新',
      message: kind === 'regenerate'
        ? `这个节点下有 ${unitsRemoved} 个单元已经被删掉，要先清后生成：这个节点范围内的模型先清掉，`
          + `再把 ${unitsTotal} 个单元按库文件最新会话重新生成（中途不能停）。${takesTime}`
        : `${whyNodeLevel(facts)}，只能按节点更新：后端把这个节点下的 ${unitsTotal} 个单元逐个核对，`
          + `不是库文件最新会话的重新生成（已是最新的跳过）。${takesTime}`,
      confirmText: '更新',
      cancelText: '取消',
    };
  }
  return { kind, unitsTotal, unitsLagging, unitsRemoved, thresholdUnits, confirm };
}

/** 不带 force 的那条路按什么分块：SITE 一个 ZONE 一块（一块一块做才有进度、才停得下来），其余节点自己一块 */
const SPLIT_BY_CHILDREN_NOUNS = new Set(['SITE']);

/**
 * 不带 force 的那条路的分块。顶层容器（SITE）按它的成员分：没有子节点的成员没有东西可生成，不进块；成员取不到、
 * 或只有一个时节点自己一块。每块的单元数只是按总数平摊的估计（进度条用，随回执里的实际根数修正）。
 */
export async function planNodeUpdateChunks(input: {
  root: string;
  rootNoun: string | null;
  unitsTotal: number;
  thresholdUnits: number;
  listChildren: ListGenerationChildren;
}): Promise<GenerationPlan> {
  const { root } = input;
  const rootNoun = String(input.rootNoun ?? '').trim().toUpperCase();
  const whole: GenerationChunk[] = [{ refno: root, noun: rootNoun, name: root, units: Math.max(1, input.unitsTotal) }];
  let chunks = whole;
  if (SPLIT_BY_CHILDREN_NOUNS.has(rootNoun)) {
    try {
      const members = (await input.listChildren(root)).filter((node) => node.refno && node.childrenCount !== 0);
      if (members.length > 1) {
        const each = Math.max(1, Math.round(input.unitsTotal / members.length));
        chunks = members.map((node) => ({
          refno: node.refno,
          noun: String(node.noun || 'ZONE').trim().toUpperCase(),
          name: node.name || node.refno,
          units: each,
        }));
      }
    } catch {
      // 成员取不到：节点自己一块
    }
  }
  return {
    root,
    chunks,
    units: chunks.reduce((sum, chunk) => sum + chunk.units, 0),
    // 一块的单元数是平摊的估计
    exact: chunks === whole,
    needsConfirm: false,
    thresholdUnits: input.thresholdUnits,
    skipped: [],
    rootFacts: null,
  };
}

const MAX_FAILED_ROOTS_SHOWN = 5;

/**
 * 不带 force 的那条路做完（或中途停了）之后给人看的一句话。`unitsDone` 是后端核对到的单元数（含已是最新、跳过的）。
 */
export function describeNodeUpdateSummary(summary: GenerationFillSummary): { level: 'success' | 'info' | 'warning'; message: string } {
  const pending = summary.outcomes.filter((outcome) => outcome.state === 'pending');
  const skipped = summary.outcomes.filter((outcome) => outcome.state === 'skipped');
  const failedRoots = summary.outcomes.flatMap((outcome) => outcome.failedRoots.filter((failed) => !failed.retryable));
  const parts: string[] = [`后端已核对 ${summary.unitsDone} 个单元（落后的已重新生成）`];
  if (pending.length > 0) parts.push(`${pending.length} 块后端还没做完，稍后再点「更新」接着做`);
  if (skipped.length > 0) parts.push(`已停止，${skipped.length} 块没有做`);
  if (failedRoots.length > 0) {
    const named = failedRoots.slice(0, MAX_FAILED_ROOTS_SHOWN).map((failed) => `${failed.root}（${failed.error}）`).join('；');
    parts.push(`${failedRoots.length} 个生成根失败：${named}${failedRoots.length > MAX_FAILED_ROOTS_SHOWN ? `；等 ${failedRoots.length} 个` : ''}`);
  }
  const troubled = pending.length > 0 || skipped.length > 0 || failedRoots.length > 0;
  return { level: troubled ? (failedRoots.length > 0 ? 'warning' : 'info') : 'success', message: parts.join('；') };
}
