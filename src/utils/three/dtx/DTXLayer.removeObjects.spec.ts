/**
 * `DTXLayer.removeObjects`：把对象真的从图层里拿掉（方案 2026-11-10 第三轮）。
 * 重载（整套替换）原来只把旧对象隐藏，同一个节点每重载一次对象槽就多出一份；加载中途叫停也要把已经画出来的收回去。
 */
import { describe, expect, it } from 'vitest';

import { BoxGeometry, BufferAttribute, BufferGeometry, Color, Matrix4, Scene, Vector3 } from 'three';

import { DTXLayer } from './DTXLayer';

function triangle(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

/** 两个三角形的四边形：和单个三角形的图元数不一样，移除之后图元偏移算错了就看得出来 */
function quad(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

function makeLayer(): DTXLayer {
  const layer = new DTXLayer({ maxVertices: 64, maxIndices: 128, maxObjects: 4 });
  layer.addGeometry('tri', triangle());
  layer.addGeometry('quad', quad());
  return layer;
}

const at = (x: number) => new Matrix4().makeTranslation(x, 0, 0);

/** a(tri) b(quad) c(tri) d(quad) e(tri)：x = 0 / 10 / 20 / 30 / 40 */
function fiveObjects(layer: DTXLayer): void {
  layer.addObject('o:1_1:0', 'tri', at(0), new Color(1, 0, 0));
  layer.addObject('o:1_2:1', 'quad', at(10), new Color(0, 1, 0));
  layer.addObject('o:1_3:2', 'tri', at(20), new Color(0, 0, 1));
  layer.addObject('o:1_4:3', 'quad', at(30), new Color(1, 1, 0), { opacity: 0.5 });
  layer.addObject('o:1_5:4', 'tri', at(40), new Color(0, 1, 1));
}

describe('DTXLayer.removeObjects', () => {
  it('拿掉中间的对象：剩下的按原来的先后往前挪，下标和图元偏移重新连续，对象数与三角形数变少', () => {
    const layer = makeLayer();
    fiveObjects(layer);
    layer.compile();
    expect(layer.getStats()).toMatchObject({ totalObjects: 5, drawTriangleCount: 7 });

    expect(layer.removeObjects(['o:1_2:1', 'o:1_4:3'])).toBe(2);
    layer.recompile();

    expect(layer.getAllObjectIds()).toEqual(['o:1_1:0', 'o:1_3:2', 'o:1_5:4']);
    expect(layer.objectCount).toBe(3);
    expect(layer.getStats()).toMatchObject({ totalObjects: 3, drawTriangleCount: 3, drawIndexCount: 9 });
    expect(layer.hasObject('o:1_2:1')).toBe(false);
    expect(layer.hasObject('o:1_4:3')).toBe(false);
    expect([0, 1, 2, 3].map((index) => layer.getObjectIdByIndex(index))).toEqual(['o:1_1:0', 'o:1_3:2', 'o:1_5:4', null]);
    expect(['o:1_1:0', 'o:1_3:2', 'o:1_5:4'].map((id) => {
      const object = layer.getObject(id)!;
      return [object.objectIndex, object.primitiveOffset];
    })).toEqual([[0, 0], [1, 1], [2, 2]]);
  });

  it('留下的对象带着自己的矩阵、颜色、透明度、显隐一起挪，不串到别的对象上', () => {
    const layer = makeLayer();
    fiveObjects(layer);
    layer.compile();
    layer.setObjectVisible('o:1_5:4', false);
    layer.setObjectColor('o:1_3:2', new Color(0.25, 0.5, 0.75));

    layer.removeObjects(['o:1_1:0', 'o:1_2:1']);
    layer.recompile();

    // 矩阵
    expect(layer.getObjectMatrix('o:1_3:2')!.elements[12]).toBe(20);
    expect(layer.getObjectMatrix('o:1_4:3')!.elements[12]).toBe(30);
    expect(layer.getObjectMatrix('o:1_5:4')!.elements[12]).toBe(40);
    // 显隐
    expect(layer.isObjectVisible('o:1_3:2')).toBe(true);
    expect(layer.isObjectVisible('o:1_5:4')).toBe(false);
    expect(layer.getVisibleObjectIds()).toEqual(['o:1_3:2', 'o:1_4:3']);
    // 透明度、材质色
    expect(layer.getObjectOpacity('o:1_4:3')).toBeCloseTo(0.5, 5);
    expect(layer.getObjectOpacity('o:1_3:2')).toBeCloseTo(1, 5);
    const color = layer.getObjectColor('o:1_5:4')!;
    expect([color.r, color.g, color.b]).toEqual([0, 1, 1]);
    // 之后对留下的对象再做操作，落在它自己头上
    layer.setObjectVisible('o:1_5:4', true);
    layer.setObjectVisible('o:1_3:2', false);
    expect(layer.getVisibleObjectIds()).toEqual(['o:1_4:3', 'o:1_5:4']);
  });

  it('留下的对象照样能被射线打中（矩阵和几何区段都跟着挪对了）', () => {
    const layer = makeLayer();
    fiveObjects(layer);
    layer.compile();
    layer.removeObjects(['o:1_1:0', 'o:1_2:1', 'o:1_3:2']);
    layer.recompile();

    const hitQuad = layer.raycastObject('o:1_4:3', new Vector3(30.8, 0.8, 1), new Vector3(0, 0, -1));
    expect(hitQuad).not.toBeNull();
    expect(hitQuad?.point.x).toBeCloseTo(30.8, 6);
    const hitTri = layer.raycastObject('o:1_5:4', new Vector3(40.2, 0.2, 1), new Vector3(0, 0, -1));
    expect(hitTri).not.toBeNull();
    // 三角形的另一半没有面：打不中（要是拿成了四边形的区段就会打中）
    expect(layer.raycastObject('o:1_5:4', new Vector3(40.8, 0.8, 1), new Vector3(0, 0, -1))).toBeNull();
  });

  it('整体包围盒跟着缩回去', () => {
    const layer = makeLayer();
    fiveObjects(layer);
    expect(layer.getBoundingBox().max.x).toBeCloseTo(41, 6);
    layer.removeObjects(['o:1_4:3', 'o:1_5:4']);
    expect(layer.getBoundingBox().max.x).toBeCloseTo(21, 6);
    expect(layer.getBoundingBox().min.x).toBeCloseTo(0, 6);
  });

  it('不认识的、重复给的对象不理会；一个都没拿掉时什么都不动', () => {
    const layer = makeLayer();
    fiveObjects(layer);
    layer.compile();
    const revision = layer.visibilityRevision;

    expect(layer.removeObjects(['o:9_9:0', ''])).toBe(0);
    expect(layer.removeObjects([])).toBe(0);
    expect(layer.visibilityRevision).toBe(revision);
    expect(layer.getStats().totalObjects).toBe(5);

    expect(layer.removeObjects(['o:1_2:1', 'o:1_2:1', 'o:9_9:0'])).toBe(1);
    expect(layer.visibilityRevision).toBeGreaterThan(revision);
    expect(layer.objectCount).toBe(4);
  });

  it('全部拿掉之后是空图层：能重编、能接着加', () => {
    const layer = makeLayer();
    const scene = new Scene();
    fiveObjects(layer);
    layer.compile();
    layer.addToScene(scene);

    expect(layer.removeObjects(layer.getAllObjectIds())).toBe(5);
    layer.recompile();
    expect(layer.getStats()).toMatchObject({ totalObjects: 0, drawTriangleCount: 0, drawIndexCount: 0 });
    expect(layer.getBoundingBox().isEmpty()).toBe(true);

    layer.addObject('o:2_1:5', 'quad', at(5));
    layer.recompile();
    expect(layer.getStats()).toMatchObject({ totalObjects: 1, drawTriangleCount: 2 });
    expect(layer.getObject('o:2_1:5')).toMatchObject({ objectIndex: 0, primitiveOffset: 0 });
    expect(layer.getObjectMatrix('o:2_1:5')!.elements[12]).toBe(5);
  });

  it('重载三次：每次先加新的、再拿掉旧的，对象数不涨', () => {
    const layer = new DTXLayer({ maxVertices: 64, maxIndices: 128, maxObjects: 4 });
    layer.addGeometry('box', new BoxGeometry(1, 1, 1));
    let counter = 0;
    const load = (): string[] => Array.from({ length: 6 }, (_, index) => {
      const id = `o:3_${index}:${counter++}`;
      layer.addObject(id, 'box', at(index * 2));
      return id;
    });
    let current = load();
    layer.compile();
    for (let round = 0; round < 3; round += 1) {
      const previous = current;
      current = load();
      expect(layer.removeObjects(previous)).toBe(6);
      layer.recompile();
      expect(layer.getStats().totalObjects).toBe(6);
      expect(layer.getAllObjectIds()).toEqual(current);
    }
    expect(layer.getStats().drawTriangleCount).toBe(6 * 12);
    expect(layer.getObjectMatrix(current[5]!)!.elements[12]).toBe(10);
  });

  it('拿掉之后新加的对象接在后面，下标不和留下的撞', () => {
    const layer = makeLayer();
    fiveObjects(layer);
    layer.removeObjects(['o:1_1:0']);
    layer.addObject('o:1_6:5', 'quad', at(50));
    layer.compile();

    expect(layer.getAllObjectIds()).toEqual(['o:1_2:1', 'o:1_3:2', 'o:1_4:3', 'o:1_5:4', 'o:1_6:5']);
    expect(layer.getObject('o:1_6:5')).toMatchObject({ objectIndex: 4, primitiveOffset: 6 });
    expect(layer.getStats()).toMatchObject({ totalObjects: 5, drawTriangleCount: 8 });
    expect(layer.getObjectMatrix('o:1_6:5')!.elements[12]).toBe(50);
    expect(layer.getObjectMatrix('o:1_2:1')!.elements[12]).toBe(10);
  });
});
