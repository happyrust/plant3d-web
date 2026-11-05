import { describe, expect, it } from 'vitest';

import { BufferAttribute, BufferGeometry, Matrix4, PerspectiveCamera } from 'three';

import { DTXLayer } from './DTXLayer';

import type { DTXMultiDrawMesh } from './DTXMultiDrawMesh';

function tri(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  g.setIndex([0, 1, 2]);
  return g;
}

function camera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(90, 1, 0.1, 1000);
  cam.lookAt(0, 0, -1);
  cam.updateMatrixWorld();
  return cam;
}

function setup(): { layer: DTXLayer; mesh: DTXMultiDrawMesh } {
  const layer = new DTXLayer({ maxVertices: 64, maxIndices: 64, maxObjects: 8 });
  layer.addGeometry('tri', tri());
  // 两个在视野里、一个在身后，中间隔开避免并段
  layer.addObject('a', 'tri', new Matrix4().makeTranslation(0, 0, -10));
  layer.addObject('behind', 'tri', new Matrix4().makeTranslation(0, 0, 10));
  layer.addObject('b', 'tri', new Matrix4().makeTranslation(0, 0, -20));
  layer.compile();
  const mesh = (layer as unknown as { _mesh: DTXMultiDrawMesh })._mesh;
  return { layer, mesh };
}

describe('DTXLayer.updateDrawRanges', () => {
  it('编译后默认一段画全部，选段后跳过视锥外构件', () => {
    const { layer, mesh } = setup();
    expect(mesh._multiDrawCount).toBe(1);
    expect(mesh._multiDrawCounts[0]).toBe(9);
    layer.updateDrawRanges(camera(), 800, 0);
    // 三个构件各 1 个三角形，间隙 1 ≤ 默认 20：并成一段但统计照实
    expect(layer.getCullStats().segments).toBe(1);
    expect(layer.getCullStats().triangles).toBe(3);
  });

  it('输入不变命中缓存；可见性变化后重算', () => {
    const { layer } = setup();
    const cam = camera();
    layer.updateDrawRanges(cam, 800, 0);
    const n = layer.getCullStats().selectCount;
    layer.updateDrawRanges(cam, 800, 0);
    expect(layer.getCullStats().selectCount).toBe(n);
    layer.setObjectVisible('a', false);
    layer.updateDrawRanges(cam, 800, 0);
    expect(layer.getCullStats().selectCount).toBe(n + 1);
    expect(layer.getCullStats().triangles).toBe(1);
  });

  it('改全局矩阵后按新包围球重算', () => {
    const { layer, mesh } = setup();
    const cam = camera();
    layer.updateDrawRanges(cam, 800, 0);
    // 整体往 +Z 挪 100：全部到了相机身后
    layer.setGlobalModelMatrix(new Matrix4().makeTranslation(0, 0, 100));
    layer.updateDrawRanges(cam, 800, 0);
    expect(mesh._multiDrawCount).toBe(0);
  });

  it('关掉选段时一段画全部', () => {
    const { layer, mesh } = setup();
    layer.setCullOptions({ enabled: false });
    layer.updateDrawRanges(camera(), 800, 0);
    expect(mesh._multiDrawCount).toBe(1);
    expect(mesh._multiDrawStarts[0]).toBe(0);
    expect(mesh._multiDrawCounts[0]).toBe(9);
  });

  it('拾取网格不受选段影响', () => {
    const { layer } = setup();
    layer.setGlobalModelMatrix(new Matrix4().makeTranslation(0, 0, 100));
    layer.updateDrawRanges(camera(), 800, 0);
    const picking = layer.getPickingMesh()!;
    expect((picking as unknown as { isBatchedMesh?: boolean }).isBatchedMesh).not.toBe(true);
    expect(picking.geometry.drawRange.count).toBe(9);
  });
});

function quad(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  return g;
}

