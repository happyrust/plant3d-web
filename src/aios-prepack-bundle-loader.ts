// @ts-nocheck
import { parse } from '@loaders.gl/core';
import { GLTFLoader, postProcessGLTF, type GLTFPostprocessed, type GLTFWithBuffers, type GLTFAccessorPostprocessed } from '@loaders.gl/gltf';
import { SceneModel, type Viewer } from '@xeokit/xeokit-sdk';

import { SiteSpecValue } from '@/types/spec';

type FileRef = {
  path: string;
  bytes: number;
  sha256?: string;
  mesh_files_found?: number;
  mesh_files_missing?: number;
};

type LodProfile = {
  level: number;
  target_triangles: number;
  max_position_error: number;
  default_material: string;
  asset_key: string;
  priority: number;
};

type InstancedBundleManifest = {
  version: string;
  generated_at: string;
  files: {
    geometry_manifest: FileRef;
    instance_manifest: FileRef;
    geometry_assets: Record<string, FileRef>;
  };
  unit_conversion?: {
    source_unit: string;
    target_unit: string;
    factor: number;
    precision?: number;
  };
  lod_profiles?: LodProfile[];
  stats?: {
    unique_geometries: number;
    total_instances: number;
  };
};

/**
 * V1.0 Multi-GLB (Hash-based) Manifest Types
 * Matches export_instanced_bundle.rs output
 */

type HashLodLevelInfo = {
  level: string;
  geometry_url: string;
  distance: number;
};

type HashArchetypeInfo = {
  id: string; // geo_hash
  noun: string;
  material: string;
  lod_levels: HashLodLevelInfo[];
  instances_url: string;
  instance_count: number;
};

type HashInstancedManifest = {
  version: string; // "1.0"
  export_time: string;
  total_archetypes: number;
  total_instances: number;
  archetypes: HashArchetypeInfo[];
};

type HashInstanceInfo = {
  refno: string;
  matrix: number[];
  color?: [number, number, number];
  name?: string;
};

type HashInstancesData = {
  geo_hash: string;
  instances: HashInstanceInfo[];
};

type GeometryLodEntry = {
  level: number;
  asset_key: string;
  mesh_index: number;
  node_index: number;
  triangle_count: number;
  error_metric: number;
};

type GeometryEntry = {
  geo_hash: string;
  geo_index: number;
  nouns: string[];
  vertex_count: number;
  triangle_count: number;
  bounding_box: {
    min: [number, number, number];
    max: [number, number, number];
  } | null;
  bounding_sphere: {
    center: [number, number, number];
    radius: number;
  } | null;
  lods: GeometryLodEntry[];
};

type GeometryManifest = {
  generated_at: string;
  geometries: GeometryEntry[];
  coordinate_system?: {
    handedness: string;
    up_axis: string;
  };
};

type NameEntry = {
  kind: string;
  value: string;
};

type InstanceEntry = {
  geo_hash: string;
  matrix: number[];
  geo_index: number;
  color_index: number;
  name_index: number;
  site_name_index: number;
  zone_name_index?: number | null;
  lod_mask: number;
  uniforms: Record<string, unknown> | null;
  refno_transform?: number[];  // 构件的世界变换矩阵（V2 格式）
};

// V2 格式的几何体实例（在 component.instances 中）
type V2GeometryInstance = {
  geo_hash: string;
  geo_index: number;
  geo_transform: number[];  // 几何体相对于 refno 的局部变换
};

type ComponentInstances = {
  refno?: string;
  noun?: string;
  name?: string | null;
  name_index?: number;
  color_index?: number;           // V2: 颜色索引在 component 级别
  lod_mask?: number;              // V2: LOD 掩码在 component 级别
  spec_value?: number | null;     // V2: 规格值
  refno_transform?: number[];     // V2: 构件的世界变换矩阵
  instances: (InstanceEntry | V2GeometryInstance)[];
};

type HierarchyGroup = {
  refno?: string;
  noun?: string;
  name?: string | null;
  name_index?: number;
  children?: ComponentInstances[];
  tubings?: {
    geo_hash: string;
    matrix?: number[];            // V1 格式
    geo_index: number;
    color_index: number;
    name_index?: number;          // V1 格式
    name?: string | null;         // V2 格式
    lod_mask: number;
    uniforms?: Record<string, unknown> | null;  // V1 格式
    refno?: string;
    noun?: string;
    order?: number;
    spec_value?: number | null;   // V2 格式
  }[];
};

type InstanceManifest = {
  version?: number;
  generated_at: string;
  colors?: number[][];
  names?: NameEntry[];
  components?: ComponentInstances[];
  tubings?: { instances: InstanceEntry[] }[];
  bran_groups?: HierarchyGroup[];
  equi_groups?: HierarchyGroup[];
  ungrouped?: ComponentInstances[];
};

function normalizeRgbaMaybe(rgba: number[]): [number, number, number, number] {
  const r = Number(rgba[0] ?? 1);
  const g = Number(rgba[1] ?? 1);
  const b = Number(rgba[2] ?? 1);
  const a = Number(rgba[3] ?? 1);
  if (![r, g, b, a].every((v) => Number.isFinite(v))) {
    return [1, 1, 1, 1];
  }
  const max = Math.max(r, g, b, a);
  if (max > 1.0) {
    return [r / 255, g / 255, b / 255, a / 255];
  }
  return [r, g, b, a];
}

function normalizeRgbMaybe(rgb: number[]): [number, number, number] {
  const r = Number(rgb[0] ?? 1);
  const g = Number(rgb[1] ?? 1);
  const b = Number(rgb[2] ?? 1);
  if (![r, g, b].every((v) => Number.isFinite(v))) {
    return [1, 1, 1];
  }
  const max = Math.max(r, g, b);
  if (max > 1.0) {
    return [r / 255, g / 255, b / 255];
  }
  return [r, g, b];
}

export type LoadAiosPrepackOptions = {
  baseUrl: string;
  modelId?: string;
  lodAssetKey?: string;
  edges?: boolean;
  debug?: boolean;
  lazyEntities?: boolean; // 按需创建实体，默认 false
  refnos?: string; // 如果存在，则从 API 加载实例数据，忽略 manifest.json
};

export type EntityMeta = {
  refno: string;
  category: string;
  name: string;
  specValue?: SiteSpecValue;
};

export type InstanceData = {
  meshId: string;
  geometryId: string;
  matrix: number[];
  color: number[];
  opacity: number;
};

export type LazyEntityData = {
  refno: string;
  instances: InstanceData[];
  category: string;
  name: string;
  specValue?: SiteSpecValue;
  refnoTransform?: number[];  // 构件的世界变换矩阵（用于 ptset 坐标变换）
};

export type LazyEntityDebugInfo = {
  refno: string;
  hasLazyData: boolean;
  instanceCount: number;
  geometryPresentCount: number;
  geometryMissingCount: number;
  meshPresentCount: number;
  meshMissingCount: number;
  entityPresent: boolean;
  createdEntitiesFlag: boolean;
  sampleMissingGeometryIds: string[];
  sampleMissingMeshIds: string[];
};

export class LazyEntityManager {
  private sceneModel: SceneModel;
  private lazyData: Map<string, LazyEntityData>;
  private createdEntities: Set<string>;
  private edges: boolean;
  private geometryCfgById?: Map<string, Parameters<SceneModel['createGeometry']>[0]>;
  private archetypes?: Map<string, HashArchetypeInfo>;
  private baseUrl?: string;
  private lodAssetKey?: string;
  private preFinalizedOnce: boolean;

