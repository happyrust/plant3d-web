import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import * as THREE from 'three';

import { AnnotationMaterials } from '../core/AnnotationMaterials';

import { AngleDimension } from './AngleDimension';

describe('AngleDimension', () => {
  let materials: AnnotationMaterials;
  let angle: AngleDimension;

  beforeEach(() => {
    materials = new AnnotationMaterials();
  });

  afterEach(() => {
    angle?.dispose();
    materials.dispose();
  });

  describe('constructor', () => {
    it('should create an angle dimension with vertex and two points', () => {
      const vertex = new THREE.Vector3(0, 0, 0);
      const point1 = new THREE.Vector3(10, 0, 0);
      const point2 = new THREE.Vector3(0, 10, 0);

      angle = new AngleDimension(materials, { vertex, point1, point2 });

      expect(angle).toBeInstanceOf(AngleDimension);
      expect(angle).toBeInstanceOf(THREE.Object3D);
    });

    it('should set default parameters', () => {
      const vertex = new THREE.Vector3(0, 0, 0);
      const point1 = new THREE.Vector3(10, 0, 0);
      const point2 = new THREE.Vector3(0, 10, 0);

      angle = new AngleDimension(materials, { vertex, point1, point2 });
      const params = angle.getParams();

      expect(params.arcRadius).toBe(1);
      expect(params.unit).toBe('°');
      expect(params.decimals).toBe(1);
      expect(params.arcSegments).toBe(32);
    });

    it('should accept custom parameters', () => {
      const vertex = new THREE.Vector3(0, 0, 0);
      const point1 = new THREE.Vector3(10, 0, 0);
      const point2 = new THREE.Vector3(0, 10, 0);

      angle = new AngleDimension(materials, {
        vertex,
        point1,
        point2,
        arcRadius: 5,
        text: '90°',
        unit: ' deg',
        decimals: 0,
        arcSegments: 16,
      });

      const params = angle.getParams();
      expect(params.arcRadius).toBe(5);
      expect(params.text).toBe('90°');
      expect(params.unit).toBe(' deg');
      expect(params.decimals).toBe(0);
      expect(params.arcSegments).toBe(16);
    });

    it('should clone vectors', () => {
      const vertex = new THREE.Vector3(0, 0, 0);
      const point1 = new THREE.Vector3(10, 0, 0);
      const point2 = new THREE.Vector3(0, 10, 0);

      angle = new AngleDimension(materials, { vertex, point1, point2 });

      vertex.set(100, 100, 100);
      point1.set(200, 200, 200);

      const params = angle.getParams();
      expect(params.vertex.x).toBe(0);
      expect(params.point1.x).toBe(10);
    });
  });

  describe('getAngleDegrees', () => {
    it('should calculate 90 degree angle', () => {
      const vertex = new THREE.Vector3(0, 0, 0);
      const point1 = new THREE.Vector3(10, 0, 0);
      const point2 = new THREE.Vector3(0, 10, 0);

      angle = new AngleDimension(materials, { vertex, point1, point2 });

      expect(angle.getAngleDegrees()).toBeCloseTo(90, 5);
    });

    it('should calculate 45 degree angle', () => {
      const vertex = new THREE.Vector3(0, 0, 0);
      const point1 = new THREE.Vector3(10, 0, 0);
      const point2 = new THREE.Vector3(10, 10, 0);

      angle = new AngleDimension(materials, { vertex, point1, point2 });

      expect(angle.getAngleDegrees()).toBeCloseTo(45, 5);
    });

    it('should calculate 180 degree angle', () => {
      const vertex = new THREE.Vector3(0, 0, 0);
      const point1 = new THREE.Vector3(10, 0, 0);
      const point2 = new THREE.Vector3(-10, 0, 0);

      angle = new AngleDimension(materials, { vertex, point1, point2 });

      expect(angle.getAngleDegrees()).toBeCloseTo(180, 5);
    });

    it('should calculate 0 degree angle (parallel vectors)', () => {
      const vertex = new THREE.Vector3(0, 0, 0);
      const point1 = new THREE.Vector3(10, 0, 0);
      const point2 = new THREE.Vector3(20, 0, 0);

      angle = new AngleDimension(materials, { vertex, point1, point2 });

      expect(angle.getAngleDegrees()).toBeCloseTo(0, 5);
    });
  });

  describe('getAngleRadians', () => {
    it('should return angle in radians', () => {
      const vertex = new THREE.Vector3(0, 0, 0);
      const point1 = new THREE.Vector3(10, 0, 0);
      const point2 = new THREE.Vector3(0, 10, 0);

      angle = new AngleDimension(materials, { vertex, point1, point2 });

      expect(angle.getAngleRadians()).toBeCloseTo(Math.PI / 2, 5);
    });
  });

  describe('setParams', () => {
    it('should update vertex', () => {
      const vertex = new THREE.Vector3(0, 0, 0);
      const point1 = new THREE.Vector3(10, 0, 0);
      const point2 = new THREE.Vector3(0, 10, 0);

      angle = new AngleDimension(materials, { vertex, point1, point2 });
      angle.setParams({ vertex: new THREE.Vector3(5, 5, 5) });

      const params = angle.getParams();
      expect(params.vertex.x).toBe(5);
    });

    it('should update arcRadius', () => {
      const vertex = new THREE.Vector3(0, 0, 0);
      const point1 = new THREE.Vector3(10, 0, 0);
      const point2 = new THREE.Vector3(0, 10, 0);

      angle = new AngleDimension(materials, { vertex, point1, point2 });
      angle.setParams({ arcRadius: 10 });

      const params = angle.getParams();
      expect(params.arcRadius).toBe(10);
    });
  });

  describe('highlighted', () => {
    it('should toggle highlight state', () => {
      const vertex = new THREE.Vector3(0, 0, 0);
      const point1 = new THREE.Vector3(10, 0, 0);
      const point2 = new THREE.Vector3(0, 10, 0);

      angle = new AngleDimension(materials, { vertex, point1, point2 });

      expect(angle.highlighted).toBe(false);
      angle.highlighted = true;
      expect(angle.highlighted).toBe(true);
    });
  });

  describe('update', () => {
    it('should update with camera', () => {
      const vertex = new THREE.Vector3(0, 0, 0);
      const point1 = new THREE.Vector3(10, 0, 0);
      const point2 = new THREE.Vector3(0, 10, 0);

      angle = new AngleDimension(materials, { vertex, point1, point2 });
      const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
      camera.position.set(0, 0, 10);

      expect(() => angle.update(camera)).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('should remove from parent', () => {
      const vertex = new THREE.Vector3(0, 0, 0);
      const point1 = new THREE.Vector3(10, 0, 0);
      const point2 = new THREE.Vector3(0, 10, 0);

      angle = new AngleDimension(materials, { vertex, point1, point2 });
      const parent = new THREE.Group();
      parent.add(angle);

      expect(parent.children).toContain(angle);
      angle.dispose();
      expect(parent.children).not.toContain(angle);
    });
  });
});
