import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
} from 'three';

const { outlineHelpers, MockOutlineHelper } = vi.hoisted(() => {
  const helpers: {
    outlinedObjects: string[];
    init: ReturnType<typeof vi.fn>;
    setGeometryGetter: ReturnType<typeof vi.fn>;
    setStyle: ReturnType<typeof vi.fn>;
    setEnabled: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    setOutlinedObjects: ReturnType<typeof vi.fn>;
    getOutlinedObjects: ReturnType<typeof vi.fn>;
  }[] = [];

  class OutlineHelper {
    outlinedObjects: string[] = [];
    init = vi.fn();
    setGeometryGetter = vi.fn();
    setStyle = vi.fn();
    setEnabled = vi.fn();
    render = vi.fn();
    resize = vi.fn();
    dispose = vi.fn();

    constructor() {
      helpers.push(this);
    }

    setOutlinedObjects = vi.fn((objectIds: string[]) => {
      this.outlinedObjects = [...objectIds];
    });

    getOutlinedObjects = vi.fn(() => [...this.outlinedObjects]);
  }

  return {
    outlineHelpers: helpers,
    MockOutlineHelper: OutlineHelper,
  };
});

vi.mock('../outline/DTXOutlineHelper', () => ({
  DTXOutlineHelper: MockOutlineHelper,
}));

vi.mock('./GPUPicker', () => ({
  GPUPicker: class MockGPUPicker {
    setObjectIndexMapper() {}
    pick() {
      return null;
    }
    dispose() {}
  },
}));

const { kdTreeState, MockObjectsKdTree } = vi.hoisted(() => {
  const state: { rayCandidates: string[] } = { rayCandidates: [] };

  class ObjectsKdTree {
    clear = vi.fn();
    addObjects = vi.fn();
    build = vi.fn();
    queryRay = vi.fn(() => [...state.rayCandidates]);
  }

  return { kdTreeState: state, MockObjectsKdTree: ObjectsKdTree };
});

vi.mock('./ObjectsKdTree', () => ({
  ObjectsKdTree: MockObjectsKdTree,
}));

import { DTXSelectionController } from './DTXSelectionController';

function createQuadGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

function createMockDtxLayer(
  geometry: BufferGeometry,
  rayHitDistances: Record<string, number | null> = {},
) {
  return {
    getAllObjectsWithBounds: () => [],
    getObjectIdByIndex: () => null,
    getObjectGeometryData: () => ({
      geometry,
      matrix: new Matrix4(),
    }),
    getObjectBoundingBoxInto: () => null,
    hasObject: () => true,
    setObjectColor: vi.fn(),
    resetObjectColor: vi.fn(),
    raycastObject: vi.fn((objectId: string) => {
      const distance = rayHitDistances[objectId];
      if (typeof distance !== 'number') return null;
      return {
        point: new Vector3(0, 0, -distance),
        distance,
        triangle: [new Vector3(), new Vector3(), new Vector3()],
      };
    }),
  } as any;
}

function createPickController(rayHitDistances: Record<string, number | null>) {
  const container = document.createElement('div');
  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({ width: 800, height: 600, left: 0, top: 0 }),
  });

  return new DTXSelectionController({
    dtxLayer: createMockDtxLayer(createQuadGeometry(), rayHitDistances),
    scene: new Scene(),
    camera: new PerspectiveCamera(),
    renderer: {} as any,
    container,
    enableOutline: false,
  });
}

