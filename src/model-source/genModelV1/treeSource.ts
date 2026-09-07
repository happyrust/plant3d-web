/**
 * gen-model-v1 的 `TreeSource`（plan P2-1）：`tree/roots|children|ancestors` + `search` → 现有 `TreeNodeDto` 形状。
 *
 * - **虚拟根**（D4-A）：gen-model 没有单一 WORL，`tree/roots` 是多库多 SITE 平铺；这里合成一个
 *   `gm-root:<project>:<mdb>` 作为唯一根，children = 全部 SITE。id 里故意不含 `/` `,` `<` `>`——
 *   `usePdmsOwnerTree.normalizeRefnoKey` 会把它们改写，含了就对不上。
 * - **refno 归一**：服务端回 `a_b`（节点）或 `a/b`（search / parent），这里统一成本仓内部键 `a_b`。
 * - **祖先链**：服务端「自己在前、向上到库顶（WORL）」，末尾再补虚拟根；现有定位算法从根向下逐层找，
 *   不依赖顺序，也不在乎多出来的 WORL。
 * - **搜索**：服务端只做 NAME 子串；`nouns` 过滤在这里做（靠 P0-2 的 `noun`），不够一页就翻下一页，
 *   扫描上限 `SEARCH_SCAN_CAP`。
 * - **subtreeRefnos / visibleInsts**：见各方法注释；后者就是 D5-A 的「显式显示 = ensure + records」。
 * - 一切 `GenModelV1ApiError` 都折成 `{ success:false, error_message }`——现有调用方按 `success` 分支，
 *   抛错反而会绕开它们的重试 / 提示逻辑。
 */
import { ensureAndCollectRecords, refnosOfRecords, type EnsureAndCollectOptions, type ModelRecordsApi } from './modelRecords';

import type { SubtreeRefnosParams, TreeSource } from '../ports';
import type {
  AncestorsResponse,
  ChildrenResponse,
  NodeResponse,
  SearchRequest,
  SearchResponse,
  SubtreeRefnosResponse,
  TreeNodeDto,
  VisibleInstsResponse,
} from '@/api/genModelE3dTypes';

import {
  fromV1Refno,
  genModelV1Search,
  genModelV1TreeAncestors,
  genModelV1TreeChildren,
  genModelV1TreeRoots,
  isGenModelV1ApiError,
  type EleTreeNodeDto,
  type TreeRootsResponse,
} from '@/api/genModelV1Api';

export const GEN_MODEL_V1_ROOT_PREFIX = 'gm-root:';

/** 单页最多 500（服务端夹紧）；带 noun 过滤时最多扫这么多条就停，免得搜「PIPE」把全库翻完。 */
export const SEARCH_PAGE_SIZE = 500;
export const SEARCH_SCAN_CAP = 2000;

/** `subtreeRefnos` 的 BFS 上限：每次最多请求这么多个节点的 children（一个节点一次请求）。 */
export const SUBTREE_MAX_REQUESTS = 512;

export function makeVirtualRootId(project: string, mdb: string): string {
  const clean = (value: string) => value.trim().replace(/^\/+/, '').replace(/[/,<>⟨⟩\s]+/g, '_');
  return `${GEN_MODEL_V1_ROOT_PREFIX}${clean(project)}:${clean(mdb)}`;
}

export function isVirtualRootId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(GEN_MODEL_V1_ROOT_PREFIX);
}

/** `EleTreeNode`（+ 外包的 `dbnum`）→ 现有树 DTO。名称空时退回 noun（服务端已这么做，这里再兜一次）。 */
export function eleTreeNodeToDto(node: EleTreeNodeDto, parentId?: string | null): TreeNodeDto {
  const noun = (node.noun ?? '').trim();
  const name = (node.name ?? '').trim() || noun;
  return {
    refno: fromV1Refno(node.refno),
    name,
    noun,
    owner: parentId ?? (node.owner ? fromV1Refno(node.owner) : null),
    children_count: typeof node.children_count === 'number' ? node.children_count : null,
    dbnum: typeof node.dbnum === 'number' ? node.dbnum : null,
  };
}

export function virtualRootDto(roots: TreeRootsResponse): TreeNodeDto {
  const mdb = roots.mdb.replace(/^\/+/, '');
  return {
    refno: makeVirtualRootId(roots.project, roots.mdb),
    name: `${roots.project} / ${mdb}`,
    noun: 'WORL',
    owner: null,
    children_count: roots.nodes.length,
    dbnum: null,
  };
}

export type GenModelV1TreeApi = {
  roots: typeof genModelV1TreeRoots;
  children: typeof genModelV1TreeChildren;
  ancestors: typeof genModelV1TreeAncestors;
  search: typeof genModelV1Search;
};

export const defaultGenModelV1TreeApi: GenModelV1TreeApi = {
  roots: genModelV1TreeRoots,
  children: genModelV1TreeChildren,
  ancestors: genModelV1TreeAncestors,
  search: genModelV1Search,
};

