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
    expect(vis.showDimOverall.value).toBe(false);
    expect(vis.showDimPort.value).toBe(false);
    expect(vis.showCutTubis.value).toBe(true);
    expect(vis.showElbows.value).toBe(true);
    expect(vis.showBranches.value).toBe(true);
    expect(vis.showFlanges.value).toBe(true);
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
    expect(vis.showDimOverall.value).toBe(false);
    expect(vis.showDimPort.value).toBe(false);
    expect(vis.showCutTubis.value).toBe(true);
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

  it("construction 下 tags 应默认可见", () => {
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
      dims: [],
      welds: [],
      slopes: [],
      bends: [],
      cut_tubis: [],
      fittings: [],
      tags: [
        {
          id: "tag-1",
          refno: "tag-1",
          noun: "TUBI",
          role: "spec",
          text: "DN50",
          position: [100, 0, 0],
        },
      ],
      stats: {
        segments_count: 0,
        dims_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
        cut_tubis_count: 0,
        fittings_count: 0,
        tags_count: 1,
      },
    };

    vis.renderBranch(data);

    const root = viewer.scene.children.find(
      (child: any) => child?.name === "dtx-mbd-pipe-v2",
    ) as any;
    const tagObject = root?.children?.find(
      (child: any) => child?.userData?.mbdAuxKind === "tag",
    );

    expect(tagObject).toBeTruthy();
    expect(tagObject?.visible).toBe(true);
  });

  it("fitting 缺少合法锚点时应抑制并计数", () => {
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
      dims: [],
      welds: [],
      slopes: [],
      bends: [],
      cut_tubis: [],
      fittings: [
        {
          id: "fit-1",
          refno: "fit-1",
          noun: "TEE",
          kind: "tee",
          anchor_point: [Number.NaN, 0, 0] as any,
        },
      ],
      tags: [],
      stats: {
        segments_count: 0,
        dims_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
        cut_tubis_count: 0,
        fittings_count: 1,
        tags_count: 0,
      },
    };

    vis.renderBranch(data);

    const root = viewer.scene.children.find(
      (child: any) => child?.name === "dtx-mbd-pipe-v2",
    ) as any;
    const fittingObject = root?.children?.find(
      (child: any) => child?.userData?.mbdAuxKind === "fitting",
    );

    expect(fittingObject).toBeFalsy();
    expect(vis.suppressedWrongLineCount.value).toBe(1);
  });

  it("开启 showAnchorDebug 后应显示锚点调试几何", async () => {
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
      dims: [
        {
          id: "dim-1",
          kind: "chain",
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: "1000",
          layout_hint: {
            anchor_point: [200, 100, 0],
            offset_dir: [0, 1, 0],
            primary_axis: [1, 0, 0],
            char_dir: [0, 0, 1],
            label_role: "chain",
            avoid_line_of_sight: true,
            owner_segment_id: "seg-1",
            offset_level: 1,
            suppress_reason: null,
          },
        },
      ],
      welds: [],
      slopes: [],
      bends: [],
      cut_tubis: [],
      fittings: [],
      tags: [],
      stats: {
        segments_count: 0,
        dims_count: 1,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
        cut_tubis_count: 0,
        fittings_count: 0,
        tags_count: 0,
      },
    };

    vis.renderBranch(data);

    const root = viewer.scene.children.find(
      (child: any) => child?.name === "dtx-mbd-pipe-v2",
    ) as any;
    const debugBefore = root?.children?.filter(
      (child: any) => child?.userData?.mbdAuxKind === "debug-anchor",
    ) ?? [];
    expect(debugBefore.length).toBeGreaterThan(0);
    expect(debugBefore.every((child: any) => child.visible === false)).toBe(true);

    vis.showAnchorDebug.value = true;
    await nextTick();

    const debugAfter = root?.children?.filter(
      (child: any) => child?.userData?.mbdAuxKind === "debug-anchor",
    ) ?? [];
    expect(debugAfter.length).toBeGreaterThan(0);
    expect(debugAfter.every((child: any) => child.visible === true)).toBe(true);
  });

  it("开启 showOwnerSegmentDebug 后应显示所属段调试几何", async () => {
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
          id: "seg-1",
          refno: "seg-1",
          noun: "TUBI",
          arrive: [0, 0, 0],
          leave: [1000, 0, 0],
          length: 1000,
          straight_length: 1000,
        },
      ],
      dims: [
        {
          id: "dim-1",
          kind: "chain",
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: "1000",
          layout_hint: {
            anchor_point: [200, 100, 0],
            offset_dir: [0, 1, 0],
            primary_axis: [1, 0, 0],
            char_dir: [0, 0, 1],
            label_role: "chain",
            avoid_line_of_sight: true,
            owner_segment_id: "seg-1",
            offset_level: 1,
            suppress_reason: null,
          },
        },
      ],
      welds: [],
      slopes: [],
      bends: [],
      cut_tubis: [],
      fittings: [],
      tags: [],
      stats: {
        segments_count: 1,
        dims_count: 1,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
        cut_tubis_count: 0,
        fittings_count: 0,
        tags_count: 0,
      },
    };

    vis.renderBranch(data);

    const root = viewer.scene.children.find(
      (child: any) => child?.name === "dtx-mbd-pipe-v2",
    ) as any;
    const debugBefore = root?.children?.filter(
      (child: any) => child?.userData?.mbdAuxKind === "debug-owner-segment",
    ) ?? [];
    expect(debugBefore.length).toBe(1);
    expect(debugBefore[0]?.visible).toBe(false);

    vis.showOwnerSegmentDebug.value = true;
    await nextTick();

    const debugAfter = root?.children?.filter(
      (child: any) => child?.userData?.mbdAuxKind === "debug-owner-segment",
    ) ?? [];
    expect(debugAfter.length).toBe(1);
    expect(debugAfter[0]?.visible).toBe(true);
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