  constructor(
    sceneModel: SceneModel,
    lazyData: Map<string, LazyEntityData>,
    edges: boolean,
    options?: {
      geometryCfgById?: Map<string, Parameters<SceneModel['createGeometry']>[0]>;
      archetypes?: Map<string, HashArchetypeInfo>;
      baseUrl?: string;
      lodAssetKey?: string;
    }
  ) {
    this.sceneModel = sceneModel;
    this.lazyData = lazyData;
    this.createdEntities = new Set();
    this.edges = edges;
    this.geometryCfgById = options?.geometryCfgById;
    this.archetypes = options?.archetypes;
    this.baseUrl = options?.baseUrl;
    this.lodAssetKey = options?.lodAssetKey || 'L1';
    this.preFinalizedOnce = false;
  }

  private ensurePreFinalized() {
    // SceneModel 在 finalize 后会清空 _geometries，且不允许继续增量添加。
    // lazyEntities 模式下我们不调用 finalize，因此需要在增量创建后调用 preFinalize
    // 来让新 entity/mesh 真正生效到 scene。
    try {
      const m = this.sceneModel as unknown as { preFinalize?: () => boolean };
      if (typeof m.preFinalize === 'function') {
        const result = m.preFinalize();
        console.log('[ensurePreFinalized] preFinalize called, result:', result);
        this.preFinalizedOnce = true;
      } else {
        console.warn('[ensurePreFinalized] preFinalize method not found on SceneModel');
      }
    } catch (e) {
      console.error('[ensurePreFinalized] Error calling preFinalize:', e);
    }
  }

  /** 获取所有可用的 refno 列表 */
  getAllRefnos(): string[] {
    return Array.from(this.lazyData.keys());
  }

  hasRefno(refno: string): boolean {
    return this.lazyData.has(refno);
  }

  /** 获取 refno 对应的世界变换矩阵（用于 ptset 坐标变换） */
  getRefnoTransform(refno: string): number[] | undefined {
    return this.lazyData.get(refno)?.refnoTransform;
  }

  getDebugStats(): {
    lazyRefnoCount: number;
    createdEntityCount: number;
    meshCfgCount: number;
    geometryCount: number;
  } {
    const model = this.sceneModel as unknown as { _meshes?: Record<string, unknown>; _geometries?: Record<string, unknown> };
    const meshCfgCount = model._meshes ? Object.keys(model._meshes).length : 0;
    const geometryCount = model._geometries ? Object.keys(model._geometries).length : 0;
    return {
      lazyRefnoCount: this.lazyData.size,
      createdEntityCount: this.createdEntities.size,
      meshCfgCount,
      geometryCount,
    };
  }

  private hasGeometry(geometryId: string): boolean {
    const model = this.sceneModel as unknown as { _geometries?: Record<string, unknown> };
    return !!model._geometries?.[geometryId];
  }

  private hasMeshCfg(meshId: string): boolean {
    const model = this.sceneModel as unknown as { _meshes?: Record<string, unknown> };
    return !!model._meshes?.[meshId];
  }

