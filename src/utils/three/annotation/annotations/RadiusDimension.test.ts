import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import * as THREE from 'three';

import { AnnotationMaterials } from '../core/AnnotationMaterials';

import { RadiusDimension } from './RadiusDimension';

describe('RadiusDimension', () => {
  let materials: AnnotationMaterials;
  let radius: RadiusDimension;

  beforeEach(() => {
    materials = new AnnotationMaterials();
  });

  afterEach(() => {
    radius?.dispose();
    materials.dispose();
  });

  describe('constructor', () => {
    it('should create a radius dimension with center and radius', () => {
      const center = new THREE.Vector3(0, 0, 0);

      radius = new RadiusDimension(materials, { center, radius: 5 });

      expect(radius).toBeInstanceOf(RadiusDimension);
      expect(radius).toBeInstanceOf(THREE.Object3D);
    });

    it('should set default parameters', () => {
      const center = new THREE.Vector3(0, 0, 0);

      radius = new RadiusDimension(materials, { center, radius: 5 });
      const params = radius.getParams();

      expect(params.direction.x).toBe(1);
      expect(params.direction.y).toBe(0);
      expect(params.direction.z).toBe(0);
      expect(params.unit).toBe('');
      expect(params.decimals).toBe(1);
      expect(params.showDiameter).toBe(false);
    });

    it('should accept custom parameters', () => {
      const center = new THREE.Vector3(0, 0, 0);
      const direction = new THREE.Vector3(0, 1, 0);

      radius = new RadiusDimension(materials, {
        center,
        radius: 10,
        direction,
        text: 'Custom',
        unit: 'mm',
        decimals: 2,
        showDiameter: true,
      });

      const params = radius.getParams();
      expect(params.radius).toBe(10);
      expect(params.direction.y).toBe(1);
      expect(params.text).toBe('Custom');
      expect(params.unit).toBe('mm');
      expect(params.decimals).toBe(2);
      expect(params.showDiameter).toBe(true);
    });

    it('should clone vectors', () => {
      const center = new THREE.Vector3(5, 10, 15);
      const direction = new THREE.Vector3(0, 1, 0);

      radius = new RadiusDimension(materials, { center, radius: 5, direction });

      center.set(100, 100, 100);
      direction.set(0, 0, 1);

      const params = radius.getParams();
      expect(params.center.x).toBe(5);
      expect(params.direction.y).toBe(1);
    });
  });

  describe('getParams', () => {
    it('should return cloned vectors', () => {
      const center = new THREE.Vector3(0, 0, 0);

      radius = new RadiusDimension(materials, { center, radius: 5 });
      const params = radius.getParams();

      params.center.set(100, 100, 100);

      const params2 = radius.getParams();
      expect(params2.center.x).toBe(0);
    });
  });

  describe('setParams', () => {
    it('should update center', () => {
      const center = new THREE.Vector3(0, 0, 0);

      radius = new RadiusDimension(materials, { center, radius: 5 });
      radius.setParams({ center: new THREE.Vector3(10, 20, 30) });

      const params = radius.getParams();
      expect(params.center.x).toBe(10);
      expect(params.center.y).toBe(20);
      expect(params.center.z).toBe(30);
    });

    it('should update radius value', () => {
      const center = new THREE.Vector3(0, 0, 0);

      radius = new RadiusDimension(materials, { center, radius: 5 });
      radius.setParams({ radius: 20 });

      const params = radius.getParams();
      expect(params.radius).toBe(20);
    });

    it('should update direction', () => {
      const center = new THREE.Vector3(0, 0, 0);

      radius = new RadiusDimension(materials, { center, radius: 5 });
      radius.setParams({ direction: new THREE.Vector3(0, 0, 1) });

      const params = radius.getParams();
      expect(params.direction.z).toBe(1);
    });

    it('should toggle showDiameter', () => {
      const center = new THREE.Vector3(0, 0, 0);

      radius = new RadiusDimension(materials, { center, radius: 5, showDiameter: false });
      radius.setParams({ showDiameter: true });

      const params = radius.getParams();
      expect(params.showDiameter).toBe(true);
    });
  });

  describe('setMaterialSet', () => {
    it('should change material set', () => {
      const center = new THREE.Vector3(0, 0, 0);

      radius = new RadiusDimension(materials, { center, radius: 5 });

      expect(() => radius.setMaterialSet(materials.orange)).not.toThrow();
    });
  });

  describe('highlighted', () => {
    it('should toggle highlight state', () => {
      const center = new THREE.Vector3(0, 0, 0);

      radius = new RadiusDimension(materials, { center, radius: 5 });

      expect(radius.highlighted).toBe(false);
      radius.highlighted = true;
      expect(radius.highlighted).toBe(true);
      radius.highlighted = false;
      expect(radius.highlighted).toBe(false);
    });
  });

  describe('update', () => {
    it('should update with perspective camera', () => {
      const center = new THREE.Vector3(0, 0, 0);

      radius = new RadiusDimension(materials, { center, radius: 5 });
      const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
      camera.position.set(0, 0, 10);

      expect(() => radius.update(camera)).not.toThrow();
    });

    it('should update with orthographic camera', () => {
      const center = new THREE.Vector3(0, 0, 0);

      radius = new RadiusDimension(materials, { center, radius: 5 });
      const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
      camera.position.set(0, 0, 10);

      expect(() => radius.update(camera)).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('should remove from parent', () => {
      const center = new THREE.Vector3(0, 0, 0);

      radius = new RadiusDimension(materials, { center, radius: 5 });
      const parent = new THREE.Group();
      parent.add(radius);

      expect(parent.children).toContain(radius);
      radius.dispose();
      expect(parent.children).not.toContain(radius);
    });
  });

  describe('radius vs diameter mode', () => {
    it('should handle radius mode', () => {
      const center = new THREE.Vector3(0, 0, 0);

      radius = new RadiusDimension(materials, { center, radius: 5, showDiameter: false });

      const params = radius.getParams();
      expect(params.showDiameter).toBe(false);
    });

    it('should handle diameter mode', () => {
      const center = new THREE.Vector3(0, 0, 0);

      radius = new RadiusDimension(materials, { center, radius: 5, showDiameter: true });

      const params = radius.getParams();
      expect(params.showDiameter).toBe(true);
    });
  });
});