describe('DTXLayer 粗网格（L1）', () => {
  function lodSetup(): { layer: DTXLayer; mesh: DTXMultiDrawMesh } {
    const layer = new DTXLayer({ maxVertices: 64, maxIndices: 64, maxObjects: 8 });
    layer.addGeometry('quad', quad());
    layer.addGeometry('tri', tri());
    layer.addObject('near', 'quad', new Matrix4().makeTranslation(0, 0, -2));
    layer.addObject('far', 'quad', new Matrix4().makeTranslation(0, 0, -500));
    layer.addObject('tri', 'tri', new Matrix4().makeTranslation(0, 0, -500));
    // 原网格 quad 两个三角形，粗网格一个
    expect(layer.addLod1Geometry('quad', tri())).toBe(true);
    expect(layer.addLod1Geometry('quad', tri())).toBe(false);
    expect(layer.addLod1Geometry('missing', tri())).toBe(false);
    layer.compile();
    return { layer, mesh: (layer as unknown as { _mesh: DTXMultiDrawMesh })._mesh };
  }

  it('粗网格三角形排在原网格之后，图元映射第 31 位做标记，drawRange 只盖原网格', () => {
    const { layer, mesh } = lodSetup();
    const stats = layer.getCullStats();
    expect(stats.totalTriangles).toBe(5);
    expect(stats.lodCapableObjects).toBe(2);
    expect(stats.lodTriangles).toBe(2);
    expect(mesh.geometry.drawRange.count).toBe(15);
    expect(layer.getPickingMesh()!.geometry.drawRange.count).toBe(15);
    const p2o = (layer as unknown as { _primitiveToObjectTexture: { image: { data: Uint32Array } } })
      ._primitiveToObjectTexture.image.data;
    expect(Array.from(p2o.subarray(0, 7))).toEqual([0, 0, 1, 1, 2, 0x80000000, 0x80000001]);
  });

  it('远处的构件改画粗网格，近处的仍画原网格；lodPx = 0 时不用粗网格', () => {
    const { layer, mesh } = lodSetup();
    layer.setCullOptions({ lodPx: 48 });
    layer.updateDrawRanges(camera(), 800, 0);
    expect(layer.getCullStats().lodObjects).toBe(1);
    // 近处 quad [0,2) + 远处 tri 原网格 [4,5) 夹带间隙并一段；远处 quad 粗网格 [6,7) 另起一段
    expect(mesh._multiDrawCount).toBe(2);
    expect([mesh._multiDrawStarts[1], mesh._multiDrawCounts[1]]).toEqual([18, 3]);

    layer.setCullOptions({ lodPx: 0 });
    layer.updateDrawRanges(camera(), 800, 0);
    expect(layer.getCullStats().lodObjects).toBe(0);
  });

  it('替换原网格后旧构件不再用粗网格', () => {
    const layer = new DTXLayer({ maxVertices: 64, maxIndices: 64, maxObjects: 8 });
    layer.addGeometry('quad', quad());
    layer.addObject('old', 'quad', new Matrix4());
    layer.addLod1Geometry('quad', tri());
    layer.replaceGeometry('quad', quad());
    expect(layer.hasLod1Geometry('quad')).toBe(false);
    layer.addLod1Geometry('quad', tri());
    layer.addObject('new', 'quad', new Matrix4());
    layer.compile();
    expect(layer.getCullStats().lodCapableObjects).toBe(1);
    expect(layer.listLod1Candidates(1)).toEqual([]);
  });
});

