import { FileValidationError, failFileValidation } from './fileValidation';

/**
 * 解析 gen-model 的 `.mesh` 文件（rkyv 0.7.42 归档的 aios-core `PlantMesh`）——
 * `.mesh` 直连口径（2026-09-09 拍板：不再经服务端转 GLB）。
 *
 * ## 布局契约（冻结）
 *
 * 根结构在文件**末尾** 60 字节（rkyv `archived_root`），字段偏移（全部小端）：
 *
 * ```text
 * +0   aabb: ArchivedOption<Aabb>   tag u8（0=None/1=Some）；Some 时 +4 起 mins、+16 起 maxs 各 3×f32
 * +28  indices:       { rel: i32, len: u32 }   元素 u32
 * +36  vertices:      { rel: i32, len: u32 }   元素 Vec3 = 3×f32
 * +44  normals:       { rel: i32, len: u32 }   元素 Vec3 = 3×f32
 * +52  wire_vertices: { rel: i32, len: u32 }   元素为内层 { rel: i32, len: u32 }（当前语料恒为空）
 * ```
 *
 * `rel` 是 rkyv RelPtr：相对**指针自身位置**的有符号偏移。aabb 排最前是 repr(Rust)
 * 对同对齐字段按大小重排的结果（28B > 8B）。
 *
 * 这份布局为什么敢在前端钉死：`.mesh` 语料按内容寻址（geo_hash）落盘，rkyv 一旦升级
 * 连 gen-model 自己都读不了旧文件，格式事实上冻结。契约两头各有一道钉：服务端
 * `web_service/mesh_glb.rs`（rkyv→GLB 的同一布局），本仓 `parseMeshGeometry.test.ts`
 * 以真实语料金样（2026-09-09 全量 48,590 份语料扫描通过，见该测试头注）。
 *
 * ## 行为
 *
 * 与 `parseGlbGeometry` 同一契约：成功回 `{ positions, indices, normals? }`，任何
 * 不一致（截断、越界、索引数不是 3 的倍数、空网格）回 `null`。法向量数量与顶点数
 * 不等时**省掉** normals（与服务端 GLB 转换同一决定：错位的法向量比没有更坏）。
 */

export type ParsedMeshGeometry = {
  positions: number[];
  indices: number[];
  normals?: number[];
};

export type MeshGeometryParseResult =
  | Readonly<{ ok: true; data: ParsedMeshGeometry }>
  | Readonly<{ ok: false; error: FileValidationError }>;

/** 根结构（`ArchivedPlantMesh`）的字节数。 */
const ROOT_SIZE = 60;

const OFFSET_AABB = 0;
const OFFSET_INDICES = 28;
const OFFSET_VERTICES = 36;
const OFFSET_NORMALS = 44;

type MeshVecLayout = Readonly<{ at: number; len: number }>;

type ValidatedMeshLayout = Readonly<{
  indices: MeshVecLayout;
  vertices: MeshVecLayout;
  normals: MeshVecLayout;
}>;

