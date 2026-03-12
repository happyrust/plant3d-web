import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import * as THREE from 'three';

import { AnnotationMaterials } from '../core/AnnotationMaterials';

import { SlopeAnnotation } from './SlopeAnnotation';

describe('SlopeAnnotation', () => {
  let materials: AnnotationMaterials;
  let slope: SlopeAnnotation;

  beforeEach(() => {
    materials = new AnnotationMaterials();
  });

  afterEach(() => {
    slope?.dispose();
    materials.dispose();
  });

  describe('constructor', () => {
    it('should create a slope annotation with start and end points', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(100, 10, 0);

      slope = new SlopeAnnotation(materials, {
        start,
        end,
        text: '1:10',
      });

      expect(slope).toBeInstanceOf(SlopeAnnotation);
      expect(slope).toBeInstanceOf(THREE.Object3D);
    });

    it('should accept slope value parameter', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(100, 5, 0);

      slope = new SlopeAnnotation(materials, {
        start,
        end,
        text: '1:20',
        slope: 0.05,
      });

      const params = slope.getParams();
      expect(params.slope).toBe(0.05);
    });

    it('should clone start and end vectors', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(100, 10, 0);

      slope = new SlopeAnnotation(materials, {
        start,
        end,
        text: '1:10',
      });

      // Modify original vectors
      start.set(999, 999, 999);
      end.set(888, 888, 888);

      // Slope should retain original values
      const params = slope.getParams();
      expect(params.start.x).toBe(0);
      expect(params.end.x).toBe(100);
    });

    it('should add child objects', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(100, 10, 0);

      slope = new SlopeAnnotation(materials, {
        start,
        end,
        text: '1:10',
      });

      // Should have slope line and text label
      expect(slope.children.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getParams', () => {
    it('should return cloned vectors', () => {
      const start = new THREE.Vector3(10, 20, 30);
      const end = new THREE.Vector3(110, 30, 30);

      slope = new SlopeAnnotation(materials, {
        start,
        end,
        text: '1:10',
      });

      const params = slope.getParams();
      params.start.set(0, 0, 0);
      params.end.set(0, 0, 0);

      const params2 = slope.getParams();
      expect(params2.start.x).toBe(10);
      expect(params2.end.x).toBe(110);
    });

    it('should return all parameters', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(100, 5, 0);

      slope = new SlopeAnnotation(materials, {
        start,
        end,
        text: '1:20',
        slope: 0.05,
      });

      const params = slope.getParams();
      expect(params.text).toBe('1:20');
      expect(params.slope).toBe(0.05);
    });
  });

  describe('setParams', () => {
    it('should update start point', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(100, 10, 0);

      slope = new SlopeAnnotation(materials, {
        start,
        end,
        text: '1:10',
      });

      slope.setParams({ start: new THREE.Vector3(50, 5, 0) });

      const params = slope.getParams();
      expect(params.start.x).toBe(50);
      expect(params.start.y).toBe(5);
    });

    it('should update end point', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(100, 10, 0);

      slope = new SlopeAnnotation(materials, {
        start,
        end,
        text: '1:10',
      });

      slope.setParams({ end: new THREE.Vector3(200, 20, 0) });

      const params = slope.getParams();
      expect(params.end.x).toBe(200);
      expect(params.end.y).toBe(20);
    });

    it('should update text', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(100, 10, 0);

      slope = new SlopeAnnotation(materials, {
        start,
        end,
        text: '1:10',
      });

      slope.setParams({ text: '1:5' });

      const params = slope.getParams();
      expect(params.text).toBe('1:5');
    });

    it('should update slope value', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(100, 10, 0);

      slope = new SlopeAnnotation(materials, {
        start,
        end,
        text: '1:10',
      });

      slope.setParams({ slope: 0.2 });

      const params = slope.getParams();
      expect(params.slope).toBe(0.2);
    });
  });

  describe('setMaterialSet', () => {
    it('should change material set', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(100, 10, 0);

      slope = new SlopeAnnotation(materials, {
        start,
        end,
        text: '1:10',
      });

      expect(() => slope.setMaterialSet(materials.green)).not.toThrow();
    });
  });

  describe('highlighted', () => {
    it('should toggle highlight state', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(100, 10, 0);

      slope = new SlopeAnnotation(materials, {
        start,
        end,
        text: '1:10',
      });

      expect(slope.highlighted).toBe(false);
      slope.highlighted = true;
      expect(slope.highlighted).toBe(true);
      slope.highlighted = false;
      expect(slope.highlighted).toBe(false);
    });

    it('should not trigger update if value unchanged', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(100, 10, 0);

      slope = new SlopeAnnotation(materials, {
        start,
        end,
        text: '1:10',
      });

      const onHighlightChangedSpy = vi.spyOn(slope as never, 'onHighlightChanged');

      slope.highlighted = false;
      expect(onHighlightChangedSpy).not.toHaveBeenCalled();

      slope.highlighted = true;
      expect(onHighlightChangedSpy).toHaveBeenCalledWith(true);
    });
  });

  describe('update', () => {
    it('should update with perspective camera', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(100, 10, 0);

      slope = new SlopeAnnotation(materials, {
        start,
        end,
        text: '1:10',
      });

      const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
      camera.position.set(0, 0, 100);

      expect(() => slope.update(camera)).not.toThrow();
    });

    it('should update with orthographic camera', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(100, 10, 0);

      slope = new SlopeAnnotation(materials, {
        start,
        end,
        text: '1:10',
      });

      const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 1000);
      camera.position.set(0, 0, 100);

      expect(() => slope.update(camera)).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('should remove from parent', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(100, 10, 0);

      slope = new SlopeAnnotation(materials, {
        start,
        end,
        text: '1:10',
      });

      const parent = new THREE.Group();
      parent.add(slope);

      expect(parent.children).toContain(slope);
      slope.dispose();
      expect(parent.children).not.toContain(slope);
    });
  });

  describe('slope calculations', () => {
    it('should handle positive slope', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(100, 10, 0); // 10% slope

      slope = new SlopeAnnotation(materials, {
        start,
        end,
        text: '10%',
        slope: 0.1,
      });

      const params = slope.getParams();
      expect(params.slope).toBe(0.1);
    });

    it('should handle negative slope', () => {
      const start = new THREE.Vector3(0, 10, 0);
      const end = new THREE.Vector3(100, 0, 0); // -10% slope

      slope = new SlopeAnnotation(materials, {
        start,
        end,
        text: '-10%',
        slope: -0.1,
      });

      const params = slope.getParams();
      expect(params.slope).toBe(-0.1);
    });

    it('should handle zero slope', () => {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(100, 0, 0); // 0% slope

      slope = new SlopeAnnotation(materials, {
        start,
        end,
        text: '0%',
        slope: 0,
      });

      const params = slope.getParams();
      expect(params.slope).toBe(0);
    });
  });
});