  private async ensureGeometry(geometryId: string): Promise<boolean> {
    if (this.hasGeometry(geometryId)) return true;

    // Try classic local config first
    const cfg = this.geometryCfgById?.get(geometryId);
    if (cfg) {
      try {
        this.sceneModel.createGeometry(cfg);
        return true;
      } catch {
        return false;
      }
    }

    // Try archetype fetch (V1.0 Multi-GLB)
    if (this.archetypes && this.baseUrl) {
      // geometryId format: "g:HASH"
      const geoHash = geometryId.startsWith('g:') ? geometryId.substring(2) : geometryId;
      const archetype = this.archetypes.get(geoHash);
      if (archetype) {
        try {
          const lod = archetype.lod_levels.find(l => l.level === this.lodAssetKey) || archetype.lod_levels[0];
          if (!lod) return false;

          const url = joinUrl(this.baseUrl, lod.geometry_url);
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
          const arrayBuffer = await response.arrayBuffer();

          // Parse GLB - note: gltf.postProcess option is not recognized in @loaders.gl v4+
          // We need to manually handle the raw gltf data
          const gltfRaw = await parse(arrayBuffer, GLTFLoader);

          // The raw data has json property with mesh/node definitions
          const gltfAny = gltfRaw as unknown as {
            json?: {
              meshes?: Array<{ primitives?: Array<{ attributes?: Record<string, number>; indices?: number }> }>;
              nodes?: Array<{ mesh?: number }>;
              accessors?: Array<{ bufferView?: number; componentType?: number; count?: number; type?: string }>;
              bufferViews?: Array<{ buffer?: number; byteOffset?: number; byteLength?: number }>;
            };
            buffers?: Array<{ arrayBuffer?: ArrayBuffer }>;
          };

          console.log('[ensureGeometry] gltfData keys:', Object.keys(gltfAny));

          const json = gltfAny.json;
          if (!json?.meshes || json.meshes.length === 0) {
            console.error('[ensureGeometry] No meshes in GLB json');
            return false;
          }

          console.log('[ensureGeometry] Found meshes:', json.meshes.length, 'nodes:', json.nodes?.length);

          // Get the first mesh primitive
          const mesh = json.meshes[0];
          const primitive = mesh?.primitives?.[0];
          if (!primitive?.attributes) {
            console.error('[ensureGeometry] No primitive or attributes found');
            return false;
          }

          // Get buffer data - @loaders.gl stores buffer in different formats
          const buffers = gltfAny.buffers;
          console.log('[ensureGeometry] Buffers structure:', buffers?.map((b: { arrayBuffer?: ArrayBuffer }) => ({
            hasArrayBuffer: !!b.arrayBuffer,
            byteLength: b.arrayBuffer?.byteLength
          })));

          const buffer = buffers?.[0]?.arrayBuffer;
          if (!buffer) {
            console.error('[ensureGeometry] No buffer data');
            return false;
          }

          console.log('[ensureGeometry] Buffer byteLength:', buffer.byteLength);

          // Debug: Check if buffer starts with 'glTF' magic (would indicate wrong buffer)
          const first4Bytes = new Uint8Array(buffer, 0, 4);
          const magicString = String.fromCharCode(...first4Bytes);
          console.log('[ensureGeometry] Buffer first 4 bytes as string:', JSON.stringify(magicString));
          console.log('[ensureGeometry] Buffer first 12 bytes as hex:', Array.from(new Uint8Array(buffer, 0, 12)).map(b => b.toString(16).padStart(2, '0')).join(' '));

          // Check if this is the whole GLB file instead of just the BIN chunk
          // @loaders.gl may return the whole GLB in buffers[0].arrayBuffer
          let effectiveBuffer = buffer;
          if (magicString === 'glTF') {
            console.warn('[ensureGeometry] Buffer is the whole GLB file, extracting BIN chunk...');
            const dv = new DataView(buffer);
            // GLB structure: 12-byte header + (JSON chunk header + JSON data) + (BIN chunk header + BIN data)
            const jsonChunkLen = dv.getUint32(12, true);
            // JSON chunk header is at offset 12, JSON data starts at 20
            // BIN chunk starts after JSON chunk (with padding to 4-byte boundary)
            const jsonPaddedLen = jsonChunkLen + ((4 - (jsonChunkLen % 4)) % 4);
            const binChunkStart = 12 + 8 + jsonPaddedLen; // 12 header + 8 JSON chunk header + padded JSON
            const binChunkLen = dv.getUint32(binChunkStart, true);
            const binDataStart = binChunkStart + 8; // Skip BIN chunk header (4 bytes length + 4 bytes type)

            console.log('[ensureGeometry] Extracting BIN chunk:', {
              jsonChunkLen, jsonPaddedLen, binChunkStart, binChunkLen, binDataStart
            });

            // Extract the actual BIN data as the effective buffer
            effectiveBuffer = buffer.slice(binDataStart, binDataStart + binChunkLen);
            console.log('[ensureGeometry] Extracted BIN chunk length:', effectiveBuffer.byteLength);
          }

          console.log('[ensureGeometry] BufferViews:', json.bufferViews?.map((bv: Record<string, unknown>) => ({ offset: bv.byteOffset, length: bv.byteLength })));
          console.log('[ensureGeometry] Accessors:', json.accessors?.map((a: Record<string, unknown>) => ({
            bv: a.bufferView,
            offset: a.byteOffset,
            type: a.type,
            count: a.count,
            compType: a.componentType
          })));

          // Helper to extract accessor data - using slice to avoid alignment issues
          const getAccessorData = (accessorIndex: number | undefined): Float32Array | Uint32Array | null => {
            if (accessorIndex === undefined || !json.accessors || !json.bufferViews) return null;
            const accessor = json.accessors[accessorIndex];
            if (!accessor) return null;
            const bufferView = json.bufferViews[accessor.bufferView ?? 0];
            if (!bufferView) return null;

            // Total offset = bufferView offset + accessor offset
            const bufferViewOffset = bufferView.byteOffset ?? 0;
            const accessorOffset = (accessor as { byteOffset?: number }).byteOffset ?? 0;
            const totalOffset = bufferViewOffset + accessorOffset;
            const byteLength = bufferView.byteLength ?? 0;

            console.log(`[ensureGeometry] Accessor ${accessorIndex}: totalOffset=${totalOffset}, byteLength=${byteLength}`);

            // Create a copy to avoid alignment issues with DataView
            const slice = effectiveBuffer.slice(totalOffset, totalOffset + byteLength);

            // Component type 5126 = FLOAT (for positions/normals), 5125 = UNSIGNED_INT (for indices)
            if (accessor.componentType === 5126) {
              return new Float32Array(slice);
            } else if (accessor.componentType === 5125) {
              return new Uint32Array(slice);
            }
            return null;
          };

          const positions = getAccessorData(primitive.attributes.POSITION);
          const normals = getAccessorData(primitive.attributes.NORMAL);
          const indices = getAccessorData(primitive.indices);

          console.log('[ensureGeometry] Extracted data:', {
            positions: positions?.length,
            normals: normals?.length,
            indices: indices?.length
          });

          if (!positions || positions.length === 0) {
            console.error('[ensureGeometry] Failed to extract position data');
            return false;
          }

          // Debug: Check for invalid values and compute bounds
          let minX = Infinity, minY = Infinity, minZ = Infinity;
          let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
          let hasNaN = false, hasInf = false;

          for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i], y = positions[i + 1], z = positions[i + 2];
            if (isNaN(x) || isNaN(y) || isNaN(z)) hasNaN = true;
            if (!isFinite(x) || !isFinite(y) || !isFinite(z)) hasInf = true;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
          }

          console.log('[ensureGeometry] Position analysis:', JSON.stringify({
            sample: [positions[0], positions[1], positions[2]],
            bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
            hasNaN, hasInf
          }));

          // Create geometry  
          this.sceneModel.createGeometry({
            id: geometryId,
            primitive: 'triangles',
            positions: Array.from(positions),
            normals: normals ? Array.from(normals) : undefined,
            indices: indices ? Array.from(indices) : undefined
          } as any);

          console.log('[ensureGeometry] Geometry created successfully for', geometryId);
          return true;
        } catch (err) {
          console.error(`[LazyEntityManager] Failed to fetch/parse geometry ${geometryId}:`, err);
        }
      }
    }

    return false;
  }

  debugEntity(refno: string): LazyEntityDebugInfo {
    const sceneAny = (this.sceneModel as unknown as {
      scene?: {
        objects?: Record<string, { visible?: boolean }>;
      };
    }).scene;

    const data = this.lazyData.get(refno);
    const instances = data?.instances || [];

    let geometryPresentCount = 0;
    let geometryMissingCount = 0;
    let meshPresentCount = 0;
    let meshMissingCount = 0;
    const sampleMissingGeometryIds: string[] = [];
    const sampleMissingMeshIds: string[] = [];

    for (const inst of instances) {
      if (this.hasGeometry(inst.geometryId)) {
        geometryPresentCount++;
      } else {
        geometryMissingCount++;
        if (sampleMissingGeometryIds.length < 10) sampleMissingGeometryIds.push(inst.geometryId);
      }

      if (this.hasMeshCfg(inst.meshId)) {
        meshPresentCount++;
      } else {
        meshMissingCount++;
        if (sampleMissingMeshIds.length < 10) sampleMissingMeshIds.push(inst.meshId);
      }
    }

    const entityPresent = !!sceneAny?.objects?.[refno];

    return {
      refno,
      hasLazyData: !!data,
      instanceCount: instances.length,
      geometryPresentCount,
      geometryMissingCount,
      meshPresentCount,
      meshMissingCount,
      entityPresent,
      createdEntitiesFlag: this.createdEntities.has(refno),
      sampleMissingGeometryIds,
      sampleMissingMeshIds,
    };
  }

  /** 获取实体元数据 */
  getEntityMeta(refno: string): EntityMeta | undefined {
    const data = this.lazyData.get(refno);
    if (!data) return undefined;
    return {
      refno: data.refno,
      category: data.category,
      name: data.name,
      specValue: data.specValue,
    };
  }

  /** 检查实体是否已创建并可见 */
  isEntityVisible(refno: string): boolean {
    if (!this.createdEntities.has(refno)) return false;
    const entity = (this.sceneModel as unknown as { scene?: { objects?: Record<string, { visible?: boolean }> } }).scene?.objects?.[refno];
    return entity?.visible === true;
  }

  /** 检查实体是否已创建 */
  isEntityCreated(refno: string): boolean {
    return this.createdEntities.has(refno);
  }

  /** 创建并显示实体 */
  async showEntity(refno: string): Promise<boolean> {
    const sceneAny = (this.sceneModel as unknown as {
      scene?: {
        objects?: Record<string, { visible?: boolean }>;
      };
    }).scene;

    // 如果已创建，只需设置可见
    if (this.createdEntities.has(refno)) {
      const entity = (this.sceneModel as unknown as { scene?: { objects?: Record<string, { visible?: boolean }> } }).scene?.objects?.[refno];
      if (entity) {
        entity.visible = true;
        return true;
      }
      return false;
    }

    // 兼容“之前实体创建成功但 createdEntities 未记录”的情况
    if (sceneAny?.objects?.[refno]) {
      sceneAny.objects[refno]!.visible = true;
      this.createdEntities.add(refno);
      return true;
    }

    // 创建 mesh 和 entity
    const data = this.lazyData.get(refno);
    if (!data) return false;

    const meshIdSet = new Set<string>();
    for (const inst of data.instances) {
      // mesh 已存在时，直接复用，避免重复 createMesh 导致“already has a mesh with this ID”
      if (this.hasMeshCfg(inst.meshId)) {
        meshIdSet.add(inst.meshId);
        continue;
      }

      if (!(await this.ensureGeometry(inst.geometryId))) {
        continue;
      }

      const created = this.sceneModel.createMesh({
        id: inst.meshId,
        geometryId: inst.geometryId,
        primitive: 'triangles',
        matrix: inst.matrix,
        color: normalizeRgbMaybe(inst.color),
        opacity: inst.opacity,
        metallic: 0,
        roughness: 1
      } as unknown as Parameters<SceneModel['createMesh']>[0]);

      // 注意：xeokit createMesh 失败通常返回 false，不一定抛异常
      if (!created) {
        console.warn('[showEntity] createMesh returned false for', inst.meshId);
        continue;
      }
      // createMesh 成功后，mesh cfg 会注册到 SceneModel._meshes（而不是 scene.meshes）
      if (this.hasMeshCfg(inst.meshId)) {
        meshIdSet.add(inst.meshId);
      }
    }

    const meshIds = Array.from(meshIdSet);

    if (meshIds.length === 0) return false;

    const ent = this.sceneModel.createEntity({
      id: refno,
      meshIds,
      isObject: true,
      visible: true,
      edges: this.edges
    } as unknown as Parameters<SceneModel['createEntity']>[0]);

    console.log('[showEntity] createEntity result:', {
      refno,
      meshIds: meshIds.length,
      created: !!ent,
      entityVisible: (ent as any)?.visible
    });

    if (!ent) return false;

    this.ensurePreFinalized();

    this.createdEntities.add(refno);
    return true;
  }

  /** 隐藏实体 */
  hideEntity(refno: string): boolean {
    const sceneAny = (this.sceneModel as unknown as {
      scene?: { objects?: Record<string, { visible?: boolean }> };
    }).scene;
    const entity = sceneAny?.objects?.[refno];
    // lazyEntities 模式下：实体尚未创建时，隐藏视为 no-op 成功，避免 UI 误判。
    if (!entity) return true;

    // 如果 entity 已存在但 createdEntities 未记录，补记一下，让 hide/show 更幂等。
    if (!this.createdEntities.has(refno)) {
      this.createdEntities.add(refno);
    }

    if (entity) {
      entity.visible = false;
      this.ensurePreFinalized();
      return true;
    }
    return false;
  }

  /** 批量显示实体 */
  async showEntities(refnos: string[]): Promise<number> {
    let count = 0;
    for (const refno of refnos) {
      if (await this.showEntity(refno)) count++;
    }
    return count;
  }

  /** 显示所有实体 */
  async showAllEntities(): Promise<number> {
    return this.showEntities(this.getAllRefnos());
  }

  /** 隐藏所有实体 */
  hideAllEntities(): number {
    let count = 0;
    for (const refno of this.createdEntities) {
      if (this.hideEntity(refno)) count++;
    }
    return count;
  }

  /** 批量设置可见性 */
  async setVisibility(refnos: string[], visible: boolean): Promise<number> {
    let count = 0;
    for (const refno of refnos) {
      if (visible ? await this.showEntity(refno) : this.hideEntity(refno)) count++;
    }
    return count;
  }
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return base + path.replace(/^\//, '');
}