function validateMeshLayout(meshData: ArrayBuffer, source: string): ValidatedMeshLayout {
  const total = meshData.byteLength;
  const root = total - ROOT_SIZE;
  if (root < 0) {
    failFileValidation({
      source,
      format: 'mesh',
      reason: '文件短于 ArchivedPlantMesh 根结构',
      expected: `至少 ${ROOT_SIZE} 字节`,
      actual: `${total} 字节`,
      byteOffset: total,
    });
  }
  if (root % 4 !== 0) {
    failFileValidation({
      source,
      format: 'mesh',
      reason: '根结构未按 4 字节对齐，文件可能被截断',
      expected: '总长度减 60 后可被 4 整除',
      actual: `${total} 字节`,
      byteOffset: root,
    });
  }

  const view = new DataView(meshData);
  const aabbTag = view.getUint8(root + OFFSET_AABB);
  if (aabbTag > 1) {
    failFileValidation({
      source,
      format: 'mesh',
      reason: 'AABB ArchivedOption 标记无效',
      expected: '0（None）或 1（Some）',
      actual: String(aabbTag),
      byteOffset: root + OFFSET_AABB,
    });
  }

  const readVec = (offset: number, label: string, elemBytes: number): MeshVecLayout => {
    const pos = root + offset;
    const at = pos + view.getInt32(pos, true);
    const len = view.getUint32(pos + 4, true);
    const byteLength = len * elemBytes;
    const validLength = Number.isSafeInteger(byteLength);
    const inBounds = len === 0 || (
      validLength
      && at >= 0
      && at % 4 === 0
      && at + byteLength <= root
    );
    if (!inBounds) {
      failFileValidation({
        source,
        format: 'mesh',
        reason: `${label} 数据段越界或未对齐`,
        expected: `位于根结构前且按 4 字节对齐的 ${len}×${elemBytes} 字节数据段`,
        actual: `起点 ${at}，终点 ${validLength ? at + byteLength : '溢出'}，根起点 ${root}`,
        byteOffset: pos,
      });
    }
    return { at, len };
  };

  const indices = readVec(OFFSET_INDICES, 'indices', 4);
  const vertices = readVec(OFFSET_VERTICES, 'vertices', 12);
  const normals = readVec(OFFSET_NORMALS, 'normals', 12);
  if (vertices.len === 0) {
    failFileValidation({
      source,
      format: 'mesh',
      reason: '网格没有顶点',
      expected: '至少 1 个顶点',
      actual: '0 个顶点',
      byteOffset: root + OFFSET_VERTICES + 4,
    });
  }
  if (indices.len === 0 || indices.len % 3 !== 0) {
    failFileValidation({
      source,
      format: 'mesh',
      reason: '索引不能组成三角形',
      expected: '非零且为 3 的倍数的索引数',
      actual: `${indices.len} 个索引`,
      byteOffset: root + OFFSET_INDICES + 4,
    });
  }

  const indexView = new Uint32Array(meshData, indices.at, indices.len);
  for (let index = 0; index < indexView.length; index++) {
    const vertexIndex = indexView[index];
    if (vertexIndex !== undefined && vertexIndex >= vertices.len) {
      failFileValidation({
        source,
        format: 'mesh',
        reason: '索引引用了不存在的顶点',
        expected: `0..${vertices.len - 1}`,
        actual: String(vertexIndex),
        byteOffset: indices.at + index * 4,
      });
    }
  }

  return { indices, vertices, normals };
}

export function parseMeshGeometryResult(
  meshData: ArrayBuffer,
  source = '<memory>.mesh',
): MeshGeometryParseResult {
  try {
    const layout = validateMeshLayout(meshData, source);
    const indicesArr = new Uint32Array(meshData, layout.indices.at, layout.indices.len);
    const positionsArr = new Float32Array(meshData, layout.vertices.at, layout.vertices.len * 3);

    const positions = Array.from(positionsArr);
    const indices = Array.from(indicesArr);

    let normals: number[] | undefined;
    if (layout.normals.len === layout.vertices.len && layout.normals.len > 0) {
      normals = Array.from(new Float32Array(meshData, layout.normals.at, layout.normals.len * 3));
    }
    return { ok: true, data: { positions, indices, normals } };
  } catch (error) {
    if (error instanceof FileValidationError) return { ok: false, error };
    return {
      ok: false,
      error: new FileValidationError({
        source,
        format: 'mesh',
        reason: error instanceof Error ? error.message : '读取二进制结构失败',
        expected: '完整且可读取的 ArchivedPlantMesh',
        actual: `${meshData.byteLength} 字节缓冲区`,
      }),
    };
  }
}

/** 兼容旧调用方；需要可定位错误时使用 `parseMeshGeometryResult`。 */
export function parseMeshGeometry(meshData: ArrayBuffer): ParsedMeshGeometry | null {
  const result = parseMeshGeometryResult(meshData);
  return result.ok ? result.data : null;
}