describe('DTXSelectionController', () => {
  beforeEach(() => {
    outlineHelpers.length = 0;
    kdTreeState.rayCandidates = [];
    vi.clearAllMocks();
  });

  describe('pickPoints', () => {
    it('按距离由近到远返回全部命中，并跳过射线未真正命中的候选', () => {
      kdTreeState.rayCandidates = ['o:far:0', 'o:miss:0', 'o:near:0', 'o:mid:0'];
      const controller = createPickController({
        'o:far:0': 30,
        'o:miss:0': null,
        'o:near:0': 5,
        'o:mid:0': 12,
      });

      const hits = controller.pickPoints(new Vector2(400, 300));

      expect(hits.map((hit) => hit.objectId)).toEqual(['o:near:0', 'o:mid:0', 'o:far:0']);
      expect(hits.map((hit) => hit.distance)).toEqual([5, 12, 30]);
    });

    it('limit 截断的是最近的 N 个，而不是候选集的前 N 个', () => {
      kdTreeState.rayCandidates = ['o:far:0', 'o:near:0', 'o:mid:0'];
      const controller = createPickController({
        'o:far:0': 30,
        'o:near:0': 5,
        'o:mid:0': 12,
      });

      const hits = controller.pickPoints(new Vector2(400, 300), { limit: 2 });

      expect(hits.map((hit) => hit.objectId)).toEqual(['o:near:0', 'o:mid:0']);
    });

    it('没有候选时返回空数组', () => {
      const controller = createPickController({});

      expect(controller.pickPoints(new Vector2(400, 300))).toEqual([]);
    });
  });

  describe('pickPoint 保持原有单命中语义', () => {
    it('仍然只返回最近命中，与 pickPoints 的首项一致', () => {
      kdTreeState.rayCandidates = ['o:far:0', 'o:near:0'];
      const controller = createPickController({ 'o:far:0': 30, 'o:near:0': 5 });

      const nearest = controller.pickPoint(new Vector2(400, 300));

      expect(nearest?.objectId).toBe('o:near:0');
      expect(nearest?.distance).toBe(5);
      expect(nearest).toEqual(controller.pickPoints(new Vector2(400, 300))[0]);
    });

    it('全部候选都未命中时返回 null', () => {
      kdTreeState.rayCandidates = ['o:miss:0'];
      const controller = createPickController({ 'o:miss:0': null });

      expect(controller.pickPoint(new Vector2(400, 300))).toBeNull();
    });
  });

  it('highlightMode=both 且 overlay.showEdges=false 时只渲染填充并保留 outline', () => {
    const scene = new Scene();
    const geometry = createQuadGeometry();
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ width: 800, height: 600, left: 0, top: 0 }),
    });

    const dtxLayer = createMockDtxLayer(geometry);

    const controller = new DTXSelectionController({
      dtxLayer,
      scene,
      camera: new PerspectiveCamera(),
      renderer: {} as any,
      container,
      enableOutline: true,
      highlightMode: 'both',
      overlayStyle: {
        showEdges: false,
        showFill: true,
        fillOpacity: 0.22,
      },
    });

    controller.select('o:demo:0');

    const overlayGroup = scene.getObjectByName('DTXSelectionOverlay');
    expect(overlayGroup?.children.map((child) => child.name)).toEqual([
      'sel_fill_o:demo:0',
    ]);
    expect(controller.hasOutline()).toBe(true);
    expect(outlineHelpers).toHaveLength(1);
    expect(outlineHelpers[0]?.setOutlinedObjects).toHaveBeenCalledWith([
      'o:demo:0',
    ]);
    expect(outlineHelpers[0]?.getOutlinedObjects()).toEqual(['o:demo:0']);
  });

  it('允许通过 options 自定义 outline 样式', () => {
    const scene = new Scene();
    const geometry = createQuadGeometry();
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ width: 800, height: 600, left: 0, top: 0 }),
    });

    const dtxLayer = createMockDtxLayer(geometry);

    new DTXSelectionController({
      dtxLayer,
      scene,
      camera: new PerspectiveCamera(),
      renderer: {} as any,
      container,
      enableOutline: true,
      highlightMode: 'both',
      outlineStyle: {
        edgeColor: 0x36f97b,
        edgeStrength: 3.2,
        edgeGlow: 0.2,
        edgeThickness: 1.4,
      },
    } as any);

    expect(outlineHelpers).toHaveLength(1);
    expect(outlineHelpers[0]?.setStyle).toHaveBeenCalledWith({
      edgeColor: 0x36f97b,
      edgeStrength: 3.2,
      edgeGlow: 0.2,
      edgeThickness: 1.4,
    });
  });
});
