import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  PerspectiveCamera,
  Scene,
} from "three";

const { outlineHelpers, MockOutlineHelper } = vi.hoisted(() => {
  const helpers: Array<{
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
  }> = [];

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

vi.mock("../outline/DTXOutlineHelper", () => ({
  DTXOutlineHelper: MockOutlineHelper,
}));

vi.mock("./GPUPicker", () => ({
  GPUPicker: class MockGPUPicker {
    setObjectIndexMapper() {}
    pick() {
      return null;
    }
    dispose() {}
  },
}));

import { DTXSelectionController } from "./DTXSelectionController";

function createQuadGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(
      new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

describe("DTXSelectionController", () => {
  beforeEach(() => {
    outlineHelpers.length = 0;
    vi.clearAllMocks();
  });

  it("highlightMode=both 且 overlay.showEdges=false 时只渲染填充并保留 outline", () => {
    const scene = new Scene();
    const geometry = createQuadGeometry();
    const container = document.createElement("div");
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({ width: 800, height: 600, left: 0, top: 0 }),
    });

    const dtxLayer = {
      getAllObjectsWithBounds: () => [],
      getObjectIdByIndex: () => null,
      getObjectGeometryData: () => ({
        geometry,
        matrix: new Matrix4(),
      }),
      getObjectBoundingBoxInto: () => null,
      hasObject: () => true,
    } as any;

    const controller = new DTXSelectionController({
      dtxLayer,
      scene,
      camera: new PerspectiveCamera(),
      renderer: {} as any,
      container,
      enableOutline: true,
      highlightMode: "both",
      overlayStyle: {
        showEdges: false,
        showFill: true,
        fillOpacity: 0.22,
      },
    });

    controller.select("o:demo:0");

    const overlayGroup = scene.getObjectByName("DTXSelectionOverlay");
    expect(overlayGroup?.children.map((child) => child.name)).toEqual([
      "sel_fill_o:demo:0",
    ]);
    expect(controller.hasOutline()).toBe(true);
    expect(outlineHelpers).toHaveLength(1);
    expect(outlineHelpers[0]?.setOutlinedObjects).toHaveBeenCalledWith([
      "o:demo:0",
    ]);
    expect(outlineHelpers[0]?.getOutlinedObjects()).toEqual(["o:demo:0"]);
  });
});
