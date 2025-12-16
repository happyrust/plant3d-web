import { parse } from '@loaders.gl/core';
import { GLTFLoader, postProcessGLTF, type GLTFPostprocessed, type GLTFWithBuffers, type GLTFAccessorPostprocessed } from '@loaders.gl/gltf';
import { SceneModel, type Viewer } from '@xeokit/xeokit-sdk';

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
};

type ComponentInstances = {
  refno?: string;
  noun?: string;
  name?: string | null;
  name_index?: number;
  instances: InstanceEntry[];
};

type HierarchyGroup = {
  refno?: string;
  noun?: string;
  name?: string | null;
  name_index?: number;
  children?: ComponentInstances[];
  tubings?: {
    geo_hash: string;
    matrix: number[];
    geo_index: number;
    color_index: number;
    name_index: number;
    lod_mask: number;
    uniforms: Record<string, unknown> | null;
    refno?: string;
    noun?: string;
    order?: number;
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

export type LoadAiosPrepackOptions = {
  baseUrl: string;
  modelId?: string;
  lodAssetKey?: string;
  edges?: boolean;
  debug?: boolean;
};

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

function flattenInstances(manifest: InstanceManifest): { category: string; instance: InstanceEntry }[] {
  const out: { category: string; instance: InstanceEntry }[] = [];

  if (isV2Instances(manifest)) {
    const pushComponentInstances = (category: string, component: ComponentInstances): void => {
      for (const inst of component.instances) {
        out.push({ category, instance: inst });
      }
    };

    const pushTubingInstances = (category: string, group: HierarchyGroup): void => {
      const tubings = group.tubings || [];
      for (const tubing of tubings) {
        const inst: InstanceEntry = {
          geo_hash: tubing.geo_hash,
          matrix: tubing.matrix,
          geo_index: tubing.geo_index,
          color_index: tubing.color_index,
          name_index: tubing.name_index,
          site_name_index: 0,
          zone_name_index: null,
          lod_mask: tubing.lod_mask,
          uniforms: tubing.uniforms
        };
        out.push({ category, instance: inst });
      }
    };

    for (const group of manifest.bran_groups || []) {
      for (const component of group.children || []) {
        pushComponentInstances('BRAN', component);
      }
      pushTubingInstances('BRAN', group);
    }

    for (const group of manifest.equi_groups || []) {
      for (const component of group.children || []) {
        pushComponentInstances('EQUI', component);
      }
    }

    for (const component of manifest.ungrouped || []) {
      pushComponentInstances('UNGROUPED', component);
    }

    return out;
  }

  for (const component of manifest.components || []) {
    for (const inst of component.instances) {
      out.push({ category: 'COMPONENT', instance: inst });
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

function extractMeshPrimitivesByIndex(gltfData: GLTFPostprocessed): Map<number, MeshPrimitive> {
  const meshes = gltfData.meshes || [];
  const map = new Map<number, MeshPrimitive>();

  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex++) {
    const mesh = meshes[meshIndex];
    if (!mesh) continue;

    const primitives = mesh.primitives;
    if (!primitives || primitives.length === 0) continue;

    const prim = primitives[0];
    if (!prim) continue;
    const posAccessor = prim.attributes.POSITION as GLTFAccessorPostprocessed | undefined;
    if (!posAccessor) continue;

    const normalAccessor = prim.attributes.NORMAL as GLTFAccessorPostprocessed | undefined;
    const uvAccessor = prim.attributes.TEXCOORD_0 as GLTFAccessorPostprocessed | undefined;
    const idxAccessor = prim.indices as GLTFAccessorPostprocessed | undefined;

    map.set(meshIndex, {
      positions: posAccessor.value,
      normals: normalAccessor?.value,
      uv: uvAccessor?.value,
      indices: idxAccessor?.value,
    });
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

export async function loadAiosPrepackBundle(viewer: Viewer, options: LoadAiosPrepackOptions): Promise<{ sceneModel: SceneModel } > {
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

  const manifestUrl = joinUrl(baseUrl, 'manifest.json');
  log('fetch', manifestUrl);
  const manifestResp = await fetch(manifestUrl);
  if (!manifestResp.ok) {
    throw new Error(`Failed to load manifest.json: ${manifestResp.status} ${manifestResp.statusText}`);
  }
  const manifest = await manifestResp.json() as InstancedBundleManifest;
  log('manifest ok', { version: manifest.version, files: Object.keys(manifest.files.geometry_assets || {}) });

  const lodAssetKey = chooseLodAssetKey(manifest, options.lodAssetKey);
  const lodAsset = manifest.files.geometry_assets[lodAssetKey];
  if (!lodAsset) {
    throw new Error(`LOD asset not found: ${lodAssetKey}`);
  }

  const geometryManifestUrl = joinUrl(baseUrl, manifest.files.geometry_manifest.path);
  log('fetch', geometryManifestUrl);
  const geometryManifestResp = await fetch(geometryManifestUrl);
  if (!geometryManifestResp.ok) {
    throw new Error(`Failed to load geometry_manifest.json: ${geometryManifestResp.status} ${geometryManifestResp.statusText}`);
  }
  const geometryManifest = await geometryManifestResp.json() as GeometryManifest;
  log('geometry_manifest ok', { geometries: geometryManifest.geometries.length });

  const instanceManifestUrl = joinUrl(baseUrl, manifest.files.instance_manifest.path);
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
  const gltfParsed = await parse(glbBuffer, GLTFLoader, {}) as unknown as GLTFWithBuffers;
  const gltfData = postProcessGLTF(gltfParsed);

  const meshPrims = extractMeshPrimitivesByIndex(gltfData);
  log('gltf processed', { meshes: gltfData.meshes?.length || 0, meshPrims: meshPrims.size });

  const sceneModel = new SceneModel(viewer.scene, {
    id: modelId,
    isModel: true
  } as unknown as Record<string, unknown>);

  const usedMeshIndices = new Set<number>();
  for (const geo of geometryManifest.geometries) {
    const lod = geo.lods.find((l) => l.asset_key === lodAssetKey) || geo.lods[0];
    if (!lod) continue;
    usedMeshIndices.add(lod.mesh_index);
  }

  log('used mesh indices', { count: usedMeshIndices.size });

  for (const meshIndex of usedMeshIndices) {
    const prim = meshPrims.get(meshIndex);
    if (!prim) continue;
    const geometryId = `g:${lodAssetKey}:${meshIndex}`;

    const cfg: Record<string, unknown> = {
      id: geometryId,
      primitive: 'triangles',
      positions: prim.positions as unknown as number[],
    };

    if (prim.indices && (prim.indices as ArrayLike<number>).length > 0) {
      cfg.indices = prim.indices as unknown as number[];
    }

    if (prim.uv && (prim.uv as ArrayLike<number>).length > 0) {
      cfg.uv = prim.uv as unknown as number[];
    }

    sceneModel.createGeometry(cfg as unknown as Parameters<SceneModel['createGeometry']>[0]);
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

  const meshIdsByRefno = new Map<string, string[]>();
  const metaByRefno = new Map<string, { category: string; name: string }>();
  const meshIdToRefno: Record<string, string> = {};

  const flatInstances = flattenInstances(instanceManifest);
  log('flattenInstances', { count: flatInstances.length });
  let meshCounter = 0;

  type PrepackUniforms = {
    owner_noun?: string;
    owner_refno?: string;
    refno?: string;
  };

  for (const { category, instance } of flatInstances) {
    const uniforms = instance.uniforms as PrepackUniforms | null;
    const ownerNoun = uniforms?.owner_noun;
    const ownerRefno = uniforms?.owner_refno;
    const refnoRaw = uniforms?.refno;

    const refno = (ownerNoun === 'EQUI' && ownerRefno) ? ownerRefno : refnoRaw;
    if (!refno) continue;

    const geo = geoByHash.get(instance.geo_hash);
    if (!geo) continue;

    const lod = geo.lods.find((l) => l.asset_key === lodAssetKey) || geo.lods[0];
    if (!lod) continue;

    const geometryId = `g:${lodAssetKey}:${lod.mesh_index}`;
    if (!usedMeshIndices.has(lod.mesh_index)) continue;

    const meshId = `m:${meshCounter++}`;
    meshIdToRefno[meshId] = refno;

    const colorIndex = instance.color_index;
    const rgba = (Number.isFinite(colorIndex) && colorIndex >= 0 && colorIndex < colors.length) ? colors[colorIndex] : null;
    const rgb = rgba ? [rgba[0], rgba[1], rgba[2]] : [1, 1, 1];

    sceneModel.createMesh({
      id: meshId,
      geometryId,
      primitive: 'triangles',
      matrix: instance.matrix,
      color: rgb,
      opacity: rgba ? rgba[3] : 1,
      metallic: 0,
      roughness: 1
    } as unknown as Parameters<SceneModel['createMesh']>[0]);

    const list = meshIdsByRefno.get(refno) || [];
    list.push(meshId);
    meshIdsByRefno.set(refno, list);

    if (!metaByRefno.has(refno)) {
      const displayName = resolveName(names, instance.name_index) || refno;
      metaByRefno.set(refno, { category: ownerNoun || category, name: displayName });
    }
  }

  for (const [refno, meshIds] of meshIdsByRefno) {
    sceneModel.createEntity({
      id: refno,
      meshIds,
      isObject: true,
      edges: options.edges === true
    } as unknown as Parameters<SceneModel['createEntity']>[0]);
  }

  try {
    (viewer.scene as unknown as { __aiosMeshIdToRefno?: Record<string, string> }).__aiosMeshIdToRefno = meshIdToRefno;
  } catch {
    void 0;
  }

  log('createMesh/createEntity done', { meshes: meshCounter, entities: meshIdsByRefno.size });

  sceneModel.finalize();

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

  for (const [refno, meta] of metaByRefno) {
    const groupId = Object.prototype.hasOwnProperty.call(groupIds, meta.category)
      ? groupIds[meta.category as keyof typeof groupIds]
      : groupIds.UNGROUPED;
    metaObjects.push({
      id: refno,
      type: meta.category,
      name: meta.name,
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

    if (aabb && aabb.length === 6 && aabb.every((v) => Number.isFinite(v))) {
      const [xmin, ymin, zmin, xmax, ymax, zmax] = aabb as [number, number, number, number, number, number];
      const size = Math.abs(xmax - xmin) + Math.abs(ymax - ymin) + Math.abs(zmax - zmin);
      if (size > 0) {
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
          const aabbList = Array.from(aabb).map((v) => Number(v).toPrecision(8)).join(', ');
          log(`flyTo by aabb=[${aabbList}]`);
        }
        viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 1.0 }, flyDone);
      } else {
        if (debug) {
          const aabbList = Array.from(aabb).map((v) => Number(v).toPrecision(8)).join(', ');
          log(`flyTo fallback (aabb size=0) -> component, aabb=[${aabbList}]`);
        }
        viewer.cameraFlight.flyTo({ component: modelId, fit: true, duration: 1.0 }, flyDone);
      }
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

  return { sceneModel };
}
