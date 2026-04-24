import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import * as THREE from 'three';

import { AnnotationMaterials } from './AnnotationMaterials';

describe('AnnotationMaterials', () => {
  let materials: AnnotationMaterials;

  beforeEach(() => {
    materials = new AnnotationMaterials();
  });

  afterEach(() => {
    materials.dispose();
  });

  describe('constructor', () => {
    it('should create all predefined color sets', () => {
      expect(materials.green).toBeDefined();
      expect(materials.orange).toBeDefined();
      expect(materials.blue).toBeDefined();
      expect(materials.white).toBeDefined();
      expect(materials.yellow).toBeDefined();
      expect(materials.ssConstraintMagenta).toBeDefined();
    });

    it('should return all color sets via all getter', () => {
      const allSets = materials.all;
      expect(allSets).toHaveLength(10);
      expect(allSets).toContain(materials.green);
      expect(allSets).toContain(materials.orange);
      expect(allSets).toContain(materials.blue);
      expect(allSets).toContain(materials.white);
      expect(allSets).toContain(materials.yellow);
      expect(allSets).toContain(materials.black);
      expect(allSets).toContain(materials.ssConstraintMagenta);
      expect(allSets).toContain(materials.ssDimensionDefault);
      expect(allSets).toContain(materials.ssHovered);
      expect(allSets).toContain(materials.ssSelected);
    });
  });

  describe('material sets', () => {
    it('should have line materials of type LineBasicMaterial', () => {
      expect(materials.green.line).toBeInstanceOf(THREE.LineBasicMaterial);
      expect(materials.green.lineHover).toBeInstanceOf(THREE.LineBasicMaterial);
    });

    it('should have mesh materials of type MeshBasicMaterial', () => {
      expect(materials.green.mesh).toBeInstanceOf(THREE.MeshBasicMaterial);
      expect(materials.green.meshHover).toBeInstanceOf(THREE.MeshBasicMaterial);
    });

    it('should have correct colors for green set', () => {
      expect(materials.green.line.color.getHex()).toBe(0x22c55e);
      expect(materials.green.lineHover.color.getHex()).toBe(0x4ade80);
    });

    it('should have correct colors for orange set', () => {
      expect(materials.orange.line.color.getHex()).toBe(0xf97316);
      expect(materials.orange.lineHover.color.getHex()).toBe(0xfb923c);
    });

    it('should have correct colors for blue set', () => {
      expect(materials.blue.line.color.getHex()).toBe(0x3b82f6);
      expect(materials.blue.lineHover.color.getHex()).toBe(0x60a5fa);
    });

    it('should have correct colors for SolveSpace magenta set', () => {
      expect(materials.ssConstraintMagenta.line.color.getHex()).toBe(0xff00ff);
      expect(materials.ssConstraintMagenta.lineHover.color.getHex()).toBe(0xff44ff);
    });

    it('should have depth test enabled by default', () => {
      expect(materials.green.line.depthTest).toBe(true);
      expect(materials.green.mesh.depthTest).toBe(true);
    });

    it('should have polygon offset enabled', () => {
      expect(materials.green.line.polygonOffset).toBe(true);
      expect(materials.green.mesh.polygonOffset).toBe(true);
    });
  });

  describe('setResolution', () => {
    it('should be a no-op for native GL lines (no throw)', () => {
      expect(() => materials.setResolution(1920, 1080)).not.toThrow();
    });
  });

  describe('text materials', () => {
    it('should keep text strokes at configured linewidth', () => {
      expect(materials.green.textFatLine.linewidth).toBe(5);
      expect(materials.green.textFatLineHover.linewidth).toBe(5);
    });
  });

  describe('dispose', () => {
    it('should dispose all materials', () => {
      const lineSpy = vi.spyOn(materials.green.line, 'dispose');
      const lineHoverSpy = vi.spyOn(materials.green.lineHover, 'dispose');
      const meshSpy = vi.spyOn(materials.green.mesh, 'dispose');
      const meshHoverSpy = vi.spyOn(materials.green.meshHover, 'dispose');

      materials.dispose();

      expect(lineSpy).toHaveBeenCalled();
      expect(lineHoverSpy).toHaveBeenCalled();
      expect(meshSpy).toHaveBeenCalled();
      expect(meshHoverSpy).toHaveBeenCalled();
    });
  });
});