export type GenModelV1TreeSourceOptions = {
  api?: GenModelV1TreeApi;
  recordsApi?: ModelRecordsApi;
  /** `tree/roots` 结果复用窗口（`worldRoot()` 紧接着 `children(root)`，不必打两次） */
  rootsCacheMs?: number;
  /** 传给 `visibleInsts` 的 ensure/records 上限 */
  ensureOptions?: Pick<EnsureAndCollectOptions, 'maxContainerDepth' | 'maxRoots' | 'pageSize'>;
  now?: () => number;
};

function errorMessage(error: unknown): string {
  if (isGenModelV1ApiError(error)) return `${error.code}${error.status ? ` (${error.status})` : ''}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

export function createGenModelV1TreeSource(options: GenModelV1TreeSourceOptions = {}): TreeSource {
  const api = options.api ?? defaultGenModelV1TreeApi;
  const recordsApi = options.recordsApi;
  const rootsCacheMs = options.rootsCacheMs ?? 60_000;
  const now = options.now ?? (() => Date.now());

  let rootsCache: { at: number; value: Promise<TreeRootsResponse> } | null = null;

  function loadRoots(): Promise<TreeRootsResponse> {
    const at = now();
    if (rootsCache && at - rootsCache.at < rootsCacheMs) return rootsCache.value;
    const value = api.roots().catch((error: unknown) => {
      // 失败不缓存：下一次调用再打一次
      if (rootsCache?.value === value) rootsCache = null;
      throw error;
    });
    rootsCache = { at, value };
    return value;
  }

  async function worldRoot(): Promise<NodeResponse> {
    try {
      const roots = await loadRoots();
      return { success: true, node: virtualRootDto(roots) };
    } catch (error) {
      return { success: false, node: null, error_message: errorMessage(error) };
    }
  }

  async function children(refno: string, limit?: number): Promise<ChildrenResponse> {
    try {
      let parentId: string;
      let nodes: EleTreeNodeDto[];
      if (isVirtualRootId(refno)) {
        const roots = await loadRoots();
        parentId = makeVirtualRootId(roots.project, roots.mdb);
        nodes = roots.nodes;
      } else {
        parentId = fromV1Refno(refno);
        nodes = (await api.children(parentId)).nodes;
      }
      const truncated = typeof limit === 'number' && limit >= 0 && nodes.length > limit;
      const page = truncated ? nodes.slice(0, limit) : nodes;
      return {
        success: true,
        parent_refno: parentId,
        children: page.map((node) => eleTreeNodeToDto(node, parentId)),
        truncated,
      };
    } catch (error) {
      return { success: false, parent_refno: fromV1Refno(refno), children: [], truncated: false, error_message: errorMessage(error) };
    }
  }

  async function ancestors(refno: string): Promise<AncestorsResponse> {
    if (isVirtualRootId(refno)) return { success: true, refnos: [refno] };
    try {
      const [resp, roots] = await Promise.all([api.ancestors(fromV1Refno(refno)), loadRoots()]);
      const chain = resp.refnos.map((item) => fromV1Refno(String(item))).filter(Boolean);
      const self = fromV1Refno(refno);
      if (!chain.includes(self)) chain.unshift(self);
      chain.push(makeVirtualRootId(roots.project, roots.mdb));
      return { success: true, refnos: chain };
    } catch (error) {
      return { success: false, refnos: [], error_message: errorMessage(error) };
    }
  }

  /**
   * gen-model 没有单节点端点：祖先链的第二项是属主，从属主的 children 里把自己捞出来（两次请求）。
   * 顶层 SITE 的属主是 WORL（`9304_0` 一类），`tree/children` 对 WORL 同样可用。
   */
  async function node(refno: string): Promise<NodeResponse> {
    if (isVirtualRootId(refno)) return worldRoot();
    try {
      const self = fromV1Refno(refno);
      const chain = await api.ancestors(self);
      const owner = chain.refnos.map((item) => fromV1Refno(String(item))).find((item) => item !== self);
      if (!owner) return { success: false, node: null, error_message: `找不到 ${self} 的属主，无法定位节点` };
      const siblings = await api.children(owner);
      const hit = siblings.nodes.find((item) => fromV1Refno(item.refno) === self);
      if (!hit) return { success: false, node: null, error_message: `${owner} 的成员表里没有 ${self}` };
      return { success: true, node: eleTreeNodeToDto(hit, owner) };
    } catch (error) {
      return { success: false, node: null, error_message: errorMessage(error) };
    }
  }

  async function search(req: SearchRequest): Promise<SearchResponse> {
    const keyword = (req.keyword ?? '').trim();
    if (!keyword) return { success: true, items: [] };
    const wanted = new Set((req.nouns ?? []).map((noun) => noun.trim().toUpperCase()).filter(Boolean));
    const limit = typeof req.limit === 'number' && req.limit > 0 ? req.limit : 50;
    const pageSize = Math.min(SEARCH_PAGE_SIZE, Math.max(limit, 100));
    const items: TreeNodeDto[] = [];
    try {
      let cursor: number | undefined;
      let scanned = 0;
      for (let page = 0; page < 64 && items.length < limit && scanned < SEARCH_SCAN_CAP; page++) {
        const resp = await api.search({ query: keyword, limit: pageSize, cursor });
        scanned += resp.items.length;
        for (const item of resp.items) {
          const noun = (item.noun ?? '').trim().toUpperCase();
          if (wanted.size > 0 && !wanted.has(noun)) continue;
          items.push({
            refno: fromV1Refno(item.refno),
            name: item.name,
            noun,
            owner: null,
            children_count: null,
            dbnum: typeof item.dbnum === 'number' ? item.dbnum : null,
          });
          if (items.length >= limit) break;
        }
        if (!resp.truncated || resp.next_cursor === null || resp.next_cursor === undefined) break;
        cursor = resp.next_cursor;
      }
      return { success: true, items };
    } catch (error) {
      return { success: false, items, error_message: errorMessage(error) };
    }
  }

  /**
   * 纯树遍历的子树 refno 集：BFS `tree/children`，一个节点一次请求，上限 `SUBTREE_MAX_REQUESTS`。
   * 大容器（整 SITE）会撞上限并置 `truncated`——那是「有几何的构件集」该走 `visibleInsts` 的场景（plan §3）。
   * 虚拟根不展开（那等于整个 MDB）。
   */
  async function subtreeRefnos(refno: string, params?: SubtreeRefnosParams): Promise<SubtreeRefnosResponse> {
    if (isVirtualRootId(refno)) {
      return { success: false, refnos: [], truncated: true, error_message: '虚拟根不支持子树遍历：请按 SITE 操作' };
    }
    const root = fromV1Refno(refno);
    const includeSelf = params?.includeSelf ?? true;
    const maxDepth = params?.maxDepth ?? 256;
    const limit = params?.limit ?? 200_000;
    const out: string[] = includeSelf ? [root] : [];
    const seen = new Set<string>([root]);
    const queue: { refno: string; depth: number }[] = [{ refno: root, depth: 0 }];
    let requests = 0;
    let truncated = false;
    try {
      while (queue.length > 0) {
        if (out.length >= limit || requests >= SUBTREE_MAX_REQUESTS) {
          truncated = true;
          break;
        }
        const { refno: current, depth } = queue.shift()!;
        if (depth >= maxDepth) {
          truncated = true;
          continue;
        }
        requests++;
        const resp = await api.children(current);
        for (const child of resp.nodes) {
          const key = fromV1Refno(child.refno);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          out.push(key);
          if (out.length >= limit) {
            truncated = true;
            break;
          }
          if ((child.children_count ?? 0) > 0) queue.push({ refno: key, depth: depth + 1 });
        }
      }
      return { success: true, refnos: out, truncated };
    } catch (error) {
      return { success: false, refnos: out, truncated: true, error_message: errorMessage(error) };
    }
  }

  /**
   * 「有几何的构件 refno 集」= 显式显示语义（D5-A）：ensure(force=false) → records → 构件 refno 去重。
   * 虚拟根拒绝（整 MDB 的 ensure 不是一次点击该做的事，P3-c 的 `show_dbnum` 分批走别的入口）。
   */
  async function visibleInsts(refno: string): Promise<VisibleInstsResponse> {
    const key = fromV1Refno(refno);
    if (isVirtualRootId(refno)) {
      return { success: false, refno, refnos: [], error_message: '虚拟根不支持整体显示：请按 SITE / ZONE 操作' };
    }
    try {
      const result = await ensureAndCollectRecords(key, { ...options.ensureOptions }, recordsApi);
      const refnos = refnosOfRecords(result.items);
      const failed = Object.keys(result.errors);
      if (refnos.length === 0 && failed.length > 0 && result.generationRoots.length === 0) {
        return {
          success: false,
          refno: key,
          refnos: [],
          error_message: failed.map((root) => `${root}: ${result.errors[root]}`).join('; '),
        };
      }
      return {
        success: true,
        refno: key,
        refnos,
        debug: {
          candidates_count: result.items.length,
          filtered_count: result.pending.length + result.truncatedRoots.length + failed.length,
          visible_count: refnos.length,
          source: `gen-model-v1 roots=${result.generationRoots.length} pending=${result.pending.length} empty=${result.empty.length} truncated=${result.truncatedRoots.length}`,
        },
      };
    } catch (error) {
      return { success: false, refno: key, refnos: [], error_message: errorMessage(error) };
    }
  }

  return { worldRoot, node, children, ancestors, search, subtreeRefnos, visibleInsts };
}
