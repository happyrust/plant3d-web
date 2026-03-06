import { beforeEach, describe, expect, it, vi } from "vitest";
import { Matrix4, PerspectiveCamera, Scene } from "three";
import { nextTick, ref, shallowRef } from "vue";

import type { MbdPipeData } from "@/api/mbdPipeApi";

import { useMbdPipeAnnotationThree } from "./useMbdPipeAnnotationThree";

describe("useMbdPipeAnnotationThree.flyTo", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("默认显示施工视图相关标注", () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    expect(vis.mbdViewMode.value).toBe("construction");
    expect(vis.dimMode.value).toBe("rebarviz");
    expect(vis.showDimSegment.value).toBe(false);
    expect(vis.showDimChain.value).toBe(true);
    expect(vis.showDimOverall.value).toBe(true);
    expect(vis.showDimPort.value).toBe(false);
    expect(vis.showWelds.value).toBe(true);
    expect(vis.showSlopes.value).toBe(true);
    expect(vis.showBends.value).toBe(false);
    expect(vis.showSegments.value).toBe(false);
  });

  it("applyModeDefaults 应切换 construction 与 inspection 的默认显示映射", () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    vis.applyModeDefaults("inspection");
    expect(vis.mbdViewMode.value).toBe("inspection");
    expect(vis.dimMode.value).toBe("rebarviz");
    expect(vis.showDimSegment.value).toBe(false);
    expect(vis.showDimChain.value).toBe(false);
    expect(vis.showDimOverall.value).toBe(false);
    expect(vis.showDimPort.value).toBe(true);
    expect(vis.showWelds.value).toBe(false);
    expect(vis.showSlopes.value).toBe(false);
    expect(vis.showBends.value).toBe(false);
    expect(vis.showSegments.value).toBe(false);

    vis.applyModeDefaults("construction");
    expect(vis.mbdViewMode.value).toBe("construction");
    expect(vis.dimMode.value).toBe("rebarviz");
    expect(vis.showDimChain.value).toBe(true);
    expect(vis.showDimOverall.value).toBe(true);
    expect(vis.showDimPort.value).toBe(false);
    expect(vis.showWelds.value).toBe(true);
    expect(vis.showSlopes.value).toBe(true);
  });

  it("resetToCurrentModeDefaults 应回到当前模式默认态", () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    vis.mbdViewMode.value = "inspection";
    vis.showDimPort.value = false;
    vis.showWelds.value = true;
    vis.dimMode.value = "classic";

    vis.resetToCurrentModeDefaults();

    expect(vis.mbdViewMode.value).toBe("inspection");
    expect(vis.dimMode.value).toBe("rebarviz");
    expect(vis.showDimPort.value).toBe(true);
    expect(vis.showWelds.value).toBe(false);
    expect(vis.showSlopes.value).toBe(false);
  });

  it("密集端口尺寸应自动错位排布标签", () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const data: MbdPipeData = {
      input_refno: "24381_145018",
      branch_refno: "24381_145018",
      branch_name: "BRAN-TEST",
      branch_attrs: {},
      segments: [],
      welds: [],
      slopes: [],
      bends: [],
      dims: [
        {
          id: "port-1",
          kind: "port",
          start: [0, 0, 0],
          end: [220, 0, 0],
          length: 220,
          text: "220",
        },
        {
          id: "port-2",
          kind: "port",
          start: [260, 20, 0],
          end: [480, 20, 0],
          length: 220,
          text: "220",
        },
        {
          id: "port-3",
          kind: "port",
          start: [520, 40, 0],
          end: [740, 40, 0],
          length: 220,
          text: "220",
        },
      ],
      stats: {
        segments_count: 0,
        dims_count: 3,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
      },
    };

    vis.renderBranch(data);

    const p1 = vis.getDimAnnotations().get("port-1")?.getParams();
    const p2 = vis.getDimAnnotations().get("port-2")?.getParams();
    const p3 = vis.getDimAnnotations().get("port-3")?.getParams();

    expect(p1).toBeTruthy();
    expect(p2).toBeTruthy();
    expect(p3).toBeTruthy();
    expect(p1?.labelT).not.toBeCloseTo(p2?.labelT ?? 0.5, 6);
    expect(p2?.labelT).not.toBeCloseTo(p3?.labelT ?? 0.5, 6);
  });

  it("密集端口尺寸应自动稀疏显示", () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );
    vis.showDimPort.value = true;

    const data: MbdPipeData = {
      input_refno: "24381_145018",
      branch_refno: "24381_145018",
      branch_name: "BRAN-TEST",
      branch_attrs: {},
      segments: [],
      welds: [],
      slopes: [],
      bends: [],
      dims: [
        { id: "p1", kind: "port", start: [0, 0, 0], end: [210, 0, 0], length: 210, text: "210" },
        { id: "p2", kind: "port", start: [15, 10, 0], end: [225, 10, 0], length: 210, text: "210" },
        { id: "p3", kind: "port", start: [30, 20, 0], end: [240, 20, 0], length: 210, text: "210" },
        { id: "p4", kind: "port", start: [45, 30, 0], end: [255, 30, 0], length: 210, text: "210" },
      ],
      stats: {
        segments_count: 0,
        dims_count: 4,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
      },
    };

    vis.renderBranch(data);

    const visibleCount = [...vis.getDimAnnotations().values()].filter(
      (d) => d.visible,
    ).length;
    expect(visibleCount).toBeLessThan(4);
    expect(visibleCount).toBeGreaterThan(0);
  });

  it("仅有 bends 数据时也应触发 flyTo", () => {
    const flyTo = vi.fn();
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo,
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const data: MbdPipeData = {
      input_refno: "24381_145018",
      branch_refno: "24381_145018",
      branch_name: "BRAN-TEST",
      branch_attrs: {},
      segments: [],
      dims: [],
      welds: [],
      slopes: [],
      bends: [
        {
          id: "bend-1",
          refno: "24381_145019",
          noun: "ELBO",
          angle: 90,
          radius: 250,
          work_point: [0, 0, 0],
          face_center_1: [1000, 0, 0],
          face_center_2: [0, 1000, 0],
        },
      ],
      stats: {
        segments_count: 0,
        dims_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 1,
      },
    };

    vis.renderBranch(data);
    vis.flyTo();

    expect(flyTo).toHaveBeenCalledTimes(1);
  });

  it("切换 dimMode 重建后应保持当前高亮项", async () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );
    vis.dimMode.value = "rebarviz";
    await nextTick();
    await nextTick();

    const data: MbdPipeData = {
      input_refno: "24381_145018",
      branch_refno: "24381_145018",
      branch_name: "BRAN-TEST",
      branch_attrs: {},
      segments: [],
      welds: [],
      slopes: [],
      bends: [],
      dims: [
        {
          id: "dim-1",
          kind: "segment",
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: "1000",
        },
      ],
      stats: {
        segments_count: 0,
        dims_count: 1,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
      },
    };

    vis.renderBranch(data);
    vis.highlightItem("dim-1");

    const before = vis.getDimAnnotations().get("dim-1");
    expect(before).toBeTruthy();
    expect(before?.highlighted).toBe(true);

    vis.dimMode.value = "classic";
    await nextTick();
    await nextTick();

    const after = vis.getDimAnnotations().get("dim-1");
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
    expect(after?.highlighted).toBe(true);
  });

  it("切换 dimMode 时 dim/weld/slope/bend 文字样式应同步切换", async () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const data: MbdPipeData = {
      input_refno: "24381_145018",
      branch_refno: "24381_145018",
      branch_name: "BRAN-TEST",
      branch_attrs: {},
      segments: [
        {
          id: "s1",
          refno: "S:1",
          noun: "STRA",
          arrive: [0, 0, 0],
          leave: [1000, 0, 0],
          length: 1000,
          straight_length: 1000,
        },
      ],
      dims: [
        {
          id: "dim-1",
          kind: "segment",
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: "1000",
        },
      ],
      welds: [
        {
          id: "weld-1",
          position: [1000, 0, 0],
          weld_type: "BW",
          is_shop: false,
          label: "W1",
          left_refno: "S:1",
          right_refno: "S:2",
        },
      ],
      slopes: [
        {
          id: "slope-1",
          start: [0, 0, 0],
          end: [1000, 0, 0],
          slope: 0.01,
          text: "1%",
        },
      ],
      bends: [
        {
          id: "bend-1",
          refno: "B:1",
          noun: "ELBO",
          angle: 90,
          radius: 250,
          work_point: [1000, 0, 0],
          face_center_1: [1100, 0, 0],
          face_center_2: [1000, 100, 0],
        },
      ],
      stats: {
        segments_count: 1,
        dims_count: 1,
        welds_count: 1,
        slopes_count: 1,
        bends_count: 1,
      },
    };

    const getLabelStyle = (a: any): string | null =>
      a?.textLabel?.getRenderStyle?.() ?? a?.textLabel?.renderStyle ?? null;

    vis.renderBranch(data);

    expect(getLabelStyle(vis.getDimAnnotations().get("dim-1"))).toBe(
      "rebarviz",
    );
    expect(getLabelStyle(vis.getWeldAnnotations().get("weld-1"))).toBe(
      "rebarviz",
    );
    expect(getLabelStyle(vis.getSlopeAnnotations().get("slope-1"))).toBe(
      "rebarviz",
    );
    expect(getLabelStyle(vis.getBendAnnotations().get("bend-1"))).toBe(
      "rebarviz",
    );

    vis.dimMode.value = "classic";
    await nextTick();
    await nextTick();

    expect(getLabelStyle(vis.getDimAnnotations().get("dim-1"))).toBe(
      "solvespace",
    );
    expect(getLabelStyle(vis.getWeldAnnotations().get("weld-1"))).toBe(
      "solvespace",
    );
    expect(getLabelStyle(vis.getSlopeAnnotations().get("slope-1"))).toBe(
      "solvespace",
    );
    expect(getLabelStyle(vis.getBendAnnotations().get("bend-1"))).toBe(
      "solvespace",
    );

    vis.dimMode.value = "rebarviz";
    await nextTick();
    await nextTick();

    expect(getLabelStyle(vis.getDimAnnotations().get("dim-1"))).toBe(
      "rebarviz",
    );
    expect(getLabelStyle(vis.getWeldAnnotations().get("weld-1"))).toBe(
      "rebarviz",
    );
    expect(getLabelStyle(vis.getSlopeAnnotations().get("slope-1"))).toBe(
      "rebarviz",
    );
    expect(getLabelStyle(vis.getBendAnnotations().get("bend-1"))).toBe(
      "rebarviz",
    );
  });

  it("rebarviz 箭头参数调整后应即时刷新已渲染尺寸", async () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );
    vis.dimMode.value = "rebarviz";
    await nextTick();
    await nextTick();

    const data: MbdPipeData = {
      input_refno: "24381_145018",
      branch_refno: "24381_145018",
      branch_name: "BRAN-TEST",
      branch_attrs: {},
      segments: [],
      welds: [],
      slopes: [],
      bends: [],
      dims: [
        {
          id: "dim-1",
          kind: "segment",
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: "1000",
        },
      ],
      stats: {
        segments_count: 0,
        dims_count: 1,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
      },
    };

    vis.renderBranch(data);
    expect(vis.getDimAnnotations().get("dim-1")).toBeTruthy();

    (vis as any).rebarvizArrowStyle.value = "tick";
    (vis as any).rebarvizArrowSizePx.value = 20;
    (vis as any).rebarvizArrowAngleDeg.value = 24;
    (vis as any).rebarvizLineWidthPx.value = 3;
    await nextTick();
    await nextTick();

    const updated = vis.getDimAnnotations().get("dim-1");
    expect(updated?.getParams().arrowStyle).toBe("tick");
    expect(updated?.getParams().arrowSizePx).toBe(20);
    expect(updated?.getParams().arrowAngleDeg).toBe(24);
    expect((updated as any)?.materialSet?.fatLine?.linewidth).toBe(3);
  });
});
