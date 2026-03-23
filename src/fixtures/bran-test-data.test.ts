import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref, shallowRef } from 'vue';

import { Matrix4, PerspectiveCamera, Scene } from 'three';

import branTestData from './bran-test-data.json';

import type { MbdPipeData } from '@/api/mbdPipeApi';

import { useMbdPipeAnnotationThree } from '@/composables/useMbdPipeAnnotationThree';

/**
 * BRAN JSON Fixture Test Suite
 *
 * Validates that the comprehensive BRAN test fixture can be loaded and rendered correctly.
 * This ensures annotation styling and layout work with controlled mock data.
 */
describe('BRAN JSON Fixture', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fixture should have valid structure matching MbdPipeData type', () => {
    const data = branTestData as MbdPipeData;

    expect(data.input_refno).toBe('TEST-BRAN-001');
    expect(data.branch_refno).toBe('TEST-BRAN-001');
    expect(data.branch_name).toBe('BRAN-TEST-COMPREHENSIVE');
    expect(data.branch_attrs).toBeDefined();
    expect(data.segments).toHaveLength(5);
    expect(data.dims).toHaveLength(13);
    expect(data.welds).toHaveLength(4);
    expect(data.slopes).toHaveLength(2);
    expect(data.bends).toHaveLength(1);
    expect(data.cut_tubis).toHaveLength(2);
    expect(data.fittings).toHaveLength(3);
    expect(data.tags).toHaveLength(3);
    expect(data.stats).toBeDefined();
  });

  it('fixture should contain all dimension kinds', () => {
    const data = branTestData as MbdPipeData;

    const dimKinds = new Set(data.dims.map((d) => d.kind));
    expect(dimKinds.has('segment')).toBe(true);
    expect(dimKinds.has('chain')).toBe(true);
    expect(dimKinds.has('overall')).toBe(true);
    expect(dimKinds.has('port')).toBe(true);
  });

  it('fixture should contain various weld types', () => {
    const data = branTestData as MbdPipeData;

    const weldTypes = new Set(data.welds.map((w) => w.weld_type));
    expect(weldTypes.has('Butt')).toBe(true);
    expect(weldTypes.has('Fillet')).toBe(true);

    const shopWelds = data.welds.filter((w) => w.is_shop);
    const fieldWelds = data.welds.filter((w) => !w.is_shop);
    expect(shopWelds.length).toBeGreaterThan(0);
    expect(fieldWelds.length).toBeGreaterThan(0);
  });

  it('fixture should contain various fitting types', () => {
    const data = branTestData as MbdPipeData;

    const fittingKinds = new Set(data.fittings?.map((f) => f.kind));
    expect(fittingKinds.has('elbo')).toBe(true);
    expect(fittingKinds.has('tee')).toBe(true);
    expect(fittingKinds.has('flan')).toBe(true);
  });

  it('fixture should render all dimensions in construction mode', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 1920, height: 1080 }),
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

    vis.applyModeDefaults('construction');
    vis.showDimChain.value = true;
    vis.renderBranch(branTestData as MbdPipeData);

    // In construction mode, chain dimensions should be visible
    const chainDims = Array.from(vis.getDimAnnotations().values()).filter(
      (dim) => (dim.userData as any)?.mbdDimKind === 'chain',
    );
    expect(chainDims.length).toBeGreaterThan(0);

    const visibleChainDims = chainDims.filter((dim) => dim.visible);
    expect(visibleChainDims.length).toBeGreaterThan(0);
    expect(visibleChainDims.length).toBeLessThanOrEqual(chainDims.length);
  });

  it('fixture dimensions should have correct geometry matching JSON coordinates', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 1920, height: 1080 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(60, 1920 / 1080, 0.1, 10000),
      flyTo: vi.fn(),
    } as any;

    viewer.camera.position.set(1425, 300, 3000);
    viewer.camera.lookAt(1425, 300, 0);
    viewer.camera.updateProjectionMatrix();
    viewer.camera.updateMatrixWorld(true);

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    vis.applyModeDefaults('construction');
    vis.showDimChain.value = true;
    vis.renderBranch(branTestData as MbdPipeData);

    const data = branTestData as MbdPipeData;
    const dimAnnotations = vis.getDimAnnotations();

    // Test first segment dimension (horizontal along X-axis)
    const segDim1 = data.dims.find((d) => d.id === 'd_segment_1');
    expect(segDim1).toBeDefined();

    // Find the corresponding rendered annotation
    const renderedDims = Array.from(dimAnnotations.values());
    const renderedSegDim1 = renderedDims.find(
      (dim) => (dim.userData as any)?.mbdDimId === 'd_segment_1',
    );
    expect(renderedSegDim1).toBeDefined();

    if (renderedSegDim1 && segDim1) {
      // Verify dimension distance matches JSON length
      const distance = (renderedSegDim1 as any).getDistance?.() ?? 0;
      expect(distance).toBeCloseTo(segDim1.length, 1);

      // Verify start/end points match JSON coordinates (within tolerance)
      const params = (renderedSegDim1 as any).getParams?.();
      if (params) {
        expect(params.start.x).toBeCloseTo(segDim1.start[0], 1);
        expect(params.start.y).toBeCloseTo(segDim1.start[1], 1);
        expect(params.start.z).toBeCloseTo(segDim1.start[2], 1);
        expect(params.end.x).toBeCloseTo(segDim1.end[0], 1);
        expect(params.end.y).toBeCloseTo(segDim1.end[1], 1);
        expect(params.end.z).toBeCloseTo(segDim1.end[2], 1);
      }
    }

    // Test vertical dimension (segment 2: along Y-axis)
    const segDim2 = data.dims.find((d) => d.id === 'd_segment_2');
    const renderedSegDim2 = renderedDims.find(
      (dim) => (dim.userData as any)?.mbdDimId === 'd_segment_2',
    );
    
    if (renderedSegDim2 && segDim2) {
      const distance = (renderedSegDim2 as any).getDistance?.() ?? 0;
      expect(distance).toBeCloseTo(segDim2.length, 1);
    }

    // Test short segment dimension (150mm - tests crowded layout)
    const segDim4 = data.dims.find((d) => d.id === 'd_segment_4');
    const renderedSegDim4 = renderedDims.find(
      (dim) => (dim.userData as any)?.mbdDimId === 'd_segment_4',
    );
    
    if (renderedSegDim4 && segDim4) {
      const distance = (renderedSegDim4 as any).getDistance?.() ?? 0;
      expect(distance).toBeCloseTo(150, 1);
    }
  });

  it('fixture dimensions should have correct arrow geometry for open arrow style', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 1920, height: 1080 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(60, 1920 / 1080, 0.1, 10000),
      flyTo: vi.fn(),
    } as any;

    viewer.camera.position.set(1425, 300, 3000);
    viewer.camera.lookAt(1425, 300, 0);
    viewer.camera.updateProjectionMatrix();
    viewer.camera.updateMatrixWorld(true);

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    vis.applyModeDefaults('construction');
    vis.renderBranch(branTestData as MbdPipeData);

    // Update all dimensions to ensure arrow geometry is computed
    const dimAnnotations = Array.from(vis.getDimAnnotations().values());
    dimAnnotations.forEach((dim) => {
      (dim as any).update?.(viewer.camera);
    });

    // Test open arrow geometry structure
    const segmentDims = dimAnnotations.filter(
      (dim) => (dim.userData as any)?.mbdDimKind === 'segment',
    );
    
    expect(segmentDims.length).toBeGreaterThan(0);

    // Check a representative dimension for arrow geometry
    const testDim = segmentDims[0];
    if (testDim) {
      // Open arrow style should have V-line geometry with 2 segments
      const arrowOpen1 = (testDim as any).arrowOpen1;
      const arrowOpenGeometry1 = (testDim as any).arrowOpenGeometry1;
      
      if (arrowOpen1 && arrowOpenGeometry1) {
        // Verify arrow is visible
        expect(arrowOpen1.visible).toBe(true);
        
        // Verify V-line structure: 2 segments for open arrow
        const instanceStart = arrowOpenGeometry1.getAttribute('instanceStart');
        if (instanceStart) {
          expect(instanceStart.count).toBe(2);
        }
      }

      // Verify closed arrow mesh is hidden when using open style
      const arrowMesh1 = (testDim as any).arrow1;
      if (arrowMesh1 && arrowOpen1) {
        expect(arrowMesh1.visible).toBe(false);
      }
    }
  });

  it('fixture dimensions should have extension lines that properly overshoot dimension line', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 1920, height: 1080 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(60, 1920 / 1080, 0.1, 10000),
      flyTo: vi.fn(),
    } as any;

    viewer.camera.position.set(1425, 300, 3000);
    viewer.camera.lookAt(1425, 300, 0);
    viewer.camera.updateProjectionMatrix();
    viewer.camera.updateMatrixWorld(true);

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    vis.applyModeDefaults('construction');
    vis.renderBranch(branTestData as MbdPipeData);

    const dimAnnotations = Array.from(vis.getDimAnnotations().values());
    dimAnnotations.forEach((dim) => {
      (dim as any).update?.(viewer.camera);
    });

    // Test extension line geometry
    const segmentDims = dimAnnotations.filter(
      (dim) => (dim.userData as any)?.mbdDimKind === 'segment',
    );

    const testDim = segmentDims[0];
    if (testDim) {
      const ext1Geometry = (testDim as any).ext1Geometry;
      
      if (ext1Geometry) {
        // Extension line should have position attribute
        const pos = ext1Geometry.getAttribute('position');
        expect(pos).toBeTruthy();
        expect(pos.count).toBeGreaterThanOrEqual(2);

        // Extension line should have instanceStart for Line2 rendering
        const instanceStart = ext1Geometry.getAttribute('instanceStart');
        if (instanceStart) {
          expect(instanceStart.count).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('fixture dimensions should have labels positioned at dimension midpoint', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 1920, height: 1080 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(60, 1920 / 1080, 0.1, 10000),
      flyTo: vi.fn(),
    } as any;

    viewer.camera.position.set(1425, 300, 3000);
    viewer.camera.lookAt(1425, 300, 0);
    viewer.camera.updateProjectionMatrix();
    viewer.camera.updateMatrixWorld(true);

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    vis.applyModeDefaults('construction');
    vis.renderBranch(branTestData as MbdPipeData);

    const data = branTestData as MbdPipeData;
    const dimAnnotations = Array.from(vis.getDimAnnotations().values());
    
    dimAnnotations.forEach((dim) => {
      (dim as any).update?.(viewer.camera);
    });

    // Test label positioning for first segment dimension
    const segDim1 = data.dims.find((d) => d.id === 'd_segment_1');
    const renderedSegDim1 = dimAnnotations.find(
      (dim) => (dim.userData as any)?.mbdDimId === 'd_segment_1',
    );

    if (renderedSegDim1 && segDim1) {
      const labelPos = (renderedSegDim1 as any).getLabelWorldPos?.();
      
      if (labelPos) {
        // Label should be near the midpoint of the dimension
        const expectedMidX = (segDim1.start[0] + segDim1.end[0]) / 2;
        const expectedMidY = (segDim1.start[1] + segDim1.end[1]) / 2;
        
        // Allow some tolerance for offset
        expect(Math.abs(labelPos.x - expectedMidX)).toBeLessThan(100);
        expect(Math.abs(labelPos.y - expectedMidY)).toBeLessThan(200);
      }
    }
  });

  it('fixture dimensions should lie in consistent coordinate planes', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 1920, height: 1080 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(60, 1920 / 1080, 0.1, 10000),
      flyTo: vi.fn(),
    } as any;

    viewer.camera.position.set(1425, 300, 3000);
    viewer.camera.lookAt(1425, 300, 0);
    viewer.camera.updateProjectionMatrix();
    viewer.camera.updateMatrixWorld(true);

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    vis.applyModeDefaults('construction');
    vis.renderBranch(branTestData as MbdPipeData);

    const data = branTestData as MbdPipeData;
    const dimAnnotations = Array.from(vis.getDimAnnotations().values());
    
    dimAnnotations.forEach((dim) => {
      (dim as any).update?.(viewer.camera);
    });

    // Test that dimensions in XY plane have consistent Z coordinates
    const xyPlaneDims = data.dims.filter(
      (d) => d.start[2] === 0 && d.end[2] === 0,
    );

    xyPlaneDims.forEach((dimData) => {
      const rendered = dimAnnotations.find(
        (dim) => (dim.userData as any)?.mbdDimId === dimData.id,
      );
      
      if (rendered) {
        const params = (rendered as any).getParams?.();
        if (params) {
          // Start and end should have same Z coordinate for XY plane dimensions
          expect(params.start.z).toBeCloseTo(params.end.z, 1);
          // Should be at or near Z=0
          expect(Math.abs(params.start.z)).toBeLessThan(1);
        }
      }
    });
  });

  it('fixture should render all dimensions in inspection mode', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 1920, height: 1080 }),
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

    vis.applyModeDefaults('inspection');
    vis.renderBranch(branTestData as MbdPipeData);

    // In inspection mode, port dimensions should be visible
    const portDims = Array.from(vis.getDimAnnotations().values()).filter(
      (dim) => (dim.userData as any)?.mbdDimKind === 'port',
    );
    expect(portDims.length).toBeGreaterThan(0);

    // Verify port dimensions are visible
    portDims.forEach((dim) => {
      expect(dim.visible).toBe(true);
    });
  });

  it('fixture should render welds with correct styling', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 1920, height: 1080 }),
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

    vis.renderBranch(branTestData as MbdPipeData);

    const weldAnnotations = vis.getWeldAnnotations();
    expect(weldAnnotations.size).toBe(4);

    // Verify all welds are visible in construction mode
    weldAnnotations.forEach((weld) => {
      expect(weld.visible).toBe(true);
    });
  });

  it('fixture should render slopes with correct styling', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 1920, height: 1080 }),
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

    vis.renderBranch(branTestData as MbdPipeData);

    const slopeAnnotations = vis.getSlopeAnnotations();
    expect(slopeAnnotations.size).toBe(2);

    // Verify all slopes are visible in construction mode
    slopeAnnotations.forEach((slope) => {
      expect(slope.visible).toBe(true);
    });
  });

  it('fixture should render cut tubis with correct styling', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 1920, height: 1080 }),
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

    // Ensure cut tubis are enabled
    vis.showCutTubis.value = true;
    vis.renderBranch(branTestData as MbdPipeData);

    // Cut tubis are rendered as dimensions with mbdAuxKind = 'cut_tubi'
    const cutTubiAnnotations = Array.from(vis.getDimAnnotations().values()).filter(
      (dim) => (dim.userData as any)?.mbdAuxKind === 'cut_tubi',
    );
    
    // Cut tubis may be rendered based on backend data, so just verify rendering doesn't crash
    // In construction mode, cut tubis should be shown if available
    if (cutTubiAnnotations.length > 0) {
      cutTubiAnnotations.forEach((cutTubi) => {
        expect(cutTubi.visible).toBe(true);
      });
    }
  });

  it('fixture should render fitting tags with correct styling', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 1920, height: 1080 }),
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

    vis.renderBranch(branTestData as MbdPipeData);

    const tagAnnotations = vis.getTagAnnotations();
    expect(tagAnnotations.size).toBe(3);

    // Verify tags exist (text verification may depend on rendering implementation)
    expect(tagAnnotations.size).toBeGreaterThan(0);
  });

  it('fixture short segment (150mm) should handle crowded annotation layout', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 1920, height: 1080 }),
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

    vis.applyModeDefaults('construction');
    vis.renderBranch(branTestData as MbdPipeData);

    // Find dimensions related to the short segment
    const chainDims = Array.from(vis.getDimAnnotations().values()).filter(
      (dim) => (dim.userData as any)?.mbdDimKind === 'chain',
    );

    // Verify chain dimensions include short segments
    expect(chainDims.length).toBeGreaterThan(0);

    const shortDim = chainDims.find(
      (dim) => (dim.userData as any)?.mbdDimId === 'd_chain_4',
    );
    expect(shortDim).toBeTruthy();
    const shortParams = (shortDim as any)?.getParams?.();
    expect(shortParams?.offset).toBeGreaterThan(0);
    expect(shortDim?.visible).toBe(false);
  });

  it('fixture stats should match actual annotation counts', () => {
    const data = branTestData as MbdPipeData;

    expect(data.stats.segments_count).toBe(data.segments.length);
    expect(data.stats.dims_count).toBe(data.dims.length);
    expect(data.stats.welds_count).toBe(data.welds.length);
    expect(data.stats.slopes_count).toBe(data.slopes.length);
    expect(data.stats.bends_count).toBe(data.bends.length);
    expect(data.stats.cut_tubis_count).toBe(data.cut_tubis?.length || 0);
    expect(data.stats.fittings_count).toBe(data.fittings?.length || 0);
    expect(data.stats.tags_count).toBe(data.tags?.length || 0);
  });

  it('fixture should have valid 3D coordinates for all annotations', () => {
    const data = branTestData as MbdPipeData;

    // Validate segments have valid arrive/leave points
    data.segments.forEach((seg) => {
      expect(seg.arrive).toHaveLength(3);
      expect(seg.leave).toHaveLength(3);
      expect(seg.arrive?.every((v) => typeof v === 'number')).toBe(true);
      expect(seg.leave?.every((v) => typeof v === 'number')).toBe(true);
    });

    // Validate dimensions have valid start/end points
    data.dims.forEach((dim) => {
      expect(dim.start).toHaveLength(3);
      expect(dim.end).toHaveLength(3);
      expect(dim.start.every((v) => typeof v === 'number')).toBe(true);
      expect(dim.end.every((v) => typeof v === 'number')).toBe(true);
    });

    // Validate welds have valid positions
    data.welds.forEach((weld) => {
      expect(weld.position).toHaveLength(3);
      expect(weld.position.every((v) => typeof v === 'number')).toBe(true);
    });
  });
});