function resolveName(names: NameEntry[] | undefined, index: number | undefined | null): string | null {
  if (!names || index === undefined || index === null || index < 0 || index >= names.length) return null;
  const v = names[index]?.value;
  return v && v.length > 0 ? v : null;
}

function isV2Instances(manifest: InstanceManifest): boolean {
  return (
    manifest.version === 2
    || manifest.bran_groups !== undefined
    || manifest.equi_groups !== undefined
    || manifest.ungrouped !== undefined
  );
}

// 检测是否是 V2 格式的几何体实例（有 geo_transform 字段）
function isV2GeometryInstance(inst: InstanceEntry | V2GeometryInstance): inst is V2GeometryInstance {
  return 'geo_transform' in inst && !('matrix' in inst);
}

// 4x4 矩阵乘法（列优先）
function multiplyMat4(a: number[], b: number[]): number[] {
  const out: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const aVal = a[k * 4 + i];
        const bVal = b[j * 4 + k];
        if (aVal !== undefined && bVal !== undefined) {
          sum += aVal * bVal;
        }
      }
      out[j * 4 + i] = sum;
    }
  }
  return out;
}

// 单位矩阵
const IDENTITY_MATRIX = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
];

function flattenInstances(manifest: InstanceManifest): { category: string; instance: InstanceEntry }[] {
  const out: { category: string; instance: InstanceEntry }[] = [];

  if (isV2Instances(manifest)) {
    // V2 格式处理：需要计算 matrix = refno_transform × geo_transform
    console.log('[flattenInstances] V2 format detected', {
      bran_groups: manifest.bran_groups?.length || 0,
      equi_groups: manifest.equi_groups?.length || 0,
      ungrouped: manifest.ungrouped?.length || 0
    });

    const pushComponentInstances = (category: string, ownerNoun: string, ownerRefno: string | undefined, component: ComponentInstances): void => {
      const refnoTransform = component.refno_transform || IDENTITY_MATRIX;
      const componentColorIndex = component.color_index ?? 0;
      const componentLodMask = component.lod_mask ?? 1;
      const componentSpecValue = component.spec_value ?? 0;
      const componentRefno = component.refno;
      const componentNoun = component.noun || '';
      const componentName = component.name;

      console.log('[flattenInstances] Processing component', {
        category,
        refno: componentRefno,
        noun: componentNoun,
        name: componentName,
        instances: component.instances?.length || 0
      });

      for (const inst of component.instances) {
        let matrix: number[];
        let geoHash: string;
        let geoIndex: number;

        if (isV2GeometryInstance(inst)) {
          // V2 格式：计算最终矩阵
          matrix = multiplyMat4(refnoTransform, inst.geo_transform);
          geoHash = inst.geo_hash;
          geoIndex = inst.geo_index;
        } else {
          // V1 格式兼容
          matrix = inst.matrix;
          geoHash = inst.geo_hash;
          geoIndex = inst.geo_index;
        }

        // 构造兼容的 InstanceEntry
        const entry: InstanceEntry = {
          geo_hash: geoHash,
          matrix,
          geo_index: geoIndex,
          color_index: componentColorIndex,
          name_index: 0,  // V2 不使用索引
          site_name_index: 0,
          zone_name_index: null,
          lod_mask: componentLodMask,
          uniforms: {
            refno: componentRefno,
            owner_noun: ownerNoun,
            owner_refno: ownerRefno,
            name: componentName,
            noun: componentNoun,
            spec_value: componentSpecValue,
          },
          refno_transform: component.refno_transform,  // 保存原始的 refno_transform
        };
        out.push({ category, instance: entry });
      }
    };

    const pushTubingInstances = (category: string, ownerRefno: string | undefined, group: HierarchyGroup): void => {
      const tubings = group.tubings || [];
      for (const tubing of tubings) {
        // V2 tubing 没有 matrix，需要直接使用（或者它本身就是世界坐标）
        const matrix = tubing.matrix || IDENTITY_MATRIX;
        const inst: InstanceEntry = {
          geo_hash: tubing.geo_hash,
          matrix,
          geo_index: tubing.geo_index,
          color_index: tubing.color_index,
          name_index: tubing.name_index ?? 0,
          site_name_index: 0,
          zone_name_index: null,
          lod_mask: tubing.lod_mask,
          uniforms: tubing.uniforms ?? {
            refno: tubing.refno,
            owner_noun: 'BRAN',
            owner_refno: ownerRefno,
            name: tubing.name,
            noun: tubing.noun || 'TUBI',
            spec_value: tubing.spec_value ?? 0,
          }
        };
        out.push({ category, instance: inst });
      }
    };

    for (const group of manifest.bran_groups || []) {
      const ownerRefno = group.refno;
      console.log('[flattenInstances] Processing BRAN group', { ownerRefno, children: group.children?.length || 0 });
      for (const component of group.children || []) {
        pushComponentInstances('BRAN', 'BRAN', ownerRefno, component);
      }
      pushTubingInstances('BRAN', ownerRefno, group);
    }

    for (const group of manifest.equi_groups || []) {
      const ownerRefno = group.refno;
      for (const component of group.children || []) {
        pushComponentInstances('EQUI', 'EQUI', ownerRefno, component);
      }
    }

    for (const component of manifest.ungrouped || []) {
      pushComponentInstances('UNGROUPED', '', undefined, component);
    }

    console.log('[flattenInstances] V2 processing complete', { totalInstances: out.length });
    return out;
  }

  // V1 格式处理（保持原有逻辑）
  for (const component of manifest.components || []) {
    for (const inst of component.instances) {
      if (!isV2GeometryInstance(inst)) {
        out.push({ category: 'COMPONENT', instance: inst });
      }
    }
  }

  for (const tubing of manifest.tubings || []) {
    for (const inst of tubing.instances) {
      out.push({ category: 'TUBING', instance: inst });
    }
  }

  return out;
}

