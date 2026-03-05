import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { SolveSpaceBillboardVectorText } from "./SolveSpaceBillboardVectorText";

const fakeFont = {
  getWidth: (_capHeight: number, text: string) => Math.max(1, text.length * 6),
  getCapHeight: (capHeight: number) => capHeight,
  trace2D: (
    _capHeight: number,
    originX: number,
    originY: number,
    _text: string,
    cb: (ax: number, ay: number, bx: number, by: number) => void,
  ) => {
    cb(originX, originY, originX + 4, originY + 6);
  },
};

describe("SolveSpaceBillboardVectorText", () => {
  it("应在 solvespace/rebarviz 风格间正确切换", async () => {
    const normal = new THREE.LineBasicMaterial({ color: 0x22c55e });
    const hovered = new THREE.LineBasicMaterial({ color: 0xffff00 });
    const selected = new THREE.LineBasicMaterial({ color: 0xff0000 });

    const label = new SolveSpaceBillboardVectorText({
      text: "1000",
      materialNormal: normal,
      materialHovered: hovered,
      materialSelected: selected,
      renderStyle: "solvespace",
      font: Promise.resolve(fakeFont as any),
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(label.getRenderStyle()).toBe("solvespace");
    expect(label.getExtentsPx().height).toBeCloseTo(11.5, 2);
    expect((label as any).line?.visible).toBe(true);
    expect((label as any).haloLine?.visible).toBe(false);
    expect((label as any).line?.renderOrder).toBe(910);
    expect(
      ((label as any).line?.material as THREE.LineBasicMaterial)?.depthTest,
    ).toBe(true);

    label.setRenderStyle("rebarviz");

    expect(label.getRenderStyle()).toBe("rebarviz");
    expect(label.getExtentsPx().height).toBeGreaterThanOrEqual(16);
    expect((label as any).bgMesh?.visible).toBe(false);
    expect((label as any).haloLine?.visible).toBe(true);
    expect((label as any).line?.visible).toBe(false);
    expect((label as any).spriteMesh?.visible).toBe(true);
    expect((label as any).line?.renderOrder).toBe(922);
    expect((label as any).haloLine?.renderOrder).toBe(921);
    expect(
      ((label as any).line?.material as THREE.LineBasicMaterial)?.depthTest,
    ).toBe(false);

    label.dispose();
    normal.dispose();
    hovered.dispose();
    selected.dispose();
  });
});
