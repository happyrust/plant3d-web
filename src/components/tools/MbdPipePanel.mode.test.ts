import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, ref } from "vue";

vi.mock("@/composables/useUnitSettingsStore", () => ({
  useUnitSettingsStore: () => ({
    displayUnit: ref("mm"),
    precision: ref(1),
    setDisplayUnit: vi.fn(),
    setPrecision: vi.fn(),
  }),
}));

import MbdPipePanel from "./MbdPipePanel.vue";

function createVisStub() {
  return {
    uiTab: ref("settings"),
    mbdViewMode: ref("construction"),
    dimTextMode: ref("backend"),
    dimOffsetScale: ref(1),
    dimLabelT: ref(0.5),
    dimMode: ref("classic"),
    rebarvizArrowSizePx: ref(16),
    rebarvizArrowAngleDeg: ref(18),
    rebarvizArrowStyle: ref("open"),
    rebarvizLineWidthPx: ref(2.2),
    isVisible: ref(true),
    showDims: ref(true),
    showDimSegment: ref(false),
    showDimChain: ref(true),
    showDimOverall: ref(false),
    showDimPort: ref(false),
    showCutTubis: ref(true),
    showElbows: ref(true),
    showBranches: ref(true),
    showFlanges: ref(true),
    showAnchorDebug: ref(false),
    showOwnerSegmentDebug: ref(false),
    suppressedWrongLineCount: ref(0),
    showWelds: ref(true),
    showSlopes: ref(true),
    showBends: ref(false),
    showSegments: ref(false),
    showLabels: ref(true),
    currentData: ref(null),
    activeItemId: ref<string | null>(null),
    renderBranch: vi.fn(),
    renderDemoDims: vi.fn(),
    clearAll: vi.fn(),
    flyTo: vi.fn(),
    updateLabelPositions: vi.fn(),
    renderLabels: vi.fn(),
    initCSS2DRenderer: vi.fn(),
    highlightItem: vi.fn(),
    setResolution: vi.fn(),
    dispose: vi.fn(),
    updateDimOverride: vi.fn(),
    resetDimOverride: vi.fn(),
    getDimAnnotations: vi.fn(() => new Map()),
    getWeldAnnotations: vi.fn(() => new Map()),
    getSlopeAnnotations: vi.fn(() => new Map()),
    getBendAnnotations: vi.fn(() => new Map()),
    applyModeDefaults: vi.fn(),
    resetToCurrentModeDefaults: vi.fn(),
  } as any;
}

describe("MbdPipePanel mode controls", () => {
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    host?.remove();
    host = null;
  });

  it("应展示当前模式并支持切换与重置", async () => {
    const vis = createVisStub();
    host = document.createElement("div");
    document.body.appendChild(host);

    const app = createApp(MbdPipePanel, { vis });
    app.mount(host);
    await nextTick();

    const modeSelect = host.querySelector(
      '[data-testid="mbd-view-mode"]',
    ) as HTMLSelectElement | null;
    expect(modeSelect).toBeTruthy();
    expect(modeSelect?.value).toBe("construction");

    modeSelect!.value = "inspection";
    modeSelect!.dispatchEvent(new Event("change"));
    await nextTick();

    expect(vis.mbdViewMode.value).toBe("inspection");

    const resetButton = host.querySelector(
      '[data-testid="mbd-view-mode-reset"]',
    ) as HTMLButtonElement | null;
    expect(resetButton).toBeTruthy();

    resetButton!.click();
    expect(vis.resetToCurrentModeDefaults).toHaveBeenCalledTimes(1);

    app.unmount();
  });

  it("应基于 fittings.kind 统计弯头、支管和法兰分类", async () => {
    const vis = createVisStub();
    vis.currentData.value = {
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
        { id: "f1", refno: "f1", noun: "FITT", kind: "elbo", anchor_point: [0, 0, 0] },
        { id: "f2", refno: "f2", noun: "FITT", kind: "tee", anchor_point: [1, 0, 0] },
        { id: "f3", refno: "f3", noun: "FITT", kind: "flan", anchor_point: [2, 0, 0] },
        { id: "f4", refno: "f4", noun: "FITT", kind: "bend", anchor_point: [3, 0, 0] },
      ],
      tags: [],
      stats: {
        segments_count: 0,
        dims_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
        cut_tubis_count: 0,
        fittings_count: 4,
        tags_count: 0,
      },
    } as any;

    host = document.createElement("div");
    document.body.appendChild(host);

    const app = createApp(MbdPipePanel, { vis });
    app.mount(host);
    await nextTick();

    expect(host.textContent).toContain("elbows=2");
    expect(host.textContent).toContain("branches=1");
    expect(host.textContent).toContain("flanges=1");

    app.unmount();
  });
});