type MeshPrimitive = {
  positions: ArrayLike<number>;
  normals?: ArrayLike<number>;
  uv?: ArrayLike<number>;
  indices?: ArrayLike<number>;
};

type GltfPrimitiveLike = {
  attributes?: {
    POSITION?: GLTFAccessorPostprocessed;
    NORMAL?: GLTFAccessorPostprocessed;
    TEXCOORD_0?: GLTFAccessorPostprocessed;
  };
  indices?: GLTFAccessorPostprocessed;
};

type GltfMeshLike = {
  primitives?: unknown[];
};

type GltfNodeMeshRefLike =
  | number
  | {
    index?: number;
    id?: number;
  };

type GltfNodeLike = {
  mesh?: GltfNodeMeshRefLike;
};

function getGltfNodes(gltfData: GLTFPostprocessed): unknown[] {
  const root = gltfData as unknown as { nodes?: unknown[]; json?: { nodes?: unknown[] } };
  return root.nodes || root.json?.nodes || [];
}

function extractMeshPrimitivesByIndex(gltfData: GLTFPostprocessed): Map<number, MeshPrimitive> {
  // @loaders.gl may put meshes in gltfData.meshes or gltfData.json?.meshes
  const root = gltfData as unknown as { meshes?: GltfMeshLike[]; json?: { meshes?: GltfMeshLike[] } };
  const meshes = (root.meshes || root.json?.meshes || []) as GltfMeshLike[];
  const map = new Map<number, MeshPrimitive>();

  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex++) {
    const mesh = meshes[meshIndex];
    if (!mesh) continue;

    const primitives = mesh.primitives;
    if (!primitives || primitives.length === 0) continue;

    let prim: GltfPrimitiveLike | null = null;
    for (const p of primitives) {
      const cand = p as unknown as GltfPrimitiveLike;
      const pos = cand.attributes?.POSITION;
      if (pos) {
        prim = cand;
        break;
      }
    }
    if (!prim) continue;
    const posAccessor = prim.attributes?.POSITION;
    if (!posAccessor) continue;

    const normalAccessor = prim.attributes?.NORMAL;
    const uvAccessor = prim.attributes?.TEXCOORD_0;
    const idxAccessor = prim.indices;

    map.set(meshIndex, {
      positions: posAccessor.value,
      normals: normalAccessor?.value,
      uv: uvAccessor?.value,
      indices: idxAccessor?.value,
    });
  }

  return map;
}

function extractNodeMeshIndexByNodeIndex(gltfData: GLTFPostprocessed): Map<number, number> {
  const nodes = getGltfNodes(gltfData) as unknown as GltfNodeLike[];
  const meshes = (gltfData.meshes || []) as unknown as unknown[];
  const map = new Map<number, number>();

  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
    const node = nodes[nodeIndex];
    if (!node) continue;

    const meshRef = node.mesh;
    let meshIndex: number | null = null;
    if (typeof meshRef === 'number') {
      meshIndex = meshRef;
    } else if (meshRef && typeof meshRef === 'object') {
      if (typeof meshRef.index === 'number') {
        meshIndex = meshRef.index;
      } else if (typeof meshRef.id === 'number') {
        meshIndex = meshRef.id;
      } else {
        const idx = meshes.indexOf(meshRef as unknown);
        if (idx >= 0) meshIndex = idx;
      }
    }

    if (meshIndex === null) continue;
    map.set(nodeIndex, meshIndex);
  }

  return map;
}

function chooseLodAssetKey(manifest: InstancedBundleManifest, requested: string | undefined): string {
  if (requested && manifest.files.geometry_assets[requested]) return requested;

  const profiles = manifest.lod_profiles;
  if (profiles && profiles.length > 0) {
    const sorted = [...profiles].sort((a, b) => a.priority - b.priority);
    const first = sorted[0]?.asset_key;
    if (first && manifest.files.geometry_assets[first]) return first;
  }

  const keys = Object.keys(manifest.files.geometry_assets || {});
  if (keys.includes('L1')) return 'L1';
  return keys[0] || 'L1';
}

