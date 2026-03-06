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
    showDimOverall: ref(true),
    showDimPort: ref(false),
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
});
