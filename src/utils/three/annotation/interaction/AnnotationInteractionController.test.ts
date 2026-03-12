import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import * as THREE from 'three';

import { LinearDimension } from '../annotations/LinearDimension';
import { AnnotationMaterials } from '../core/AnnotationMaterials';

import { AnnotationInteractionController } from './AnnotationInteractionController';

describe('AnnotationInteractionController', () => {
  let materials: AnnotationMaterials;
  let annotations: Map<string, LinearDimension>;
  let controller: AnnotationInteractionController;

  beforeEach(() => {
    materials = new AnnotationMaterials();
    annotations = new Map();

    // 创建一些测试标注
    const dim1 = new LinearDimension(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(10, 0, 0),
    });
    const dim2 = new LinearDimension(materials, {
      start: new THREE.Vector3(0, 10, 0),
      end: new THREE.Vector3(10, 10, 0),
    });

    annotations.set('dim1', dim1);
    annotations.set('dim2', dim2);

    controller = new AnnotationInteractionController(annotations);
  });

  afterEach(() => {
    controller.dispose();
    for (const annotation of annotations.values()) {
      annotation.dispose();
    }
    materials.dispose();
  });

  describe('constructor', () => {
    it('should create controller with default options', () => {
      expect(controller).toBeInstanceOf(AnnotationInteractionController);
    });

    it('should accept custom options', () => {
      const customController = new AnnotationInteractionController(annotations, {
        enableHover: false,
        enableClick: true,
        enableDrag: true,
        pickingTolerance: 20,
      });

      expect(customController).toBeInstanceOf(AnnotationInteractionController);
      customController.dispose();
    });
  });

  describe('state refs', () => {
    it('should have reactive hoveredId', () => {
      expect(controller.hoveredId.value).toBeNull();
    });

    it('should have reactive selectedId', () => {
      expect(controller.selectedId.value).toBeNull();
    });

    it('should have reactive isDragging', () => {
      expect(controller.isDragging.value).toBe(false);
    });
  });

  describe('setCamera', () => {
    it('should accept perspective camera', () => {
      const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
      expect(() => controller.setCamera(camera)).not.toThrow();
    });

    it('should accept orthographic camera', () => {
      const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
      expect(() => controller.setCamera(camera)).not.toThrow();
    });
  });

  describe('setAnnotations', () => {
    it('should update annotations reference', () => {
      const newAnnotations = new Map<string, LinearDimension>();
      expect(() => controller.setAnnotations(newAnnotations)).not.toThrow();
    });
  });

  describe('select', () => {
    it('should select annotation by id', () => {
      controller.select('dim1');
      expect(controller.selectedId.value).toBe('dim1');
    });

    it('should set selected state on annotation (SolveSpace: red)', () => {
      controller.select('dim1');
      expect(annotations.get('dim1')?.selected).toBe(true);
      // highlighted is hovered || selected, so should also be true
      expect(annotations.get('dim1')?.highlighted).toBe(true);
    });

    it('should deselect previous annotation when selecting new one', () => {
      controller.select('dim1');
      controller.select('dim2');

      expect(controller.selectedId.value).toBe('dim2');
      expect(annotations.get('dim1')?.selected).toBe(false);
      expect(annotations.get('dim2')?.selected).toBe(true);
    });

    it('should clear selection when passing null', () => {
      controller.select('dim1');
      controller.select(null);

      expect(controller.selectedId.value).toBeNull();
      expect(annotations.get('dim1')?.selected).toBe(false);
    });

    it('should have interactionState=selected when selected', () => {
      controller.select('dim1');
      expect(annotations.get('dim1')?.interactionState).toBe('selected');
    });

    it('should have interactionState=normal after deselect', () => {
      controller.select('dim1');
      controller.select(null);
      expect(annotations.get('dim1')?.interactionState).toBe('normal');
    });

    it('should not trigger if same id selected', () => {
      controller.select('dim1');
      const callback = vi.fn();
      controller.on(callback);

      controller.select('dim1');
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('clearSelection', () => {
    it('should clear current selection', () => {
      controller.select('dim1');
      controller.clearSelection();

      expect(controller.selectedId.value).toBeNull();
    });
  });

  describe('on', () => {
    it('should register callback', () => {
      const callback = vi.fn();
      controller.on(callback);

      controller.select('dim1');
      expect(callback).toHaveBeenCalled();
    });

    it('should return unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = controller.on(callback);

      unsubscribe();
      controller.select('dim1');
      expect(callback).not.toHaveBeenCalled();
    });

    it('should emit select event', () => {
      const callback = vi.fn();
      controller.on(callback);

      controller.select('dim1');

      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        type: 'select',
        id: 'dim1',
      }));
    });

    it('should emit deselect event', () => {
      controller.select('dim1');

      const callback = vi.fn();
      controller.on(callback);

      controller.select('dim2');

      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        type: 'deselect',
        id: 'dim1',
      }));
    });
  });

  describe('attach/detach', () => {
    it('should attach to DOM element', () => {
      const div = document.createElement('div');
      expect(() => controller.attach(div)).not.toThrow();
      controller.detach();
    });

    it('should detach from DOM element', () => {
      const div = document.createElement('div');
      controller.attach(div);
      expect(() => controller.detach()).not.toThrow();
    });

    it('should handle multiple attach calls', () => {
      const div1 = document.createElement('div');
      const div2 = document.createElement('div');

      controller.attach(div1);
      expect(() => controller.attach(div2)).not.toThrow();
      controller.detach();
    });
  });

  describe('dispose', () => {
    it('should clean up controller', () => {
      controller.select('dim1');
      const callback = vi.fn();
      controller.on(callback);

      controller.dispose();

      expect(controller.hoveredId.value).toBeNull();
      expect(controller.selectedId.value).toBeNull();
      expect(controller.isDragging.value).toBe(false);
    });

    it('should detach from DOM on dispose', () => {
      const div = document.createElement('div');
      controller.attach(div);
      controller.dispose();
      // Should not throw
    });
  });
});
