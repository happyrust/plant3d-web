import { describe, it, expect, beforeEach, vi } from 'vitest';

import * as THREE from 'three';

describe('LinearDimension3D', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should construct and expose params', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { LinearDimension3D } = await import('./LinearDimension3D');

    const materials = new AnnotationMaterials();
    const start = new THREE.Vector3(0, 0, 0);
    const end = new THREE.Vector3(1, 0, 0);

    const dim = new LinearDimension3D(materials, { start, end, offset: 1 });
    expect(dim.getParams().offset).toBe(1);
    expect(dim.getParams().start.x).toBe(0);
    expect(dim).toBeInstanceOf(THREE.Object3D);
    expect(dim.getDistance()).toBeCloseTo(1, 8);
    expect(dim.getDisplayText()).toBe('1.0');
  });

  it('should use dashed materials for reference dimensions', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { LinearDimension3D } = await import('./LinearDimension3D');

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

    const spy = vi.spyOn(lineA, 'computeLineDistances');

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

  it('should forward setBackgroundColor to textLabel', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { LinearDimension3D } = await import('./LinearDimension3D');

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(1, 0, 0),
      offset: 0.5,
    });

    const textLabel = (dim as any).textLabel;
    const spy = vi.spyOn(textLabel, 'setBackgroundColor');

    dim.setBackgroundColor(0xff0000);
    expect(spy).toHaveBeenCalledWith(0xff0000);
  });

  it('should preserve depthTest=false after setMaterialSet in all interaction states', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { LinearDimension3D } = await import('./LinearDimension3D');

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

  it('should have extension lines that overshoot beyond dimension line endpoint', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { LinearDimension3D } = await import('./LinearDimension3D');

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

    // Extension line geometry endpoint (in local space)
    // LineGeometry stores positions as instanceStart/instanceEnd pairs
    const ext1Geom = (dim as any).ext1Geometry as THREE.BufferGeometry;
    const instanceEnd = ext1Geom.getAttribute('instanceEnd');
    expect(instanceEnd).toBeTruthy();

    // The extension line should extend beyond the dim endpoint (overshoot)
    // Start point is at (0,0,0), dimension line is at (0,2,0)
    // Extension should overshoot past 2
    const endY = instanceEnd.getY(0);
    expect(endY).toBeGreaterThan(2);
  });

  it('should use camera annotation viewport for wpp scaling', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { LinearDimension3D } = await import('./LinearDimension3D');

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(2, 0, 0),
      offset: 0.6,
      text: '2000',
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

  it('should apply labelOffsetWorld on top of the labelT anchor', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { LinearDimension3D } = await import('./LinearDimension3D');

    const materials = new AnnotationMaterials();
    const labelOffset = new THREE.Vector3(5, 9, 0);
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(10, 0, 0),
      offset: 3,
      direction: new THREE.Vector3(0, 1, 0),
      labelOffsetWorld: labelOffset,
      text: '10000',
    });

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 30);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    vi.spyOn((dim as any).textLabel, 'getExtentsPx').mockReturnValue({
      width: 40,
      height: 16,
    });

    dim.update(camera);

    const dimStart = (dim as any).dimStart as THREE.Vector3;
    const dimEnd = (dim as any).dimEnd as THREE.Vector3;
    const expected = dimStart.clone().lerp(dimEnd, 0.5).add(labelOffset);
    const labelPos = dim.getLabelWorldPos();

    expect(labelPos.distanceTo(expected)).toBeLessThan(0.1);
  });

  it('should keep labelOffsetWorld visually stable after camera zoom changes', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { LinearDimension3D } = await import('./LinearDimension3D');

    const materials = new AnnotationMaterials();
    const labelOffset = new THREE.Vector3(5, 9, 0);
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(10, 0, 0),
      offset: 3,
      direction: new THREE.Vector3(0, 1, 0),
      labelOffsetWorld: labelOffset,
      text: '10000',
    });

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    (camera as any).userData.annotationViewport = { width: 200, height: 200 };
    const expectedWorld = new THREE.Vector3(10, 12, 0);
    const projectToPixel = (world: THREE.Vector3) => {
      const ndc = world.clone().project(camera);
      return new THREE.Vector2(
        (ndc.x * 0.5 + 0.5) * 200,
        (-ndc.y * 0.5 + 0.5) * 200,
      );
    };

    const assertPixelAligned = (cameraZ: number) => {
      camera.position.set(0, 0, cameraZ);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      dim.update(camera);

      const actualPx = projectToPixel(dim.getLabelWorldPos());
      const expectedPx = projectToPixel(expectedWorld);
      expect(actualPx.distanceTo(expectedPx)).toBeLessThan(1.5);
    };

    assertPixelAligned(30);
    assertPixelAligned(300);
  });

  it('should honor laidOutGeometry text anchor and explicit extension lines', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { LinearDimension3D } = await import('./LinearDimension3D');

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(10, 0, 0),
      offset: 3,
      direction: new THREE.Vector3(0, 1, 0),
      text: '10000',
      laidOutGeometry: {
        dimLineStart: new THREE.Vector3(0, 5, 0),
        dimLineEnd: new THREE.Vector3(10, 5, 0),
        extensionLine1Start: new THREE.Vector3(0, 0, 0),
        extensionLine1End: new THREE.Vector3(0, 7, 0),
        extensionLine2Start: new THREE.Vector3(10, 0, 0),
        extensionLine2End: new THREE.Vector3(10, 7, 0),
        textAnchor: new THREE.Vector3(4, 9, 0),
      },
    });

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 30);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    dim.update(camera);

    const labelPos = dim.getLabelWorldPos();
    expect(labelPos.x).toBeCloseTo(4, 1);
    expect(labelPos.y).toBeCloseTo(9, 1);

    const ext1Geom = (dim as any).ext1Geometry as THREE.BufferGeometry;
    const instanceStart = ext1Geom.getAttribute('instanceStart');
    const instanceEnd = ext1Geom.getAttribute('instanceEnd');
    expect(instanceStart).toBeTruthy();
    expect(instanceEnd).toBeTruthy();
    expect(instanceStart.getX(0)).toBeCloseTo(0, 1);
    expect(instanceStart.getY(0)).toBeCloseTo(0, 1);
    expect(instanceEnd.getX(0)).toBeCloseTo(0, 1);
    expect(instanceEnd.getY(0)).toBeCloseTo(7, 1);
  });

  it('should keep laidOutGeometry textAnchor visually stable after camera zoom changes', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { LinearDimension3D } = await import('./LinearDimension3D');

    const materials = new AnnotationMaterials();
    const laidOutTextAnchor = new THREE.Vector3(4, 9, 0);
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(10, 0, 0),
      offset: 3,
      direction: new THREE.Vector3(0, 1, 0),
      text: '416',
      laidOutGeometry: {
        dimLineStart: new THREE.Vector3(0, 5, 0),
        dimLineEnd: new THREE.Vector3(10, 5, 0),
        extensionLine1Start: new THREE.Vector3(0, 0, 0),
        extensionLine1End: new THREE.Vector3(0, 7, 0),
        extensionLine2Start: new THREE.Vector3(10, 0, 0),
        extensionLine2End: new THREE.Vector3(10, 7, 0),
        textAnchor: laidOutTextAnchor.clone(),
      },
    });

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    (camera as any).userData.annotationViewport = { width: 200, height: 200 };
    const projectToPixel = (world: THREE.Vector3) => {
      const ndc = world.clone().project(camera);
      return new THREE.Vector2(
        (ndc.x * 0.5 + 0.5) * 200,
        (-ndc.y * 0.5 + 0.5) * 200,
      );
    };

    const assertPixelAligned = (cameraZ: number) => {
      camera.position.set(0, 0, cameraZ);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      dim.update(camera);

      const actualPx = projectToPixel(dim.getLabelWorldPos());
      const expectedPx = projectToPixel(laidOutTextAnchor);
      expect(actualPx.distanceTo(expectedPx)).toBeLessThan(1.5);
    };

    assertPixelAligned(30);
    assertPixelAligned(300);
  });

  it('应在 layout_first 远距离下自动隐藏过短 segment 尺寸文字，并在拉近后恢复', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { LinearDimension3D } = await import('./LinearDimension3D');

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(10, 0, 0),
      offset: 3,
      direction: new THREE.Vector3(0, 1, 0),
      text: '416',
      laidOutGeometry: {
        dimLineStart: new THREE.Vector3(0, 5, 0),
        dimLineEnd: new THREE.Vector3(10, 5, 0),
        textAnchor: new THREE.Vector3(4, 9, 0),
      },
    });
    (dim.userData as any).mbdDimKind = 'segment';

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    (camera as any).userData.annotationViewport = { width: 200, height: 200 };
    vi.spyOn((dim as any).textLabel, 'getExtentsPx').mockReturnValue({
      width: 30,
      height: 16,
    });

    const updateAt = (cameraZ: number) => {
      camera.position.set(0, 0, cameraZ);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      dim.update(camera);
    };

    updateAt(300);
    expect((dim as any).textLabel.object3d.visible).toBe(false);

    updateAt(30);
    expect((dim as any).textLabel.object3d.visible).toBe(true);
  });

  it('应在 layout_first 远距离下自动隐藏过短 port 尺寸文字', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { LinearDimension3D } = await import('./LinearDimension3D');

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(10, 0, 0),
      offset: 3,
      direction: new THREE.Vector3(0, 1, 0),
      text: '151',
      laidOutGeometry: {
        dimLineStart: new THREE.Vector3(0, 5, 0),
        dimLineEnd: new THREE.Vector3(10, 5, 0),
        textAnchor: new THREE.Vector3(5, 8, 0),
      },
    });
    (dim.userData as any).mbdDimKind = 'port';
    vi.spyOn((dim as any).textLabel, 'getExtentsPx').mockReturnValue({
      width: 26,
      height: 16,
    });

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    (camera as any).userData.annotationViewport = { width: 200, height: 200 };
    camera.position.set(0, 0, 300);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    dim.update(camera);

    expect((dim as any).textLabel.object3d.visible).toBe(false);
  });

  it('应在 layout_first 远距离下自动隐藏过短 cut_tubi 与 bend size 文字', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { LinearDimension3D } = await import('./LinearDimension3D');

    const materials = new AnnotationMaterials();
    const createShortDim = (text: string) =>
      new LinearDimension3D(materials, {
        start: new THREE.Vector3(0, 0, 0),
        end: new THREE.Vector3(10, 0, 0),
        offset: 3,
        direction: new THREE.Vector3(0, 1, 0),
        text,
        laidOutGeometry: {
          dimLineStart: new THREE.Vector3(0, 5, 0),
          dimLineEnd: new THREE.Vector3(10, 5, 0),
          textAnchor: new THREE.Vector3(5, 8, 0),
        },
      });

    const cut = createShortDim('53');
    (cut.userData as any).mbdAuxKind = 'cut_tubi';
    vi.spyOn((cut as any).textLabel, 'getExtentsPx').mockReturnValue({
      width: 24,
      height: 16,
    });

    const bend = createShortDim('152');
    (bend.userData as any).mbdBendId = 'bend-1';
    vi.spyOn((bend as any).textLabel, 'getExtentsPx').mockReturnValue({
      width: 24,
      height: 16,
    });

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    (camera as any).userData.annotationViewport = { width: 200, height: 200 };
    camera.position.set(0, 0, 300);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    cut.update(camera);
    bend.update(camera);

    expect((cut as any).textLabel.object3d.visible).toBe(false);
    expect((bend as any).textLabel.object3d.visible).toBe(false);
  });

  it('should trim explicit laidOutGeometry dimension line around the text box like CAD dims', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { LinearDimension3D } = await import('./LinearDimension3D');

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(30, 0, 0),
      offset: 3,
      direction: new THREE.Vector3(0, 1, 0),
      text: '10000',
      laidOutGeometry: {
        dimLineStart: new THREE.Vector3(0, 5, 0),
        dimLineEnd: new THREE.Vector3(30, 5, 0),
        textAnchor: new THREE.Vector3(15, 5, 0),
      },
    });
    vi.spyOn((dim as any).textLabel, 'getExtentsPx').mockReturnValue({
      width: 40,
      height: 16,
    });

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    (camera as any).userData.annotationViewport = { width: 200, height: 200 };
    camera.position.set(0, 0, 30);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const assertExplicitLineTrimmed = (cameraZ: number) => {
      camera.position.set(0, 0, cameraZ);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      dim.update(camera);

      expect((dim as any).dimensionLineA.visible).toBe(true);
      expect((dim as any).dimensionLineB.visible).toBe(true);
      expect((dim as any).dimensionLineOutside.visible).toBe(false);

      const lineGeomA = (dim as any).dimLineGeometryA as THREE.BufferGeometry;
      const lineGeomB = (dim as any).dimLineGeometryB as THREE.BufferGeometry;
      const aStart = lineGeomA.getAttribute('instanceStart');
      const aEnd = lineGeomA.getAttribute('instanceEnd');
      const bStart = lineGeomB.getAttribute('instanceStart');
      const bEnd = lineGeomB.getAttribute('instanceEnd');

      expect(aStart.getX(0)).toBeCloseTo(0, 0);
      expect(aStart.getY(0)).toBeCloseTo(5, 0);
      expect(aEnd.getX(0)).toBeLessThan(15);
      expect(aEnd.getY(0)).toBeCloseTo(5, 0);

      expect(bStart.getX(0)).toBeGreaterThan(15);
      expect(bStart.getY(0)).toBeCloseTo(5, 0);
      expect(bEnd.getX(0)).toBeCloseTo(30, 0);
      expect(bEnd.getY(0)).toBeCloseTo(5, 0);
    };

    assertExplicitLineTrimmed(30);
    assertExplicitLineTrimmed(60);
  });

  it('should keep explicit laidOutGeometry dimension line fully visible when short bend label is auto-hidden', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { LinearDimension3D } = await import('./LinearDimension3D');

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(8, 0, 0),
      offset: 3,
      direction: new THREE.Vector3(0, 1, 0),
      text: '151',
      laidOutGeometry: {
        dimLineStart: new THREE.Vector3(0, 5, 0),
        dimLineEnd: new THREE.Vector3(8, 5, 0),
        textAnchor: new THREE.Vector3(4, 5, 0),
      },
    });
    (dim.userData as any).mbdBendId = 'bend-1';
    vi.spyOn((dim as any).textLabel, 'getExtentsPx').mockReturnValue({
      width: 28,
      height: 16,
    });

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    (camera as any).userData.annotationViewport = { width: 200, height: 200 };
    camera.position.set(0, 0, 300);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    dim.update(camera);

    expect((dim as any).textLabel.object3d.visible).toBe(false);
    expect((dim as any).dimensionLineA.visible).toBe(true);
    expect((dim as any).dimensionLineB.visible).toBe(false);
    expect((dim as any).dimensionLineOutside.visible).toBe(false);

    const lineGeomA = (dim as any).dimLineGeometryA as THREE.BufferGeometry;
    const aStart = lineGeomA.getAttribute('instanceStart');
    const aEnd = lineGeomA.getAttribute('instanceEnd');
    expect(aStart.getX(0)).toBeCloseTo(0, 0);
    expect(aStart.getY(0)).toBeCloseTo(5, 0);
    expect(aEnd.getX(0)).toBeGreaterThan(7.5);
    expect(aEnd.getX(0)).toBeLessThan(9.1);
    expect(aEnd.getY(0)).toBeCloseTo(5, 0);
  });

  it('should place label at labelT position on the dimension line', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { LinearDimension3D } = await import('./LinearDimension3D');

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(10, 0, 0),
      offset: 3,
      direction: new THREE.Vector3(0, 1, 0),
      labelT: 0.75,
      text: '10000',
    });

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 30);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    dim.update(camera);

    const labelPos = dim.getLabelWorldPos();
    expect(labelPos.x).toBeCloseTo(7.5, 1);
    expect(labelPos.y).toBeCloseTo(3, 1);
  });

  it('should keep label world scale stable under parent global scaling', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { LinearDimension3D } = await import('./LinearDimension3D');

    const materials = new AnnotationMaterials();
    const createDim = () =>
      new LinearDimension3D(materials, {
        start: new THREE.Vector3(0, 0, 0),
        end: new THREE.Vector3(2, 0, 0),
        offset: 0.6,
        text: '2000',
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

  it('should render open arrow style with V-line geometry', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { LinearDimension3D } = await import('./LinearDimension3D');

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(4, 0, 0),
      offset: 1,
      arrowStyle: 'open',
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
    const instanceStart = openGeom1.getAttribute('instanceStart');
    expect(instanceStart).toBeTruthy();
    expect(instanceStart.count).toBe(2);
  });

  it('should render tick arrow style with single slash segments', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { LinearDimension3D } = await import('./LinearDimension3D');

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(4, 0, 0),
      offset: 1,
      arrowStyle: 'tick',
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
    const instanceStart = openGeom1.getAttribute('instanceStart');
    expect(instanceStart).toBeTruthy();
    expect(instanceStart.count).toBe(1);
  });

  it('should apply custom line width to dimension lines and open arrows', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { LinearDimension3D } = await import('./LinearDimension3D');

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(4, 0, 0),
      offset: 1,
      arrowStyle: 'open',
    });

    dim.setLineWidthPx(2.5);

    const lineA = (dim as any).dimensionLineA as any;
    const arrowOpen1 = (dim as any).arrowOpen1 as any;
    expect((lineA.material as any).linewidth).toBeCloseTo(2.5, 6);
    expect((arrowOpen1.material as any).linewidth).toBeCloseTo(2.5, 6);
  });
});
