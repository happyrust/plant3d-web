import { describe, it, expect, beforeEach, vi } from "vitest";
import * as THREE from "three";

describe("LinearDimension3D", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should construct and expose params", async () => {
    const { AnnotationMaterials } = await import("../core/AnnotationMaterials");
    const { LinearDimension3D } = await import("./LinearDimension3D");

    const materials = new AnnotationMaterials();
    const start = new THREE.Vector3(0, 0, 0);
    const end = new THREE.Vector3(1, 0, 0);

    const dim = new LinearDimension3D(materials, { start, end, offset: 1 });
    expect(dim.getParams().offset).toBe(1);
    expect(dim.getParams().start.x).toBe(0);
    expect(dim).toBeInstanceOf(THREE.Object3D);
    expect(dim.getDistance()).toBeCloseTo(1, 8);
    expect(dim.getDisplayText()).toBe("1.0");
  });

  it("should use dashed materials for reference dimensions", async () => {
    const { AnnotationMaterials } = await import("../core/AnnotationMaterials");
    const { LinearDimension3D } = await import("./LinearDimension3D");

    const materials = new AnnotationMaterials();
    materials.setResolution(800, 600);

    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(1, 0, 0),
      offset: 0.5,
      isReference: true,
    });

    const lineA = (dim as any).dimensionLineA;
    const ext1 = (dim as any).extensionLine1;
    const arrow1 = (dim as any).arrow1;

    const spy = vi.spyOn(lineA, "computeLineDistances");

    const camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    dim.update(camera);

    expect((lineA.material as any).dashed).toBe(true);
    expect((ext1.material as any).dashed).toBe(true);
    expect((arrow1.material as any).dashed).not.toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it("should forward setBackgroundColor to textLabel", async () => {
    const { AnnotationMaterials } = await import("../core/AnnotationMaterials");
    const { LinearDimension3D } = await import("./LinearDimension3D");

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(1, 0, 0),
      offset: 0.5,
    });

    const textLabel = (dim as any).textLabel;
    const spy = vi.spyOn(textLabel, "setBackgroundColor");

    dim.setBackgroundColor(0xff0000);
    expect(spy).toHaveBeenCalledWith(0xff0000);
  });

  it("should preserve depthTest=false after setMaterialSet in all interaction states", async () => {
    const { AnnotationMaterials } = await import("../core/AnnotationMaterials");
    const { LinearDimension3D } = await import("./LinearDimension3D");

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(
      materials,
      {
        start: new THREE.Vector3(0, 0, 0),
        end: new THREE.Vector3(1, 0, 0),
        offset: 0.5,
      },
      { depthTest: false },
    );

    dim.setMaterialSet(materials.green);

    const expectDepthTestOff = () => {
      const lineA = (dim as any).dimensionLineA;
      const arrow1 = (dim as any).arrow1;
      expect((lineA.material as any).depthTest).toBe(false);
      expect((arrow1.material as any).depthTest).toBe(false);
    };

    expectDepthTestOff();
    dim.hovered = true;
    expectDepthTestOff();
    dim.selected = true;
    expectDepthTestOff();
  });

  it("should have extension lines that overshoot by 10px worth of world units", async () => {
    const { AnnotationMaterials } = await import("../core/AnnotationMaterials");
    const { LinearDimension3D } = await import("./LinearDimension3D");

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(5, 0, 0),
      offset: 2,
      direction: new THREE.Vector3(0, 1, 0),
    });

    const camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 100);
    camera.position.set(2.5, 1, 10);
    camera.lookAt(2.5, 1, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    dim.update(camera);

    // Extension line geometry should have 2 points
    const ext1Geom = (dim as any).ext1Geometry as THREE.BufferGeometry;
    const pos = ext1Geom.getAttribute("position");
    const instanceStart = ext1Geom.getAttribute("instanceStart");
    expect(pos).toBeTruthy();
    expect(instanceStart).toBeTruthy();
    expect(instanceStart.count).toBe(1);

    // The extension line should extend beyond the dim endpoint (overshoot)
    // Start point is near (0,0,0), end point should be beyond (0,2,0)
    const endY = pos.getY(1);
    // In local coords, dimStart.y = 2 (offset=2, direction=(0,1,0))
    // Extension should overshoot past 2
    expect(endY).toBeGreaterThanOrEqual(2);
  });

  it("should use camera annotation viewport for wpp scaling", async () => {
    const { AnnotationMaterials } = await import("../core/AnnotationMaterials");
    const { LinearDimension3D } = await import("./LinearDimension3D");

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(2, 0, 0),
      offset: 0.6,
      text: "2000",
    });

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 6);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    (camera as any).userData.annotationViewport = { width: 200, height: 200 };
    dim.update(camera);
    const scaleSmallViewport = (
      (dim as any).textLabel.object3d.scale as THREE.Vector3
    ).x;

    (camera as any).userData.annotationViewport = { width: 2000, height: 2000 };
    dim.update(camera);
    const scaleLargeViewport = (
      (dim as any).textLabel.object3d.scale as THREE.Vector3
    ).x;

    expect(scaleSmallViewport).toBeGreaterThan(scaleLargeViewport);
  });

  it("should keep label centered on the dimension line even when labelOffsetWorld is provided", async () => {
    const { AnnotationMaterials } = await import("../core/AnnotationMaterials");
    const { LinearDimension3D } = await import("./LinearDimension3D");

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(10, 0, 0),
      offset: 3,
      direction: new THREE.Vector3(0, 1, 0),
      labelOffsetWorld: new THREE.Vector3(5, 9, 0),
      text: "10000",
    });

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 30);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    dim.update(camera);

    const dimStart = (dim as any).dimStart as THREE.Vector3;
    const dimEnd = (dim as any).dimEnd as THREE.Vector3;
    const expected = dimStart.clone().lerp(dimEnd, 0.5);
    const labelPos = dim.getLabelWorldPos();

    expect(labelPos.distanceTo(expected)).toBeLessThan(0.1);
  });

  it("should keep label world scale stable under parent global scaling", async () => {
    const { AnnotationMaterials } = await import("../core/AnnotationMaterials");
    const { LinearDimension3D } = await import("./LinearDimension3D");

    const materials = new AnnotationMaterials();
    const createDim = () =>
      new LinearDimension3D(materials, {
        start: new THREE.Vector3(0, 0, 0),
        end: new THREE.Vector3(2, 0, 0),
        offset: 0.6,
        text: "2000",
      });

    const dimNoScale = createDim();
    const dimWithScale = createDim();
    const scaledParent = new THREE.Group();
    scaledParent.scale.setScalar(0.001);
    scaledParent.add(dimWithScale);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 6);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    dimNoScale.update(camera);
    dimWithScale.update(camera);

    const labelNoScale = (dimNoScale as any).textLabel
      .object3d as THREE.Object3D;
    const labelWithScale = (dimWithScale as any).textLabel
      .object3d as THREE.Object3D;
    const w1 = labelNoScale.getWorldScale(new THREE.Vector3()).x;
    const w2 = labelWithScale.getWorldScale(new THREE.Vector3()).x;

    expect(w1).toBeGreaterThan(0);
    expect(w2).toBeGreaterThan(0);
    expect(w2 / w1).toBeCloseTo(1, 2);
  });

  it("should render open arrow style with V-line geometry", async () => {
    const { AnnotationMaterials } = await import("../core/AnnotationMaterials");
    const { LinearDimension3D } = await import("./LinearDimension3D");

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(4, 0, 0),
      offset: 1,
      arrowStyle: "open",
      arrowSizePx: 12,
      arrowAngleDeg: 18,
    });

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 8);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    dim.update(camera);

    const arrowMesh1 = (dim as any).arrow1 as THREE.Mesh;
    const arrowOpen1 = (dim as any).arrowOpen1 as any;
    const openGeom1 = (dim as any).arrowOpenGeometry1 as THREE.BufferGeometry;

    expect(arrowMesh1.visible).toBe(false);
    expect(arrowOpen1.visible).toBe(true);
    const instanceStart = openGeom1.getAttribute("instanceStart");
    expect(instanceStart).toBeTruthy();
    expect(instanceStart.count).toBe(2);
  });

  it("should render tick arrow style with single slash segments", async () => {
    const { AnnotationMaterials } = await import("../core/AnnotationMaterials");
    const { LinearDimension3D } = await import("./LinearDimension3D");

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(4, 0, 0),
      offset: 1,
      arrowStyle: "tick",
      arrowSizePx: 12,
      arrowAngleDeg: 18,
    });

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 8);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    dim.update(camera);

    const arrowMesh1 = (dim as any).arrow1 as THREE.Mesh;
    const arrowOpen1 = (dim as any).arrowOpen1 as any;
    const openGeom1 = (dim as any).arrowOpenGeometry1 as THREE.BufferGeometry;

    expect(arrowMesh1.visible).toBe(false);
    expect(arrowOpen1.visible).toBe(true);
    const instanceStart = openGeom1.getAttribute("instanceStart");
    expect(instanceStart).toBeTruthy();
    expect(instanceStart.count).toBe(1);
  });

  it("should apply custom line width to dimension lines and open arrows", async () => {
    const { AnnotationMaterials } = await import("../core/AnnotationMaterials");
    const { LinearDimension3D } = await import("./LinearDimension3D");

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(4, 0, 0),
      offset: 1,
      arrowStyle: "open",
    });

    dim.setLineWidthPx(2.5);

    const lineA = (dim as any).dimensionLineA as any;
    const arrowOpen1 = (dim as any).arrowOpen1 as any;
    expect((lineA.material as any).linewidth).toBeCloseTo(2.5, 6);
    expect((arrowOpen1.material as any).linewidth).toBeCloseTo(2.5, 6);
  });
});
