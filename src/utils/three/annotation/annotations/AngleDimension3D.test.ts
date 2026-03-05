import { describe, it, expect, beforeEach, vi } from "vitest";
import * as THREE from "three";

describe("AngleDimension3D", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should compute angle text by default", async () => {
    const { AnnotationMaterials } = await import("../core/AnnotationMaterials");
    const { AngleDimension3D } = await import("./AngleDimension3D");

    const materials = new AnnotationMaterials();
    const v = new THREE.Vector3(0, 0, 0);
    const p1 = new THREE.Vector3(1, 0, 0);
    const p2 = new THREE.Vector3(0, 1, 0);

    const dim = new AngleDimension3D(materials, {
      vertex: v,
      point1: p1,
      point2: p2,
      arcRadius: 1,
      decimals: 0,
    });
    const angle = dim.getAngleDegrees();
    expect(angle).toBeCloseTo(90, 5);
    expect(dim.getDisplayText()).toBe("90°");
  });

  it("should use dashed materials for reference dimensions", async () => {
    const { AnnotationMaterials } = await import("../core/AnnotationMaterials");
    const { AngleDimension3D } = await import("./AngleDimension3D");

    const materials = new AnnotationMaterials();
    materials.setResolution(800, 600);

    const dim = new AngleDimension3D(materials, {
      vertex: new THREE.Vector3(0, 0, 0),
      point1: new THREE.Vector3(1, 0, 0),
      point2: new THREE.Vector3(0, 1, 0),
      arcRadius: 1,
      decimals: 0,
      isReference: true,
    });

    const ray1 = (dim as any).ray1;
    const arcLine = (dim as any).arcLine;
    const arrow1 = (dim as any).arrow1;

    const spy = vi.spyOn(ray1, "computeLineDistances");

    const camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    dim.update(camera);

    expect((ray1.material as any).dashed).toBe(true);
    expect((arcLine.material as any).dashed).toBe(true);
    expect((arrow1.material as any).dashed).not.toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it("should use camera annotation viewport for wpp scaling", async () => {
    const { AnnotationMaterials } = await import("../core/AnnotationMaterials");
    const { AngleDimension3D } = await import("./AngleDimension3D");

    const materials = new AnnotationMaterials();
    const dim = new AngleDimension3D(materials, {
      vertex: new THREE.Vector3(0, 0, 0),
      point1: new THREE.Vector3(1, 0, 0),
      point2: new THREE.Vector3(0, 1, 0),
      arcRadius: 1,
      text: "90°",
    });

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 6);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    (camera as any).userData.annotationViewport = { width: 220, height: 220 };
    dim.update(camera);
    const scaleSmallViewport = (
      (dim as any).textLabel.object3d.scale as THREE.Vector3
    ).x;

    (camera as any).userData.annotationViewport = { width: 2200, height: 2200 };
    dim.update(camera);
    const scaleLargeViewport = (
      (dim as any).textLabel.object3d.scale as THREE.Vector3
    ).x;

    expect(scaleSmallViewport).toBeGreaterThan(scaleLargeViewport);
  });

  it("should keep angle label world scale stable under parent global scaling", async () => {
    const { AnnotationMaterials } = await import("../core/AnnotationMaterials");
    const { AngleDimension3D } = await import("./AngleDimension3D");

    const materials = new AnnotationMaterials();
    const createDim = () =>
      new AngleDimension3D(materials, {
        vertex: new THREE.Vector3(0, 0, 0),
        point1: new THREE.Vector3(1, 0, 0),
        point2: new THREE.Vector3(0, 1, 0),
        arcRadius: 1,
        text: "90°",
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
});
