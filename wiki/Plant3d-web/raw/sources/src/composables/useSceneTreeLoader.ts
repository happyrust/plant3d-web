/**
 * Scene Tree 加载器
 * 
 * 优先从 SurrealDB 加载模型树结构数据
 * 备选方案：从 scene_tree_{dbno}.parquet 加载
 */

import { ref, shallowRef } from 'vue';

import type * as duckdb from '@duckdb/duckdb-wasm';

// DuckDB 实例单例（与 useParquetModelLoader 共享）
let duckDbInstance: duckdb.AsyncDuckDB | null = null;

/**
 * 数据源类型
 */
export type DataSource = 'surrealdb' | 'parquet' | null

/**
 * Scene Tree 节点（从数据库或 Parquet 读取）
 */
export type SceneTreeRow = {
    id: number | string   // refno 编码 (i64) 或字符串
    parent: number | string | null
    name: string
    has_geo: boolean
    is_leaf: boolean
    generated: boolean
    dbno: number
    geo_type: string | null
}

/**
 * 前端使用的树节点结构
 */
export type SceneTreeNode = {
    id: string              // refno 字符串格式 (如 "17496_106028")
    parentId: string | null
    name: string
    hasGeo: boolean
    isLeaf: boolean
    generated: boolean
    geoType: string | null
    childrenIds: string[]   // 子节点 ID 列表
}

/**
 * 加载状态
 */
export type SceneTreeLoadingState = {
    loading: boolean
    error: string | null
    nodeCount: number
    dataSource: DataSource
}

/**
 * 将 i64 编码的 refno 转换为字符串格式
 * 例如: 17496 << 32 | 106028 -> "17496_106028"
 */
function decodeRefno(encoded: number): string {
  const bigVal = BigInt(encoded);
  const shift32 = BigInt(32);
  const mask32 = BigInt(0xFFFFFFFF);
  const dbno = Number(bigVal >> shift32);
  const seqno = Number(bigVal & mask32);
  return `${dbno}_${seqno}`;
}

/**
 * 规范化 refno：确保是 "dbno_seqno" 格式
 */
function normalizeRefno(id: number | string): string {
  if (typeof id === 'number') {
    return decodeRefno(id);
  }
  // 已经是字符串格式
  return String(id).replace('/', '_');
}

/**
 * 初始化 DuckDB 实例
 */
async function ensureDuckDB(): Promise<duckdb.AsyncDuckDB> {
  if (duckDbInstance) {
    return duckDbInstance;
  }

  const duckdb = await import('@duckdb/duckdb-wasm');
  const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
  const worker_url = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
  );
  const worker = new Worker(worker_url);
  const logger = new duckdb.ConsoleLogger();
  duckDbInstance = new duckdb.AsyncDuckDB(logger, worker);
  await duckDbInstance.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(worker_url);

  return duckDbInstance;
}

/**
 * Scene Tree 加载器
 * 
 * 优先使用 SurrealDB，失败时回退到 Parquet
 */
