/**
 * 属性 / 点集 / 变换的响应形状。这些形状是旧后端 `/api/pdms/*` 定下来的契约，gen-model-v1 适配器
 * （`model-source/genModelV1/{attributeSource,keypointSource}.ts`）按同一形状给，调用方一行不改。
 * 旧后端的取数函数（`pdmsGetUiAttr` / `pdmsGetPtset*` / `pdmsGetTypeInfo` / `pdmsGetOwnsChildren`）2026-09-20 随 legacy 退役：
 * 属性走 `getModelSource().attributes`，点集走 `getModelSource().keypoints`；只剩下面的 `pdmsGetTransform` 改由 gen-model-v1 实现。
 */
/** 属性来源的诊断（只有 gen-model-v1 直读源给；旧后端没有这一格） */
export type PdmsUiAttrDiagnostics = {
  /** `e3d-io` 等 */
  source?: string;
  /** 服务端是否认为这一份属性表完整 */
  complete?: boolean;
  /** 读不出来的属性名（服务端 `diagnostics.undecoded[].name`） */
  undecoded?: string[];
  /** 声明类型与实际形状不符的属性名 */
  shape_conflicts?: string[];
};

export type PdmsUiAttrResponse = {
  success: boolean;
  refno: string;
  attrs: Record<string, unknown>;
  /** 构件完整路径名称（层级路径） */
  full_name?: string | null;
  /** 引用类属性（值形如 pe:<refno>，如 OWNER/REFNO）解析出的 full_name，键为属性名 */
  ref_full_names?: Record<string, string> | null;
  error_message?: string | null;
  diagnostics?: PdmsUiAttrDiagnostics | null;
};

/**
 * 点集(ptset)中单个点的信息
 */
export type PtsetPoint = {
  /** 点编号 */
  number: number;
  /** 3D 坐标 [x, y, z] */
  pt: [number, number, number];
  /** 方向向量 [x, y, z]（可选） */
  dir: [number, number, number] | null;
  /** 方向标志 */
  dir_flag: number;
  /** 参考方向 [x, y, z]（可选） */
  ref_dir: [number, number, number] | null;
  /** 管道外径 */
  pbore: number;
  /** 宽度 */
  pwidth: number;
  /** 高度 */
  pheight: number;
  /** 连接信息 */
  pconnect: string;
}

/**
 * ptset 查询响应
 */
export type PtsetResponse = {
  success: boolean;
  refno: string;
  /**
   * 该构件的元素类型（`ELBO` / `ATTA` …）。gen-model-v1 `element/ptset` 随点集带回；旧后端没有这一项。
   * 测量拾取层靠它把 ATTA 的 P-Point 认成 E3D `EDGTUBING.line` 要跳过的穿过点。
   */
  noun?: string | null;
  /** 点集数据列表 */
  ptset: PtsetPoint[];
  /** 世界坐标变换矩阵（4x4） */
  world_transform: number[] | number[][] | null;
  /** 单位转换信息 */
  unit_info?: {
    source_unit: string;
    target_unit: string;
    conversion_factor: number;
  } | null;
  error_code?:
    | 'PTSET_REFNO_EMPTY'
    | 'PTSET_INSTANCE_MISSING'
    | 'PTSET_TABLE_MISSING'
    | 'PTSET_CATA_HASH_MISSING'
    | 'PTSET_TRANSFORM_MISSING'
    | 'PTSET_POINTS_MISSING'
    | 'PTSET_QUERY_FAILED'
    | null;
  error_message?: string | null;
}

export type PtsetQueryContext = {
  dbno?: number;
  batchId?: string | null;
}

export type PtsetBatchItemResponse = {
  input_refno: string;
  refno?: string | null;
  /** 成员的元素类型；见 `PtsetResponse.noun`。 */
  noun?: string | null;
  success: boolean;
  ptset: PtsetPoint[];
  world_transform?: number[] | number[][] | null;
  batch_id?: string | null;
  unit_info?: {
    source_unit: string;
    target_unit: string;
    conversion_factor: number;
  } | null;
  error_message?: string | null;
}

export type PtsetBatchQueryResponse = {
  success: boolean;
  results: PtsetBatchItemResponse[];
  total_count: number;
  success_count: number;
  failed_count: number;
}

export type PtsetChildrenResponse = PtsetBatchQueryResponse & {
  refno: string;
  error_message?: string | null;
}

/**
 * 变换矩阵查询响应
 */
export type TransformResponse = {
  success: boolean;
  refno: string;
  /** 世界变换矩阵 (4x4 列主序) */
  world_transform: number[] | null;
  /** Owner refno */
  owner: string | null;
  error_message?: string | null;
}

/**
 * 获取指定元件的世界变换矩阵和 owner（`/api/pdms/transform` 形状）。
 *
 * gen-model-v1 实现：`world_transform` 取 `element/ptset` 的 `world_transform`（列主序 mm 的 local→world 矩阵，
 * 与旧后端同一份 `aios_core::transform::get_world_mat4`），`owner` 取树节点。找不到构件回 `success: false`。
 * @param refno 元件参考号，格式为 "24383_84631"
 */
export async function pdmsGetTransform(refno: string): Promise<TransformResponse> {
  const [{ genModelV1ElementPtset, isGenModelV1ApiError }, { getModelSource }] = await Promise.all([
    import('@/api/genModelV1Api'),
    import('@/model-source'),
  ]);
  const [ptset, node] = await Promise.all([
    genModelV1ElementPtset({ refno }).catch((error: unknown) => {
      if (isGenModelV1ApiError(error) && error.isNotFound) return null;
      throw error;
    }),
    getModelSource().tree.node(refno).then((resp) => resp?.node ?? null).catch(() => null),
  ]);
  const owner = typeof node?.owner === 'string' && node.owner.trim() !== '' ? node.owner.trim() : null;
  if (!ptset) {
    return {
      success: false,
      refno,
      world_transform: null,
      owner,
      error_message: `Element ${refno} not found in gen-model-v1`,
    };
  }
  return {
    success: true,
    refno: ptset.refno ?? refno,
    world_transform: Array.isArray(ptset.world_transform) ? (ptset.world_transform as number[]) : null,
    owner,
  };
}

// ========================
// PDMS 模型查询辅助
// ========================

export type PdmsTypeInfoResponse = {
  success: boolean;
  refno: string;
  noun?: string | null;
  owner_refno?: string | null;
  owner_noun?: string | null;
  error_message?: string | null;
}
