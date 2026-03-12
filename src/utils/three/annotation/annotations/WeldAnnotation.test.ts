import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import * as THREE from 'three';

import { AnnotationMaterials } from '../core/AnnotationMaterials';

import { WeldAnnotation } from './WeldAnnotation';

describe('WeldAnnotation', () => {
  let materials: AnnotationMaterials;
  let weld: WeldAnnotation;

  beforeEach(() => {
    materials = new AnnotationMaterials();
  });

  afterEach(() => {
    weld?.dispose();
    materials.dispose();
  });

  describe('constructor', () => {
    it('should create a weld annotation at given position', () => {
      const position = new THREE.Vector3(5, 10, 15);

      weld = new WeldAnnotation(materials, {
        position,
        label: 'W1',
      });

      expect(weld).toBeInstanceOf(WeldAnnotation);
      expect(weld).toBeInstanceOf(THREE.Object3D);
    });

    it('should set default parameters', () => {
      const position = new THREE.Vector3(0, 0, 0);

      weld = new WeldAnnotation(materials, {
        position,
        label: 'W1',
      });

      const params = weld.getParams();
      expect(params.isShop).toBe(false);
      expect(params.crossSize).toBe(50);
    });

    it('should accept custom parameters', () => {
      const position = new THREE.Vector3(0, 0, 0);

      weld = new WeldAnnotation(materials, {
        position,
        label: 'W-001',
        isShop: true,
        crossSize: 100,
      });

      const params = weld.getParams();
      expect(params.label).toBe('W-001');
      expect(params.isShop).toBe(true);
      expect(params.crossSize).toBe(100);
    });

    it('should clone position vector', () => {
      const position = new THREE.Vector3(1, 2, 3);

      weld = new WeldAnnotation(materials, {
        position,
        label: 'W1',
      });

      // Modify original vector
      position.set(100, 100, 100);

      // Weld should retain original value
      const params = weld.getParams();
      expect(params.position.x).toBe(1);
      expect(params.position.y).toBe(2);
      expect(params.position.z).toBe(3);
    });

    it('should add child objects', () => {
      const position = new THREE.Vector3(0, 0, 0);

      weld = new WeldAnnotation(materials, {
        position,
        label: 'W1',
      });

      // Should have cross line and text label
      expect(weld.children.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getParams', () => {
    it('should return cloned position vector', () => {
      const position = new THREE.Vector3(5, 10, 15);

      weld = new WeldAnnotation(materials, {
        position,
        label: 'W1',
      });

      const params = weld.getParams();
      params.position.set(100, 100, 100);

      const params2 = weld.getParams();
      expect(params2.position.x).toBe(5);
      expect(params2.position.y).toBe(10);
      expect(params2.position.z).toBe(15);
    });
  });

  describe('setParams', () => {
    it('should update position', () => {
      const position = new THREE.Vector3(0, 0, 0);

      weld = new WeldAnnotation(materials, {
        position,
        label: 'W1',
      });

      weld.setParams({ position: new THREE.Vector3(10, 20, 30) });

      const params = weld.getParams();
      expect(params.position.x).toBe(10);
      expect(params.position.y).toBe(20);
      expect(params.position.z).toBe(30);
    });

    it('should update label', () => {
      const position = new THREE.Vector3(0, 0, 0);

      weld = new WeldAnnotation(materials, {
        position,
        label: 'W1',
      });

      weld.setParams({ label: 'W-UPDATED' });

      const params = weld.getParams();
      expect(params.label).toBe('W-UPDATED');
    });

    it('should update isShop', () => {
      const position = new THREE.Vector3(0, 0, 0);

      weld = new WeldAnnotation(materials, {
        position,
        label: 'W1',
        isShop: false,
      });

      weld.setParams({ isShop: true });

      const params = weld.getParams();
      expect(params.isShop).toBe(true);
    });

    it('should update crossSize', () => {
      const position = new THREE.Vector3(0, 0, 0);

      weld = new WeldAnnotation(materials, {
        position,
        label: 'W1',
      });

      weld.setParams({ crossSize: 200 });

      const params = weld.getParams();
      expect(params.crossSize).toBe(200);
    });
  });

  describe('setMaterialSet', () => {
    it('should change material set', () => {
      const position = new THREE.Vector3(0, 0, 0);

      weld = new WeldAnnotation(materials, {
        position,
        label: 'W1',
      });

      expect(() => weld.setMaterialSet(materials.blue)).not.toThrow();
    });
  });

  describe('highlighted', () => {
    it('should toggle highlight state', () => {
      const position = new THREE.Vector3(0, 0, 0);

      weld = new WeldAnnotation(materials, {
        position,
        label: 'W1',
      });

      expect(weld.highlighted).toBe(false);
      weld.highlighted = true;
      expect(weld.highlighted).toBe(true);
      weld.highlighted = false;
      expect(weld.highlighted).toBe(false);
    });

    it('should not trigger update if value unchanged', () => {
      const position = new THREE.Vector3(0, 0, 0);

      weld = new WeldAnnotation(materials, {
        position,
        label: 'W1',
      });

      const onHighlightChangedSpy = vi.spyOn(weld as never, 'onHighlightChanged');

      weld.highlighted = false;
      expect(onHighlightChangedSpy).not.toHaveBeenCalled();

      weld.highlighted = true;
      expect(onHighlightChangedSpy).toHaveBeenCalledWith(true);
    });
  });

  describe('update', () => {
    it('should update with perspective camera', () => {
      const position = new THREE.Vector3(0, 0, 0);

      weld = new WeldAnnotation(materials, {
        position,
        label: 'W1',
      });

      const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
      camera.position.set(0, 0, 10);

      expect(() => weld.update(camera)).not.toThrow();
    });

    it('should update with orthographic camera', () => {
      const position = new THREE.Vector3(0, 0, 0);

      weld = new WeldAnnotation(materials, {
        position,
        label: 'W1',
      });

      const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
      camera.position.set(0, 0, 10);

      expect(() => weld.update(camera)).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('should remove from parent', () => {
      const position = new THREE.Vector3(0, 0, 0);

      weld = new WeldAnnotation(materials, {
        position,
        label: 'W1',
      });

      const parent = new THREE.Group();
      parent.add(weld);

      expect(parent.children).toContain(weld);
      weld.dispose();
      expect(parent.children).not.toContain(weld);
    });
  });

  describe('shop vs field weld', () => {
    it('should differentiate shop weld', () => {
      const position = new THREE.Vector3(0, 0, 0);

      weld = new WeldAnnotation(materials, {
        position,
        label: 'SW-1',
        isShop: true,
      });

      const params = weld.getParams();
      expect(params.isShop).toBe(true);
    });

    it('should differentiate field weld', () => {
      const position = new THREE.Vector3(0, 0, 0);

      weld = new WeldAnnotation(materials, {
        position,
        label: 'FW-1',
        isShop: false,
      });

      const params = weld.getParams();
      expect(params.isShop).toBe(false);
    });
  });
});