export function useSceneTreeLoader() {
  const loadingState = ref<SceneTreeLoadingState>({
    loading: false,
    error: null,
    nodeCount: 0,
    dataSource: null,
  });

  // 节点映射表
  const nodesById = shallowRef<Map<string, SceneTreeNode>>(new Map());
  // 根节点 ID 列表
  const rootIds = ref<string[]>([]);

  /**
     * 从 SurrealDB 加载 scene_node 数据
     */
  async function loadFromSurrealDB(dbno: number): Promise<SceneTreeRow[] | null> {
    try {
      console.log('[SceneTreeLoader] Trying SurrealDB...');

      // 查询 scene_node 表
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `SELECT *, fn::default_name(type::thing('pe', record::id(id))) ?? '' as name FROM scene_node WHERE dbnum = ${dbno}`
        })
      });

      if (!response.ok) {
        console.warn('[SceneTreeLoader] SurrealDB query failed:', response.status);
        return null;
      }

      const result = await response.json();

      // 解析结果
      if (!result || !Array.isArray(result) || result.length === 0) {
        console.warn('[SceneTreeLoader] SurrealDB returned empty result');
        return null;
      }

      // 提取第一个结果集
      const rows = Array.isArray(result[0]) ? result[0] : result;

      if (rows.length === 0) {
        console.warn('[SceneTreeLoader] No scene_node data found for dbno:', dbno);
        return null;
      }

      console.log(`[SceneTreeLoader] SurrealDB returned ${rows.length} nodes`);

      return rows.map((row: Record<string, unknown>) => {
        const idRaw = row.refno ?? row.id;
        const parentRaw = row.parent;
        const id: number | string =
                    typeof idRaw === 'number' || typeof idRaw === 'string' ? idRaw : String(idRaw ?? '');
        const parent: number | string | null =
                    parentRaw == null
                      ? null
                      : (typeof parentRaw === 'number' || typeof parentRaw === 'string'
                        ? parentRaw
                        : String(parentRaw));

        return {
          id,
          parent,
          name: String(row.name ?? ''),
          has_geo: Boolean(row.has_geo),
          is_leaf: Boolean(row.is_leaf),
          generated: Boolean(row.generated),
          dbno: Number(row.dbno ?? dbno),
          geo_type: row.geo_type ? String(row.geo_type) : null,
        };
      });

    } catch (error) {
      console.warn('[SceneTreeLoader] SurrealDB error:', error);
      return null;
    }
  }

  /**
     * 从 Parquet 文件加载 scene_tree 数据
     */
  async function loadFromParquet(dbno: number): Promise<SceneTreeRow[] | null> {
    try {
      console.log('[SceneTreeLoader] Trying Parquet fallback...');

      const baseUrl = '/files/output/database_models';
      const filename = `scene_tree_${dbno}.parquet`;
      const url = `${baseUrl}/${dbno}/${filename}`;

      const response = await fetch(url);
      if (!response.ok) {
        console.warn('[SceneTreeLoader] Parquet file not found:', url);
        return null;
      }

      const buffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);

      const db = await ensureDuckDB();
      const conn = await db.connect();

      try {
        await db.registerFileBuffer(filename, uint8Array);

        const result = await conn.query(`
                    SELECT id, parent, name, has_geo, is_leaf, generated, dbno, geo_type
                    FROM parquet_scan('${filename}')
                `);

        const rows: SceneTreeRow[] = [];
        for (const row of result.toArray()) {
          rows.push({
            id: Number(row.id),
            parent: row.parent !== null ? Number(row.parent) : null,
            name: row.name ?? '',
            has_geo: row.has_geo ?? false,
            is_leaf: row.is_leaf ?? false,
            generated: row.generated ?? false,
            dbno: row.dbno ?? dbno,
            geo_type: row.geo_type ?? null,
          });
        }

        await db.dropFile(filename);

        console.log(`[SceneTreeLoader] Parquet returned ${rows.length} nodes`);
        return rows;

      } finally {
        await conn.close();
      }

    } catch (error) {
      console.warn('[SceneTreeLoader] Parquet error:', error);
      return null;
    }
  }

  /**
     * 加载场景树（SurrealDB 优先，Parquet 备选）
     */
  async function loadSceneTree(dbno: number): Promise<boolean> {
    loadingState.value = {
      loading: true,
      error: null,
      nodeCount: 0,
      dataSource: null,
    };

    try {
      let rows: SceneTreeRow[] | null = null;
      let dataSource: DataSource = null;

      // 1. 优先尝试 SurrealDB
      rows = await loadFromSurrealDB(dbno);
      if (rows && rows.length > 0) {
        dataSource = 'surrealdb';
      } else {
        // 2. 回退到 Parquet
        rows = await loadFromParquet(dbno);
        if (rows && rows.length > 0) {
          dataSource = 'parquet';
        }
      }

      if (!rows || rows.length === 0) {
        throw new Error('No scene tree data available from SurrealDB or Parquet');
      }

      // 3. 构建树结构
      const { nodes, roots } = buildTreeFromRows(rows);
      nodesById.value = nodes;
      rootIds.value = roots;

      loadingState.value = {
        loading: false,
        error: null,
        nodeCount: nodes.size,
        dataSource,
      };

      console.log(`[SceneTreeLoader] Loaded ${nodes.size} nodes from ${dataSource}`);
      return true;

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[SceneTreeLoader] Error:', message);
      loadingState.value = {
        loading: false,
        error: message,
        nodeCount: 0,
        dataSource: null,
      };
      return false;
    }
  }

  /**
     * 从原始行数据构建树结构
     */
  function buildTreeFromRows(rows: SceneTreeRow[]): {
        nodes: Map<string, SceneTreeNode>
        roots: string[]
    } {
    const nodes = new Map<string, SceneTreeNode>();
    const roots: string[] = [];

    // 第一遍：创建所有节点
    for (const row of rows) {
      const id = normalizeRefno(row.id);
      const parentId = row.parent !== null ? normalizeRefno(row.parent) : null;

      nodes.set(id, {
        id,
        parentId,
        name: row.name || id,
        hasGeo: row.has_geo,
        isLeaf: row.is_leaf,
        generated: row.generated,
        geoType: row.geo_type,
        childrenIds: [],
      });
    }

    // 第二遍：建立父子关系
    const nodeValues = Array.from(nodes.values());
    for (const node of nodeValues) {
      if (node.parentId) {
        const parent = nodes.get(node.parentId);
        if (parent) {
          parent.childrenIds.push(node.id);
        } else {
          roots.push(node.id);
        }
      } else {
        roots.push(node.id);
      }
    }

    return { nodes, roots };
  }

  /**
     * 获取节点
     */
  function getNode(id: string): SceneTreeNode | undefined {
    return nodesById.value.get(id);
  }

  /**
     * 获取子节点
     */
  function getChildren(id: string): SceneTreeNode[] {
    const node = nodesById.value.get(id);
    if (!node) return [];
    return node.childrenIds
      .map(childId => nodesById.value.get(childId))
      .filter((n): n is SceneTreeNode => n !== undefined);
  }

  /**
     * 获取所有叶子节点（有几何数据的）
     */
  function getGeoLeaves(): SceneTreeNode[] {
    const leaves: SceneTreeNode[] = [];
    const nodes = Array.from(nodesById.value.values());
    for (const node of nodes) {
      if (node.hasGeo && node.isLeaf) {
        leaves.push(node);
      }
    }
    return leaves;
  }

  /**
     * 清空数据
     */
  function clear() {
    nodesById.value = new Map();
    rootIds.value = [];
    loadingState.value = {
      loading: false,
      error: null,
      nodeCount: 0,
      dataSource: null,
    };
  }

  return {
    loadingState,
    nodesById,
    rootIds,
    loadSceneTree,
    getNode,
    getChildren,
    getGeoLeaves,
    clear,
  };
}
