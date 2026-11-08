/**
 * 分组契约（分组计划 §2；§6「契约三仓各写各的，字段漂移」的对策）：前端解析分组回执的 DTO 去找的每个键都得在
 * gen-model 的响应快照里——不在，就是后端改了名或删了，这边静默读成 `undefined`。前端不读的字段不管。
 *
 * gen-model 一侧的字段名照抄自 `gen-model/tests/fixtures/group-contract/` 下的
 * `tree-children-resolved-gpset.json`、`tree-ancestors-secondary-parents.json`、`model-generate-gpset.json`、
 * `model-records-gpset.json`（不跨仓读文件）。gen-model 改了回执字段会连基准一起重写，这里的清单跟着改。
 * DTO 一侧的键由 type-check 钉在类型上：DTO 增删一格而这里没跟，type-check 报错。
 */
import { describe, expect, it } from 'vitest';

import type {
  EleTreeNodeDto,
  GeomInst,
  GeomInstQuery,
  ModelGenerateResponse,
  ModelRecordsResponse,
  TreeAncestorsResponse,
  TreeChildrenResponse,
  TreeSecondaryParent,
  TreeUnresolvedSlot,
  V1Aabb,
  V1Transform,
} from './genModelV1Api';

const GEN_MODEL = {
  children: ['source', 'parent', 'view', 'nodes', 'unresolved'],
  childrenNode: [
    'refno', 'noun', 'name', 'owner', 'order', 'children_count', 'op', 'mod_cnt', 'children_updated', 'status_code',
    'dbnum', 'via', 'secondary', 'rule',
  ],
  childrenUnresolved: ['via', 'target', 'reason'],
  ancestors: ['source', 'refnos', 'secondary_parents'],
  ancestorsSecondaryParent: ['member', 'group', 'group_noun', 'group_name', 'via'],
  generate: [
    'requested_refno', 'generation_root', 'generation_root_noun', 'status', 'model_available', 'model_instance_count',
    'generated_instance_count', 'generation_root_count', 'generation_roots', 'cached_root_count', 'generated_root_count',
    'failed_root_count', 'failed_roots', 'dbnum', 'model_source', 'model_source_reason', 'durable', 'scope_kind',
    'scope_refnos', 'unresolved_count', 'routes', 'publication_status',
  ],
  records: [
    'source', 'dbnum', 'model_source', 'model_source_reason', 'durable', 'complete', 'incomplete_roots',
    'durable_fallback_roots', 'snapshot_epoch', 'session_vector', 'items', 'total', 'truncated', 'next_cursor',
    'generation_root', 'expanded_from_group', 'scope_refnos', 'unresolved_count', 'routes',
  ],
  recordsItem: ['refno', 'old_refno', 'owner', 'world_aabb', 'world_trans', 'insts', 'has_neg', 'generic', 'pts', 'date'],
  recordsInst: ['geo_hash', 'transform', 'is_tubi', 'is_invalid_tubi'],
  recordsTransform: ['translation', 'rotation', 'scale'],
  recordsAabb: ['mins', 'maxs'],
} as const satisfies Record<string, readonly string[]>;

type Part = keyof typeof GEN_MODEL;

/** 具名键；`ModelGenerateResponse` 的 `[key: string]: unknown` 不算。 */
type NamedKeys<T> = keyof { [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K] };
/** DTO 的每个具名键各占一格：少一格、多一格 type-check 都报错。 */
type KeysOf<T> = Record<NamedKeys<T>, true>;

const FRONTEND_READS = {
  children: { source: true, parent: true, view: true, nodes: true, unresolved: true } satisfies KeysOf<TreeChildrenResponse>,
  childrenNode: {
    refno: true, noun: true, name: true, owner: true, order: true, children_count: true, dbnum: true, short_name: true,
    stored_name: true, via: true, secondary: true, rule: true, op: true, mod_cnt: true, children_updated: true,
    status_code: true,
  } satisfies KeysOf<EleTreeNodeDto>,
  childrenUnresolved: { via: true, target: true, reason: true } satisfies KeysOf<TreeUnresolvedSlot>,
  ancestors: { source: true, refnos: true, secondary_parents: true } satisfies KeysOf<TreeAncestorsResponse>,
  ancestorsSecondaryParent: {
    member: true, group: true, group_noun: true, group_name: true, via: true,
  } satisfies KeysOf<TreeSecondaryParent>,
  generate: {
    status: true, generation_root: true, generation_roots: true, scope_kind: true, unresolved_count: true,
    model_available: true, model_instance_count: true, generated_instance_count: true, snapshot_epoch: true,
    publication_status: true,
  } satisfies KeysOf<ModelGenerateResponse>,
  records: {
    source: true, items: true, total: true, truncated: true, next_cursor: true, snapshot_epoch: true,
    session_vector: true, generation_root: true, generation_roots: true, roots: true, expanded_from_group: true,
    scope_refnos: true, unresolved_count: true,
  } satisfies KeysOf<ModelRecordsResponse>,
  recordsItem: {
    refno: true, old_refno: true, owner: true, world_aabb: true, world_trans: true, insts: true, has_neg: true,
    generic: true, pts: true, date: true, tube: true,
  } satisfies KeysOf<GeomInstQuery>,
  recordsInst: { geo_hash: true, transform: true, is_tubi: true, is_invalid_tubi: true } satisfies KeysOf<GeomInst>,
  recordsTransform: { translation: true, rotation: true, scale: true } satisfies KeysOf<V1Transform>,
  recordsAabb: { mins: true, maxs: true } satisfies KeysOf<V1Aabb>,
} satisfies Record<Part, Record<string, true>>;

/** 前端读、gen-model 的快照里却没有的键，各注一句为什么。 */
const NOT_IN_SNAPSHOT: Partial<Record<Part, Record<string, string>>> = {
  childrenNode: {
    short_name: 'gen-model 这一版的树节点不发（old-aios-core 的 EleTreeNode 没有这一格），按老服务端处理',
    stored_name: 'gen-model 这一版的树节点不发（同 short_name）',
  },
  generate: {
    snapshot_epoch: 'read-through 形态下 handler 在拼好的回执上追加，快照只钉拼装那一段',
  },
  records: {
    generation_roots: '批量请求才回显，分组快照是单根请求',
    roots: '批量请求才回，分组快照是单根请求',
  },
  recordsItem: {
    tube: '只有隐式管身（generic = TUBI）的记录带，快照里的成员没有直段',
  },
};

describe('分组契约：前端 DTO 的字段名', () => {
  it('前端去分组回执里找的键都在 gen-model 的快照里', () => {
    const stray: Record<string, string[]> = {};
    const stale: Record<string, string[]> = {};
    for (const part of Object.keys(GEN_MODEL) as Part[]) {
      const sent: readonly string[] = GEN_MODEL[part];
      const reads = Object.keys(FRONTEND_READS[part]);
      const absent = NOT_IN_SNAPSHOT[part] ?? {};
      const unknown = reads.filter((key) => !sent.includes(key) && !(key in absent));
      if (unknown.length > 0) stray[part] = unknown;
      const outdated = Object.keys(absent).filter((key) => sent.includes(key) || !reads.includes(key));
      if (outdated.length > 0) stale[part] = outdated;
    }
    expect(stray, '前端读的这些键不在 gen-model 的快照里').toEqual({});
    expect(stale, 'gen-model 已经发了、或前端已经不读的键，从 NOT_IN_SNAPSHOT 里拿掉').toEqual({});
  });
});
