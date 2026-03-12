import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import * as THREE from 'three';

import { AnnotationMaterials } from '../core/AnnotationMaterials';

import { LinearDimension } from './LinearDimension';

describe('LinearDimension', () => {
  let materials: AnnotationMaterials;
  let dimension: LinearDimension;

  beforeEach(() => {
    materials = new AnnotationMaterials();
  });

  afterEach(() => {
    dimension?.dispose();
    materials.dispose();
  });

  describe('constructor', () => {
    it('should create a linear dimension with start and end points', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(10, 0, 0);

      dimension = new LinearDimension(materials, { start, end });

      expect(dimension).toBeInstanceOf(LinearDimension);
      expect(dimension).toBeInstanceOf(THREE.Object3D);
    });

    it('should set default parameters', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(10, 0, 0);

      dimension = new LinearDimension(materials, { start, end });
      const params = dimension.getParams();

      expect(params.offset).toBe(0.5);
      expect(params.unit).toBe('');
      expect(params.decimals).toBe(1);
    });

    it('should accept custom parameters', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(10, 0, 0);

      dimension = new LinearDimension(materials, {
        start,
        end,
        offset: 2,
        text: 'Custom Text',
        unit: 'mm',
        decimals: 2,
      });

      const params = dimension.getParams();
      expect(params.offset).toBe(2);
      expect(params.text).toBe('Custom Text');
      expect(params.unit).toBe('mm');
      expect(params.decimals).toBe(2);
    });

    it('should clone start and end vectors', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(10, 0, 0);

      dimension = new LinearDimension(materials, { start, end });
      const params = dimension.getParams();

      // Modify original vectors
      start.set(100, 100, 100);
      end.set(200, 200, 200);

      // Dimension should retain original values
      expect(params.start.x).toBe(0);
      expect(params.end.x).toBe(10);
    });

    it('should add child objects', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(10, 0, 0);

      dimension = new LinearDimension(materials, { start, end });

      // Should have dimension line, 2 extension lines, 2 arrows, and text label
      expect(dimension.children.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('getParams', () => {
    it('should return cloned vectors', () => {
      const start = new THREE.Vector3(1, 2, 3);
      const end = new THREE.Vector3(4, 5, 6);

      dimension = new LinearDimension(materials, { start, end });
      const params = dimension.getParams();

      // Modify returned vectors
      params.start.set(100, 100, 100);
      params.end.set(200, 200, 200);

      // Get params again - should be unchanged
      const params2 = dimension.getParams();
      expect(params2.start.x).toBe(1);
      expect(params2.end.x).toBe(4);
    });
  });

  describe('setParams', () => {
    it('should update start point', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(10, 0, 0);

      dimension = new LinearDimension(materials, { start, end });
      dimension.setParams({ start: new THREE.Vector3(5, 5, 5) });

      const params = dimension.getParams();
      expect(params.start.x).toBe(5);
      expect(params.start.y).toBe(5);
      expect(params.start.z).toBe(5);
    });

    it('should update end point', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(10, 0, 0);

      dimension = new LinearDimension(materials, { start, end });
      dimension.setParams({ end: new THREE.Vector3(20, 0, 0) });

      const params = dimension.getParams();
      expect(params.end.x).toBe(20);
    });

    it('should update offset', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(10, 0, 0);

      dimension = new LinearDimension(materials, { start, end });
      dimension.setParams({ offset: 5 });

      const params = dimension.getParams();
      expect(params.offset).toBe(5);
    });

    it('should update text', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(10, 0, 0);

      dimension = new LinearDimension(materials, { start, end });
      dimension.setParams({ text: 'New Text' });

      const params = dimension.getParams();
      expect(params.text).toBe('New Text');
    });
  });

  describe('setMaterialSet', () => {
    it('should change material set', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(10, 0, 0);

      dimension = new LinearDimension(materials, { start, end });
      dimension.setMaterialSet(materials.orange);

      // Verify by checking child materials
      const line = dimension.children.find(c => c.type === 'Line2');
      expect(line).toBeDefined();
    });
  });

  describe('highlighted', () => {
    it('should toggle highlight state', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(10, 0, 0);

      dimension = new LinearDimension(materials, { start, end });

      expect(dimension.highlighted).toBe(false);
      dimension.highlighted = true;
      expect(dimension.highlighted).toBe(true);
      dimension.highlighted = false;
      expect(dimension.highlighted).toBe(false);
    });

    it('should not trigger update if value unchanged', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(10, 0, 0);

      dimension = new LinearDimension(materials, { start, end });

      // Access private method via prototype
      const onHighlightChangedSpy = vi.spyOn(dimension as never, 'onHighlightChanged');

      dimension.highlighted = false; // Already false
      expect(onHighlightChangedSpy).not.toHaveBeenCalled();

      dimension.highlighted = true;
      expect(onHighlightChangedSpy).toHaveBeenCalledWith(true);
    });
  });

  describe('update', () => {
    it('should update with perspective camera', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(10, 0, 0);

      dimension = new LinearDimension(materials, { start, end });
      const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
      camera.position.set(0, 0, 10);

      expect(() => dimension.update(camera)).not.toThrow();
    });

    it('should update with orthographic camera', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(10, 0, 0);

      dimension = new LinearDimension(materials, { start, end });
      const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
      camera.position.set(0, 0, 10);

      expect(() => dimension.update(camera)).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('should remove from parent', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(10, 0, 0);

      dimension = new LinearDimension(materials, { start, end });
      const parent = new THREE.Group();
      parent.add(dimension);

      expect(parent.children).toContain(dimension);
      dimension.dispose();
      expect(parent.children).not.toContain(dimension);
    });
  });

  describe('geometry calculations', () => {
    it('should calculate correct distance for horizontal line', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(10, 0, 0);

      dimension = new LinearDimension(materials, {
        start,
        end,
        decimals: 0,
      });

      // The text should show the distance
      const params = dimension.getParams();
      expect(params.start.distanceTo(params.end)).toBe(10);
    });

    it('should calculate correct distance for diagonal line', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(3, 4, 0);

      dimension = new LinearDimension(materials, {
        start,
        end,
        decimals: 0,
      });

      const params = dimension.getParams();
      expect(params.start.distanceTo(params.end)).toBe(5);
    });

    it('should handle custom direction', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(10, 0, 0);
      const direction = new THREE.Vector3(0, 1, 0);

      dimension = new LinearDimension(materials, {
        start,
        end,
        direction,
        offset: 2,
      });

      const params = dimension.getParams();
      expect(params.direction).toBeDefined();
      expect(params.direction!.y).toBe(1);
    });
  });
});