export async function loadAiosPrepackBundle(viewer: Viewer, options: LoadAiosPrepackOptions): Promise<{ sceneModel: SceneModel; lazyEntityManager: LazyEntityManager }> {
  const modelId = options.modelId || 'aios-prepack';
  const baseUrl = options.baseUrl;

  const debug = options.debug === true;
  const log = (...args: unknown[]) => {
    if (!debug) return;
    console.log('[aios-prepack]', ...args);
  };
  const warn = (...args: unknown[]) => {
    if (!debug) return;
    console.warn('[aios-prepack]', ...args);
  };
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  log('load start', { modelId, baseUrl, lodAssetKey: options.lodAssetKey, edges: options.edges });

  const existing = viewer.scene.models[modelId] as unknown as { destroy?: () => void } | undefined;
  if (existing) {
    log('existing model found -> destroy', { modelId });
    existing.destroy?.();
  }

  // Ensure baseUrl ends with slash
  const assetBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  // API Based Loading
  if (options.refnos) {
    log('using API source for refnos:', options.refnos);
    // Use /api proxy. Assume request originates from same host/port as dev server or configured proxy.
    // In DEV mode, bypass vite proxy to avoid 404s/HTML responses if proxy config is flaky
    const apiUrl = import.meta.env.DEV
      ? `http://localhost:8080/api/instances?refnos=${encodeURIComponent(options.refnos)}`
      : `/api/instances?refnos=${encodeURIComponent(options.refnos)}`;

    log('fetch API', apiUrl);
    const resp = await fetch(apiUrl);
    if (!resp.ok) {
      throw new Error(`Failed to load instances from API: ${resp.status} ${resp.statusText}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const responseData = await resp.json() as any;

    const hashManifest: HashInstancedManifest = {
      version: "1.0",
      export_time: new Date().toISOString(),
      total_archetypes: responseData.archetypes.length,
      total_instances: 0,
      archetypes: responseData.archetypes
    };

    const sceneModel = new SceneModel(viewer.scene, {
      id: modelId,
      isModel: true
    } as unknown as Record<string, unknown>);

    const archetypesMap = new Map<string, HashArchetypeInfo>();
    const lazyData = new Map<string, LazyEntityData>();
    let meshCounter = 0;

    for (const archetype of hashManifest.archetypes) {
      // Fix geometry URL to include LOD directory
      if (archetype.lod_levels) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        archetype.lod_levels = archetype.lod_levels.map((l: any) => ({
          ...l,
          geometry_url: l.geometry_url.startsWith('lod_') ? l.geometry_url : `lod_${l.level}/${l.geometry_url}`
        }));
      }
      archetypesMap.set(archetype.id, archetype);
    }

    // Process instances_data from API
    // responseData.instances_data is array of { geo_hash: string, instances: HashInstanceInfo[] }
    if (Array.isArray(responseData.instances_data)) {
      for (const group of responseData.instances_data) {
        const geoHash = group.geo_hash;
        const archetype = archetypesMap.get(geoHash);
        if (!archetype) {
          warn(`Archetype not found for geo_hash: ${geoHash}`);
          continue;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const inst of (group.instances as any[])) {
          const refno = inst.refno;
          const geometryId = `g:${geoHash}`; // Match geometryId format in ensureGeometry
          const meshId = `m:${meshCounter++}`;

          const instanceData: InstanceData = {
            meshId,
            geometryId,
            matrix: inst.matrix,
            color: normalizeRgbMaybe(inst.color || [0.75, 0.75, 0.78]),
            opacity: 1.0
          };

          if (!lazyData.has(refno)) {
            lazyData.set(refno, {
              refno,
              instances: [instanceData],
              category: archetype.noun,
              name: inst.name || refno
            });
          } else {
            lazyData.get(refno)!.instances.push(instanceData);
          }
        }
      }
    }

    const lazyEntityManager = new LazyEntityManager(sceneModel, lazyData, options.edges === true, {
      archetypes: archetypesMap,
      baseUrl: assetBaseUrl, // Use passed baseUrl for GLB assets
      lodAssetKey: options.lodAssetKey
    });

    log('API bundle initialized', { refnos: lazyData.size, archetypes: archetypesMap.size });

    // Registry managers
    try {
      const sceneAny = viewer.scene as unknown as {
        __aiosLazyEntityManagers?: Record<string, LazyEntityManager>;
        __aiosActiveLazyModelId?: string;
      };
      const modelKey = options.modelId || 'model';
      sceneAny.__aiosLazyEntityManagers ??= {};
      sceneAny.__aiosLazyEntityManagers[modelKey] = lazyEntityManager;
      sceneAny.__aiosActiveLazyModelId = modelKey;
    } catch { void 0; }

    return { sceneModel, lazyEntityManager };
  }

  const manifestUrl = joinUrl(baseUrl, 'manifest.json');
  log('fetch', manifestUrl);
  const manifestResp = await fetch(manifestUrl);
  if (!manifestResp.ok) {
    throw new Error(`Failed to load manifest.json: ${manifestResp.status} ${manifestResp.statusText}`);
  }
  const manifest = await manifestResp.json() as InstancedBundleManifest | HashInstancedManifest;

  // Detect V1.0 Hash-based Multi-GLB Bundle
  const isHashBundle = manifest.version === '1.0' && 'archetypes' in manifest;

  if (isHashBundle) {
    log('detected V1.0 hash bundle');
    const hashManifest = manifest as HashInstancedManifest;

    const sceneModel = new SceneModel(viewer.scene, {
      id: modelId,
      isModel: true
    } as unknown as Record<string, unknown>);

    const archetypesMap = new Map<string, HashArchetypeInfo>();
    const lazyData = new Map<string, LazyEntityData>();
    const meshIdToRefno: Record<string, string> = {};
    let meshCounter = 0;

    for (const archetype of hashManifest.archetypes) {
      archetypesMap.set(archetype.id, archetype);
    }

    // Since instances are in separate JSONs, we might need a way to pre-populate lazyData base on refnos
    // or lazyData should also be more lazy.
    // For now, let's load all instances.json to build the refno -> geometry mapping.
    // In a production scenario, we might want a global index.json.
    log('fetching all instance manifests to build index...');
    await Promise.all(hashManifest.archetypes.map(async (archetype) => {
      try {
        const instUrl = joinUrl(baseUrl, archetype.instances_url);
        const resp = await fetch(instUrl);
        if (!resp.ok) return;
        const data = await resp.json() as HashInstancesData;

        for (const inst of data.instances) {
          const refno = inst.refno;
          const geometryId = `g:${archetype.id}`;
          const meshId = `m:${meshCounter++}`;
          meshIdToRefno[meshId] = refno;

          const instanceData: InstanceData = {
            meshId,
            geometryId,
            matrix: inst.matrix,
            color: normalizeRgbMaybe(inst.color || [0.75, 0.75, 0.78]),
            opacity: 1.0
          };

          if (!lazyData.has(refno)) {
            lazyData.set(refno, {
              refno,
              instances: [instanceData],
              category: archetype.noun,
              name: inst.name || refno
            });
          } else {
            lazyData.get(refno)!.instances.push(instanceData);
          }
        }
      } catch (err) {
        warn(`failed to fetch instances for ${archetype.id}`, err);
      }
    }));

    const lazyEntityManager = new LazyEntityManager(sceneModel, lazyData, options.edges === true, {
      archetypes: archetypesMap,
      baseUrl,
      lodAssetKey: options.lodAssetKey
    });

    log('hash bundle initialized', { refnos: lazyData.size, archetypes: archetypesMap.size });

    // Registry managers
    try {
      const sceneAny = viewer.scene as unknown as {
        __aiosLazyEntityManagers?: Record<string, LazyEntityManager>;
        __aiosActiveLazyModelId?: string;
      };
      const modelKey = options.modelId || 'model';
      sceneAny.__aiosLazyEntityManagers ??= {};
      sceneAny.__aiosLazyEntityManagers[modelKey] = lazyEntityManager;
      sceneAny.__aiosActiveLazyModelId = modelKey;
    } catch { void 0; }

    return { sceneModel, lazyEntityManager };
  }

  // Fallback to classic bundle logic
  const classicManifest = manifest as InstancedBundleManifest;
  log('manifest ok', { version: classicManifest.version, files: Object.keys(classicManifest.files?.geometry_assets || {}) });

  const lodAssetKey = chooseLodAssetKey(classicManifest, options.lodAssetKey);
  const lodAsset = classicManifest.files.geometry_assets[lodAssetKey];
  if (!lodAsset) {
    throw new Error(`LOD asset not found: ${lodAssetKey}`);
  }

  const geometryManifestUrl = joinUrl(baseUrl, classicManifest.files.geometry_manifest.path);
  log('fetch', geometryManifestUrl);
  const geometryManifestResp = await fetch(geometryManifestUrl);
  if (!geometryManifestResp.ok) {
    throw new Error(`Failed to load geometry_manifest.json: ${geometryManifestResp.status} ${geometryManifestResp.statusText}`);
  }
  const geometryManifest = await geometryManifestResp.json() as GeometryManifest;
  log('geometry_manifest ok', { geometries: geometryManifest.geometries.length });

  const instanceManifestUrl = joinUrl(baseUrl, classicManifest.files.instance_manifest.path);
  log('fetch', instanceManifestUrl);
  const instanceManifestResp = await fetch(instanceManifestUrl);
  if (!instanceManifestResp.ok) {
    throw new Error(`Failed to load instances.json: ${instanceManifestResp.status} ${instanceManifestResp.statusText}`);
  }
  const instanceManifest = await instanceManifestResp.json() as InstanceManifest;
  log('instances ok', { colors: instanceManifest.colors?.length || 0, names: instanceManifest.names?.length || 0 });

  const glbUrl = joinUrl(baseUrl, lodAsset.path);
  log('fetch', glbUrl);
  const glbResp = await fetch(glbUrl);
  if (!glbResp.ok) {
    throw new Error(`Failed to load GLB (${lodAssetKey}): ${glbResp.status} ${glbResp.statusText}`);
  }
  const glbBuffer = await glbResp.arrayBuffer();
  log('glb bytes', glbBuffer.byteLength);
  const gltfParsed = (await parse(glbBuffer, GLTFLoader, {})) as unknown as GLTFWithBuffers;
  const gltfData = postProcessGLTF(gltfParsed);

  const meshPrims = extractMeshPrimitivesByIndex(gltfData);
  const nodeMeshIndexByNodeIndex = extractNodeMeshIndexByNodeIndex(gltfData);
  if (debug) {
    const nodesLen = getGltfNodes(gltfData).length;
    log('gltf index sources', {
      nodes: nodesLen,
      meshes: gltfData.meshes?.length || 0,
      meshPrims: meshPrims.size,
      nodeMeshIndexMap: nodeMeshIndexByNodeIndex.size,
    });
  }
  log('gltf processed', { meshes: gltfData.meshes?.length || 0, meshPrims: meshPrims.size });

  const sceneModel = new SceneModel(viewer.scene, {
    id: modelId,
    isModel: true
  } as unknown as Record<string, unknown>);

  const createdMeshIndices = new Set<number>();
  const createdGeometryIds = new Set<string>();
  const geometryCfgById = new Map<string, Parameters<SceneModel['createGeometry']>[0]>();

  for (const geo of geometryManifest.geometries) {
    const lod = geo.lods.find((l) => l.asset_key === lodAssetKey) || geo.lods[0];
    if (!lod) continue;

    const geometryId = `g:${lodAssetKey}:${lod.mesh_index}`;
    if (createdGeometryIds.has(geometryId)) continue;

    const nodeMeshIndex = nodeMeshIndexByNodeIndex.get(lod.node_index);
    const prim = (nodeMeshIndex !== undefined ? meshPrims.get(nodeMeshIndex) : undefined) || meshPrims.get(lod.mesh_index);
    if (debug && lod.mesh_index === 338) {
      log('debug geometry 338', {
        geo_index: geo.geo_index,
        geo_hash: geo.geo_hash,
        mesh_index: lod.mesh_index,
        node_index: lod.node_index,
        nodeMeshIndex,
        primFromNode: nodeMeshIndex !== undefined ? !!meshPrims.get(nodeMeshIndex) : false,
        primFromMesh: !!meshPrims.get(lod.mesh_index),
      });
    }
    if (!prim) continue;

    const cfg: Record<string, unknown> = {
      id: geometryId,
      primitive: 'triangles',
      positions: prim.positions as unknown as number[],
    };

    if (prim.normals && (prim.normals as ArrayLike<number>).length > 0) {
      cfg.normals = prim.normals as unknown as number[];
    }

    if (prim.indices && (prim.indices as ArrayLike<number>).length > 0) {
      cfg.indices = prim.indices as unknown as number[];
    }

    if (prim.uv && (prim.uv as ArrayLike<number>).length > 0) {
      cfg.uv = prim.uv as unknown as number[];
    }

    const geoCfg = cfg as unknown as Parameters<SceneModel['createGeometry']>[0];
    geometryCfgById.set(geometryId, geoCfg);
    sceneModel.createGeometry(geoCfg);
    createdGeometryIds.add(geometryId);
    createdMeshIndices.add(lod.mesh_index);
  }

  log('createGeometry done', {
    numGeometries: (sceneModel as unknown as { numGeometries?: number }).numGeometries,
  });

  const geoByHash = new Map<string, GeometryEntry>();
  for (const geo of geometryManifest.geometries) {
    geoByHash.set(geo.geo_hash, geo);
  }

  const colors = instanceManifest.colors || [];
  const names = instanceManifest.names || [];

  const flatInstances = flattenInstances(instanceManifest);
  log('flattenInstances', { count: flatInstances.length });

  type PrepackInstance = {
    color_index: number;
    geo_hash: string;
    geo_index: number;
    lod_mask: number;
    matrix: number[];
    name_index: number;
    site_name_index: number;
    spec_value?: number;
    uniforms: PrepackUniforms;
  };

  type PrepackUniforms = {
    owner_noun?: string;
    owner_refno?: string;
    refno?: string;
    name?: string | null;      // V2 格式：直接名称
    noun?: string;             // V2 格式：构件类型
    spec_value?: number;       // V2 格式：规格值
  };

  // 构建 lazyData 用于延迟加载
  const lazyData = new Map<string, LazyEntityData>();
  const meshIdsByRefno = new Map<string, string[]>();
  const meshIdToRefno: Record<string, string> = {};
  let meshCounter = 0;

  for (const { category, instance } of flatInstances) {
    const inst = instance as PrepackInstance;
    const uniforms = inst.uniforms;
    const ownerNoun = uniforms?.owner_noun;
    const ownerRefno = uniforms?.owner_refno;
    const refnoRaw = uniforms?.refno;
    const specValue = inst.spec_value ?? 0;

    const refno = (ownerNoun === 'EQUI' && ownerRefno) ? ownerRefno : refnoRaw;

    // Debug: Log first few instances with details
    if (meshCounter < 5) {
      console.log(`[loadAiosPrepack] Processing instance #${meshCounter}`, {
        category,
        refno,
        refnoRaw,
        ownerNoun,
        ownerRefno,
        geo_hash: instance.geo_hash,
        hasUniforms: !!uniforms,
        uniformsRefno: uniforms?.refno
      });
    }

    if (!refno) {
      console.warn('[loadAiosPrepack] Skipping instance without refno', { category, uniforms });
      continue;
    }

    const geo = geoByHash.get(instance.geo_hash);
    if (!geo) continue;

    const lod = geo.lods.find((l) => l.asset_key === lodAssetKey) || geo.lods[0];
    if (!lod) continue;

    const geometryId = `g:${lodAssetKey}:${lod.mesh_index}`;
    // 仅允许引用已成功 createGeometry 的 mesh_index，否则 lazy showEntity 时会 createMesh 失败。
    if (!createdMeshIndices.has(lod.mesh_index)) continue;

    const meshId = `m:${meshCounter++}`;
    meshIdToRefno[meshId] = refno;

    const colorIndex = instance.color_index;
    const rgba = (Number.isFinite(colorIndex) && colorIndex >= 0 && colorIndex < colors.length) ? colors[colorIndex] : null;
    const normalized = rgba ? normalizeRgbaMaybe(rgba) : null;
    const isBran = (ownerNoun === 'BRAN' || category === 'BRAN');
    const rgb = isBran
      ? [0.2, 0.45, 0.85] // Blue for BRAN
      : (normalized ? [normalized[0], normalized[1], normalized[2]] : [0.85, 0.85, 0.85]);
    const opacity = normalized ? (normalized[3] ?? 1) : 1;

    // 构建实例数据
    const instanceData: InstanceData = {
      meshId,
      geometryId,
      matrix: instance.matrix as number[],
      color: rgb as number[],
      opacity: opacity as number,
    };

    // 添加到 lazyData
    if (!lazyData.has(refno)) {
      // V2 格式：优先从 uniforms.name 获取名称；V1 格式：从 names 数组索引获取
      const uniformsName = uniforms?.name as string | undefined;
      const displayName = uniformsName || resolveName(names, instance.name_index) || refno;
      lazyData.set(refno, {
        refno,
        instances: [instanceData],
        category: ownerNoun || category,
        name: displayName,
        specValue: specValue as SiteSpecValue,
        refnoTransform: instance.refno_transform,  // 存储 refno_transform 用于 ptset 变换
      });
    } else {
      lazyData.get(refno)!.instances.push(instanceData);
    }

    // 如果不是延迟加载，立即创建 mesh
    if (!options.lazyEntities) {
      sceneModel.createMesh({
        id: meshId,
        geometryId,
        primitive: 'triangles',
        matrix: instance.matrix,
        color: normalizeRgbMaybe(rgb),
        opacity,
        metallic: 0,
        roughness: 1
      } as unknown as Parameters<SceneModel['createMesh']>[0]);

      const list = meshIdsByRefno.get(refno) || [];
      list.push(meshId);
      meshIdsByRefno.set(refno, list);
    }
  }

  // Create LazyEntityManager
  const lazyEntityManager = new LazyEntityManager(sceneModel, lazyData, options.edges === true, {
    geometryCfgById,
    archetypes: undefined, // Archetypes not used in classic mode
    baseUrl,
    lodAssetKey
  });

  // 根据 lazyEntities 选项决定是否立即创建实体
  if (!options.lazyEntities) {
    for (const [refno, meshIds] of meshIdsByRefno) {
      sceneModel.createEntity({
        id: refno,
        meshIds,
        isObject: true,
        edges: options.edges === true
      } as unknown as Parameters<SceneModel['createEntity']>[0]);
    }
    log('createEntity done (eager)', { entities: meshIdsByRefno.size });
  } else {
    log('lazyEntities enabled, mesh+entity will be created on demand', { available: lazyData.size });
  }

  try {
    (viewer.scene as unknown as { __aiosMeshIdToRefno?: Record<string, string> }).__aiosMeshIdToRefno = meshIdToRefno;
  } catch {
    void 0;
  }

  try {
    // 从 lazyData 构建 metaByRefno 供外部使用
    const metaByRefno = new Map<string, { category: string; name: string; specValue?: SiteSpecValue }>();
    for (const [refno, data] of lazyData) {
      metaByRefno.set(refno, { category: data.category, name: data.name, specValue: data.specValue });
    }
    (viewer.scene as unknown as { __aiosMetaByRefno?: Record<string, { category: string; name: string; specValue?: SiteSpecValue }> }).__aiosMetaByRefno = Object.fromEntries(metaByRefno);
  } catch {
    void 0;
  }

  // 方案2：按 modelId 记录多个 LazyEntityManager，避免多模型加载时互相覆盖
  try {
    const sceneAny = viewer.scene as unknown as {
      __aiosLazyEntityManagers?: Record<string, LazyEntityManager>;
      __aiosActiveLazyModelId?: string;
    };
    const modelKey = options.modelId || 'model';
    sceneAny.__aiosLazyEntityManagers ??= {};
    sceneAny.__aiosLazyEntityManagers[modelKey] = lazyEntityManager;
    sceneAny.__aiosActiveLazyModelId = modelKey;
  } catch {
    void 0;
  }

  log('createMesh/createEntity done', { meshes: meshCounter, entities: meshIdsByRefno.size });

  // 注意：SceneModel.finalize() 会清空 _geometries，并且 finalize 后无法继续增量创建。
  // 在 lazyEntities 模式下，我们需要保留 geometry 以便后续按需 createMesh，因此不能 finalize。
  if (!options.lazyEntities) {
    sceneModel.finalize();
  }

  // DEBUG: 自动显示测试 refno（用于验证 V2 格式加载）

  const sceneModelAabb = (sceneModel as unknown as { aabb?: number[] }).aabb;
  log('finalize done', {
    sceneModelAabb: sceneModelAabb ? Array.from(sceneModelAabb) : null,
    sceneObjectCount: Object.keys(viewer.scene.objects || {}).length,
    sceneModelCount: Object.keys(viewer.scene.models || {}).length,
  });

  type MetaObjectJSON = {
    id: string;
    type: string;
    name?: string;
    parent?: string;
  };

  const metaObjects: MetaObjectJSON[] = [];
  metaObjects.push({ id: modelId, type: 'Model', name: modelId });

  const groupIds = {
    BRAN: `${modelId}:BRAN`,
    EQUI: `${modelId}:EQUI`,
    UNGROUPED: `${modelId}:UNGROUPED`,
    COMPONENT: `${modelId}:COMPONENT`,
    TUBING: `${modelId}:TUBING`,
  };

  for (const [type, id] of Object.entries(groupIds)) {
    metaObjects.push({ id, type, name: type, parent: modelId });
  }

  for (const [refno, data] of lazyData) {
    const groupId = Object.prototype.hasOwnProperty.call(groupIds, data.category)
      ? groupIds[data.category as keyof typeof groupIds]
      : groupIds.UNGROUPED;
    metaObjects.push({
      id: refno,
      type: data.category,
      name: data.name,
      parent: groupId
    });
  }

  viewer.metaScene.createMetaModel(modelId, { metaObjects });

  viewer.metaScene.fire('metaModelCreated', modelId);

  viewer.scene.fire('modelLoaded', modelId);

  if (debug) {
    const subIds: string[] = [];
    try {
      subIds.push(viewer.scene.on('modelUnloaded', (id: string) => {
        warn('scene event modelUnloaded', id);
      }));
      subIds.push(viewer.scene.on('objectVisibility', (entity: unknown) => {
        const e = entity as { id?: string; visible?: boolean };
        warn('scene event objectVisibility', { id: e.id, visible: e.visible });
      }));
    } catch {
      // ignore
    }

    setTimeout(() => {
      for (const subId of subIds) {
        try {
          viewer.scene.off(subId);
        } catch {
          // ignore
        }
      }
    }, 10_000);
  }

  try {
    const camBefore = {
      eye: [...viewer.scene.camera.eye],
      look: [...viewer.scene.camera.look],
      up: [...viewer.scene.camera.up],
    };

    const model = viewer.scene.models[modelId] as unknown as { aabb?: number[] } | undefined;
    const objectIdsForFit = Array.from(meshIdsByRefno.keys());
    const worldAabb = (objectIdsForFit.length > 0)
      ? viewer.scene.getAABB(objectIdsForFit)
      : null;
    const aabb = worldAabb || model?.aabb || (sceneModel as unknown as { aabb?: number[] }).aabb;

    if (debug) {
      const aabbList = (aabb && aabb.length === 6)
        ? Array.from(aabb).map((v) => Number(v).toPrecision(8)).join(', ')
        : String(aabb);
      log(`fit aabb=[${aabbList}] (worldAabb=${worldAabb ? 'yes' : 'no'})`);
    }

    const flyDone = () => {
      try {
        viewer.scene.camera.up = [0, 0, 1];
      } catch {
        // ignore
      }
      const camAfter = {
        eye: [...viewer.scene.camera.eye],
        look: [...viewer.scene.camera.look],
        up: [...viewer.scene.camera.up],
      };
      log('flyTo done', { camBefore, camAfter });
    };

    const isValidAabb = (v: unknown): v is [number, number, number, number, number, number] => {
      if (!v || !Array.isArray(v) || v.length !== 6) return false;
      const arr = v as number[];
      if (!arr.every((n) => Number.isFinite(n))) return false;
      // 过滤明显的哨兵/极端值（例如 9.007e15），否则会把 near/far 计算成天文数字导致模型被裁剪。
      const ABS_LIMIT = 1e14;
      if (arr.some((n) => Math.abs(n) >= ABS_LIMIT)) return false;
      const [xmin, ymin, zmin, xmax, ymax, zmax] = arr as [number, number, number, number, number, number];
      if (xmin > xmax || ymin > ymax || zmin > zmax) return false;
      const dx = xmax - xmin;
      const dy = ymax - ymin;
      const dz = zmax - zmin;
      const size = dx + dy + dz;
      return size > 0;
    };

    if (isValidAabb(aabb)) {
      const [xmin, ymin, zmin, xmax, ymax, zmax] = aabb;
      const dx = xmax - xmin;
      const dy = ymax - ymin;
      const dz = zmax - zmin;
      const diag = Math.sqrt(dx * dx + dy * dy + dz * dz);

      try {
        const near = Math.max(0.1, diag / 1000);
        const far = Math.max(10000, diag * 10);
        viewer.scene.camera.perspective.near = near;
        viewer.scene.camera.perspective.far = far;
        if (debug) {
          log(`set clip planes near=${near.toPrecision(6)} far=${far.toPrecision(6)} diag=${diag.toPrecision(6)}`);
        }
      } catch {
        // ignore
      }

      if (debug) {
        const aabbList = Array.from(aabb).map((n) => Number(n).toPrecision(8)).join(', ');
        log(`flyTo by aabb=[${aabbList}]`);
      }
      viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 1.0 }, flyDone);
    } else {
      log('flyTo fallback (invalid aabb) -> component', { aabb });
      viewer.cameraFlight.flyTo({ component: modelId, fit: true, duration: 1.0 }, flyDone);
    }
  } catch {
    // ignore
  }

  if (debug) {
    const checkpoints = [0, 300, 1000, 2000];
    for (const ms of checkpoints) {
      setTimeout(() => {
        const existsNow = !!viewer.scene.models[modelId];
        const visibleCount = Object.keys(viewer.scene.visibleObjects || {}).length;
        const cam = {
          eye: [...viewer.scene.camera.eye],
          look: [...viewer.scene.camera.look],
          up: [...viewer.scene.camera.up],
        };
        log(`checkpoint +${ms}ms`, { existsNow, visibleCount, cam });
      }, ms);
    }
  }

  const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  log('load end', { ms: Math.round(t1 - t0) });

  return { sceneModel, lazyEntityManager };
}
