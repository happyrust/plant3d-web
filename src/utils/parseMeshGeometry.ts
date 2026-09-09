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
  positions: number[]
  indices: number[]
  normals?: number[]
}

/** 根结构（`ArchivedPlantMesh`）的字节数。 */
const ROOT_SIZE = 60;

const OFFSET_AABB = 0;
const OFFSET_INDICES = 28;
const OFFSET_VERTICES = 36;
const OFFSET_NORMALS = 44;

export function parseMeshGeometry(meshData: ArrayBuffer): ParsedMeshGeometry | null {
  try {
    const total = meshData.byteLength;
    const root = total - ROOT_SIZE;
    // rkyv 输出按根对齐（4）收尾；对不齐或装不下根结构的都不是 .mesh 归档
    if (root < 0 || root % 4 !== 0) return null;
    const view = new DataView(meshData);

    /** 读一个 ArchivedVec 头：rel 相对指针自身位置。 */
    const readVec = (offset: number): { at: number; len: number } => {
      const pos = root + offset;
      return { at: pos + view.getInt32(pos, true), len: view.getUint32(pos + 4, true) };
    };
    /** 数据段必须整体落在根结构之前，且 4 字节对齐。 */
    const inBounds = (at: number, len: number, elemBytes: number): boolean =>
      len === 0 || (at >= 0 && at % 4 === 0 && at + len * elemBytes <= root);

    const aabbTag = view.getUint8(root + OFFSET_AABB);
    if (aabbTag > 1) return null;

    const indicesVec = readVec(OFFSET_INDICES);
    const verticesVec = readVec(OFFSET_VERTICES);
    const normalsVec = readVec(OFFSET_NORMALS);
    if (!inBounds(indicesVec.at, indicesVec.len, 4)) return null;
    if (!inBounds(verticesVec.at, verticesVec.len, 12)) return null;
    if (!inBounds(normalsVec.at, normalsVec.len, 12)) return null;

    // 与服务端 plant_mesh_to_glb 同一批拒收条件：空网格、索引数不是 3 的倍数、索引越界
    if (verticesVec.len === 0) return null;
    if (indicesVec.len === 0 || indicesVec.len % 3 !== 0) return null;

    const indicesArr = new Uint32Array(meshData, indicesVec.at, indicesVec.len);
    for (let i = 0; i < indicesArr.length; i++) {
      if (indicesArr[i] >= verticesVec.len) return null;
    }
    const positionsArr = new Float32Array(meshData, verticesVec.at, verticesVec.len * 3);

    const positions = Array.from(positionsArr);
    const indices = Array.from(indicesArr);

    let normals: number[] | undefined;
    if (normalsVec.len === verticesVec.len && normalsVec.len > 0) {
      normals = Array.from(new Float32Array(meshData, normalsVec.at, normalsVec.len * 3));
    }
    return { positions, indices, normals };
  } catch {
    return null;
  }
}
