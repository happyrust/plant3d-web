/**
 * 向后端问节点模型状态（`GET /api/v1/node/model-status`，gen-model 规范 §4.5.3，ADR-099）。
 *
 * 行上的新旧（已加载节点表 → `nodeModelStatus.resolveNodeModelStatus`）和生成预检
 * （显示流程 → `generationFill.planModelGeneration`）都从这里取，两处看到的是同一份事实。
 *
 * 服务端没有这条路由（旧构建：不带信封的 404 / 405）时回 `null`，调用方各自退回过渡办法；并在接下来的五分钟里
 * 不再去问，省得每个节点都白撞一次。别的失败（节点不存在、库文件打不开、网络）照常抛。
 *
 * 这里不缓存回执：新旧会变，后端自己缓存了贵的那部分（子树的生成单元清单、净差分），第二次问是几毫秒。
 * 只有一处合并：节点刚装完时，行上的状态和生成预检几乎同时问同一个节点（第一次问一个大 SITE 后端要现算一两秒），
 * 生成预检搭行上那一问还在路上的便车，不另发一发。反过来不搭——行上的重问（生成完、水位变了之后）要的是此刻的答案。
 */
import type { GenerationUnitFacts } from '@/composables/generationFill';

import { genModelV1NodeModelStatus, isGenModelV1RouteMissing } from '@/api/genModelV1Api';
import { missingUnitsNeedLibraryUpdate, nodeModelFactsOf, type NodeModelFacts } from '@/composables/nodeModelStatus';
import { useGenModelV1Health } from '@/composables/useGenModelV1Health';
import { toRefnoKey } from '@/utils/refnoKey';

/** 认定「服务端没有这条路由」之后多久再试一次（后端可能换了新构建） */
export const NODE_MODEL_STATUS_ROUTE_RECHECK_MS = 5 * 60_000;

let routeMissingUntil = 0;
/** 还在路上的那一问（按节点）：只给生成预检搭便车用 */
const inflight = new Map<string, Promise<NodeModelFacts | null>>();

function request(refno: string): Promise<NodeModelFacts | null> {
  const key = toRefnoKey(refno) || refno;
  const task: Promise<NodeModelFacts | null> = genModelV1NodeModelStatus(refno).then(
    (response) => nodeModelFactsOf(response),
    (error: unknown) => {
      if (!isGenModelV1RouteMissing(error)) throw error;
      routeMissingUntil = Date.now() + NODE_MODEL_STATUS_ROUTE_RECHECK_MS;
      return null;
    },
  ).finally(() => {
    if (inflight.get(key) === task) inflight.delete(key);
  });
  // 没人接的失败不要变成「未处理的拒绝」：真正的调用方各自拿到的是下面包出来的那一个
  task.catch(() => undefined);
  inflight.set(key, task);
  return task;
}

/** 调用方不等了（取消）就立刻放手；那一问本身照常跑完（别人可能搭着它） */
function abandonable<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task;
  const reasonOf = (): unknown => signal.reason ?? new Error('已取消');
  if (signal.aborted) return Promise.reject(reasonOf());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(reasonOf());
    signal.addEventListener('abort', onAbort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** 行上的新旧用：每次都是此刻新发的一问。 */
export function fetchNodeModelFacts(query: { refno: string; signal?: AbortSignal }): Promise<NodeModelFacts | null> {
  if (Date.now() < routeMissingUntil) return Promise.resolve(null);
  return abandonable(request(query.refno), query.signal);
}

/** 节点模型状态里生成预检用得到的那几格 */
export function generationUnitFactsOf(facts: NodeModelFacts): GenerationUnitFacts {
  return {
    unitsTotal: facts.units.total,
    unitsToGenerate: facts.precheck.unitsToGenerate,
    needsConfirm: facts.precheck.needsConfirm,
    thresholdUnits: facts.precheck.thresholdUnits,
    exact: facts.units.exact,
    preferUpdate: missingUnitsNeedLibraryUpdate(facts.library),
  };
}

/** 一个范围的生成预检；服务端没有那个接口回 `null`。同一个节点有一问还在路上时搭它的便车。 */
export async function fetchGenerationFacts(refno: string): Promise<GenerationUnitFacts | null> {
  if (Date.now() < routeMissingUntil) return null;
  const facts = await (inflight.get(toRefnoKey(refno) || refno) ?? request(refno));
  return facts ? generationUnitFactsOf(facts) : null;
}

/**
 * 后端有没有声明「清几何时不再带走别的范围共用的东西」（`/health` 的 `capabilities.mesh_purge_keeps_shared`，
 * gen-model #142 修好的标志）。没声明的（旧构建，或 `/health` 还没取到）一律按没修算：节点一级的更新要走
 * 「先清后生成」时先让人确认（`nodeModelUpdate.decideNodeUpdate`）。
 */
export function backendMeshPurgeKeepsShared(): boolean {
  return useGenModelV1Health().state.capabilities?.mesh_purge_keeps_shared === true;
}

export function __resetNodeModelFactsForTests(): void {
  routeMissingUntil = 0;
  inflight.clear();
}