describe('DTXLayer 不透明 / 透明分表选段', () => {
  type Meshes = { _mesh: DTXMultiDrawMesh; _transparentMesh: DTXMultiDrawMesh };

  /** 4 个构件（各 1 个三角形）沿 -Z 排开，全在视野里；用间隙 0 避免夹带，便于逐构件核对 */
  function passSetup(): { layer: DTXLayer; opaque: DTXMultiDrawMesh; transparent: DTXMultiDrawMesh } {
    const layer = new DTXLayer({ maxVertices: 64, maxIndices: 64, maxObjects: 8 });
    layer.addGeometry('tri', tri());
    ['a', 'b', 'c', 'd'].forEach((id, i) => layer.addObject(id, 'tri', new Matrix4().makeTranslation(0, 0, -10 - i * 5)));
    layer.compile();
    const { _mesh, _transparentMesh } = layer as unknown as Meshes;
    return { layer, opaque: _mesh, transparent: _transparentMesh };
  }

  /** 段表展开成构件序号（每构件 1 个三角形 = 3 个顶点） */
  function objectsOf(mesh: DTXMultiDrawMesh): number[] {
    const ids: number[] = [];
    for (let s = 0; s < mesh._multiDrawCount; s++) {
      for (let v = mesh._multiDrawStarts[s]!; v < mesh._multiDrawStarts[s]! + mesh._multiDrawCounts[s]!; v += 3) ids.push(v / 3);
    }
    return ids;
  }

  function select(layer: DTXLayer): void {
    // 通道号先于选段同步（与出帧前 update() 的顺序一致）
    layer.update(camera());
    layer.updateDrawRanges(camera(), 800, 0);
  }

  it('全不透明时透明表为空、透明网格不画', () => {
    const { layer, opaque, transparent } = passSetup();
    select(layer);
    expect(objectsOf(opaque)).toEqual([0, 1, 2, 3]);
    expect(transparent.visible).toBe(false);
    expect(transparent._multiDrawCount).toBe(0);
    const s = layer.getCullStats();
    expect([s.passes.opaque.triangles, s.passes.transparent.triangles, s.triangles]).toEqual([4, 0, 4]);
  });

  it('改透明度后各进各的表，两表不重不漏', () => {
    const { layer, opaque, transparent } = passSetup();
    layer.setObjectsOpacity(['b', 'd'], 0.5);
    // 合并间隙默认 20，这里 b、d 被夹带进不透明段；按通道核对时看统计里的构件归属
    select(layer);
    expect(layer.getCullStats().passes.transparent.triangles).toBeGreaterThanOrEqual(2);
    const flags = (layer as unknown as { _passFlags: Uint8Array })._passFlags;
    expect(Array.from(flags)).toEqual([0, 1, 0, 1]);
    expect(opaque.visible && transparent.visible).toBe(true);
  });

  it('setObjectMaterial 改透明度：标脏后下一次选段生效', () => {
    const { layer, transparent } = passSetup();
    layer.setObjectMaterial('c', { opacity: 0.3 });
    select(layer);
    expect(transparent.visible).toBe(true);
    expect(objectsOf(transparent)).toEqual([2]);
  });

  it('opacityScale 1 → 0.5 → 0 → 1：整层在两张表之间切换', () => {
    const { layer, opaque, transparent } = passSetup();
    select(layer);
    const n = layer.getCullStats().selectCount;

    layer.setRenderStyleParams({ opacityScale: 0.5 });
    select(layer);
    expect(layer.getCullStats().selectCount).toBeGreaterThan(n);
    expect(opaque.visible).toBe(false);
    expect(objectsOf(transparent)).toEqual([0, 1, 2, 3]);
    expect(layer.getCullStats().passes.opaque.triangles).toBe(0);

    layer.setRenderStyleParams({ opacityScale: 0 });
    select(layer);
    expect(opaque.visible || transparent.visible).toBe(false);
    expect(layer.getCullStats().triangles).toBe(0);

    layer.setRenderStyleParams({ opacityScale: 1 });
    select(layer);
    expect(objectsOf(opaque)).toEqual([0, 1, 2, 3]);
    expect(transparent.visible).toBe(false);
    // 透明网格不画了，它的统计不能留着 0.5 时的旧数
    expect(layer.getCullStats().passes.transparent.triangles).toBe(0);
    expect(layer.getCullStats().triangles).toBe(4);
  });

  it('recompile 后通道号按新对象表重建', () => {
    const { layer } = passSetup();
    layer.setObjectsOpacity(['a'], 0.5);
    layer.addObject('e', 'tri', new Matrix4().makeTranslation(0, 0, -40), undefined, { opacity: 0.4 });
    layer.recompile();
    select(layer);
    const { _mesh, _transparentMesh } = layer as unknown as Meshes;
    const o = objectsOf(_mesh);
    const t = objectsOf(_transparentMesh);
    const flags = Array.from((layer as unknown as { _passFlags: Uint8Array })._passFlags);
    expect(flags).toEqual([1, 0, 0, 0, 1]);
    // 两表并集覆盖全部可见构件；去掉合并夹带后没有构件同时属于两张表
    expect(new Set([...o, ...t])).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(o.filter((i) => flags[i] === 0)).toEqual([1, 2, 3]);
    expect(t.filter((i) => flags[i] === 1)).toEqual([0, 4]);
  });

  it('选段缓存：通道没变时命中，改透明度后只重算一次', () => {
    const { layer } = passSetup();
    select(layer);
    const n = layer.getCullStats().selectCount;
    select(layer);
    expect(layer.getCullStats().selectCount).toBe(n);
    layer.setObjectsOpacity(['a'], 0.5);
    select(layer);
    // 两张表各重算一次
    expect(layer.getCullStats().selectCount).toBe(n + 2);
  });
});
