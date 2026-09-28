import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import * as THREE from 'three';

import { AnnotationMaterials } from '../core/AnnotationMaterials';

import { LeaderAnnotation } from './LeaderAnnotation';

describe('LeaderAnnotation', () => {
  let materials: AnnotationMaterials;
  let leader: LeaderAnnotation;

  beforeEach(() => {
    materials = new AnnotationMaterials();
  });

  afterEach(() => {
    leader?.dispose();
    materials.dispose();
  });

  describe('constructor', () => {
    it('should create a leader annotation with anchor and text position', () => {
      leader = new LeaderAnnotation(materials, {
        anchor: new THREE.Vector3(0, 0, 0),
        textPosition: new THREE.Vector3(10, 10, 0),
        text: 'hello',
      });

      expect(leader).toBeInstanceOf(LeaderAnnotation);
      expect(leader).toBeInstanceOf(THREE.Object3D);
    });

    it('should clone anchor/textPosition/bendPoint to avoid external mutation', () => {
      const anchor = new THREE.Vector3(1, 2, 3);
      const textPosition = new THREE.Vector3(4, 5, 6);
      const bendPoint = new THREE.Vector3(7, 8, 9);

      leader = new LeaderAnnotation(materials, {
        anchor,
        textPosition,
        text: 't',
        bendPoint,
      });

      anchor.set(99, 99, 99);
      textPosition.set(88, 88, 88);
      bendPoint.set(77, 77, 77);

      const params = leader.getParams();
      expect(params.anchor.x).toBe(1);
      expect(params.textPosition.x).toBe(4);
      expect(params.bendPoint?.x).toBe(7);
    });
  });

  describe('SolveSpace-style interaction state materials', () => {
    function makeLeader() {
      return new LeaderAnnotation(materials, {
        anchor: new THREE.Vector3(0, 0, 0),
        textPosition: new THREE.Vector3(1, 1, 0),
        text: 'L',
      });
    }

    it('should start in normal state with base materialSet', () => {
      leader = makeLeader();
      // Line2 使用 fatLine，此处 LeaderAnnotation 的 leaderLine 实际绑定的是 materialSet.line（LineBasicMaterial）。
      // 只需验证状态与 DOM 分类能正确切换。
      expect(leader.interactionState).toBe('normal');
      const labelEl = (leader as unknown as { textLabel: { element: HTMLElement } }).textLabel.element;
      expect(labelEl.classList.contains('annotation-label--hovered')).toBe(false);
      expect(labelEl.classList.contains('annotation-label--selected')).toBe(false);
      expect(labelEl.classList.contains('annotation-label--active')).toBe(false);
    });

    it('hovered state should swap in ssHovered materials and tag DOM', () => {
      leader = makeLeader();
      leader.hovered = true;

      expect(leader.interactionState).toBe('hovered');

      const { leaderLine, arrowHead } = leader as unknown as {
        leaderLine: { material: THREE.Material };
        arrowHead: { material: THREE.Material };
      };
      expect(leaderLine.material).toBe(materials.ssHovered.line);
      expect(arrowHead.material).toBe(materials.ssHovered.mesh);

      const labelEl = (leader as unknown as { textLabel: { element: HTMLElement } }).textLabel.element;
      expect(labelEl.classList.contains('annotation-label--hovered')).toBe(true);
      expect(labelEl.classList.contains('annotation-label--selected')).toBe(false);
      expect(labelEl.classList.contains('annotation-label--active')).toBe(true);
    });

    it('selected state should swap in ssSelected materials and take priority over hovered', () => {
      leader = makeLeader();
      leader.hovered = true;
      leader.selected = true;

      expect(leader.interactionState).toBe('selected');

      const { leaderLine, arrowHead } = leader as unknown as {
        leaderLine: { material: THREE.Material };
        arrowHead: { material: THREE.Material };
      };
      expect(leaderLine.material).toBe(materials.ssSelected.line);
      expect(arrowHead.material).toBe(materials.ssSelected.mesh);

      const labelEl = (leader as unknown as { textLabel: { element: HTMLElement } }).textLabel.element;
      expect(labelEl.classList.contains('annotation-label--selected')).toBe(true);
      expect(labelEl.classList.contains('annotation-label--hovered')).toBe(false);
      expect(labelEl.classList.contains('annotation-label--active')).toBe(true);
    });

    it('returning to normal should restore the base materialSet', () => {
      leader = makeLeader();
      leader.hovered = true;
      leader.selected = true;
      leader.selected = false;
      leader.hovered = false;

      expect(leader.interactionState).toBe('normal');

      const { leaderLine, arrowHead } = leader as unknown as {
        leaderLine: { material: THREE.Material };
        arrowHead: { material: THREE.Material };
      };
      // LeaderAnnotation 构造时默认使用 materials.blue，normal 恢复到 blue.line / blue.mesh
      expect(leaderLine.material).toBe(materials.blue.line);
      expect(arrowHead.material).toBe(materials.blue.mesh);
    });
  });

  describe('setMaterialSet', () => {
    it('should swap base material set and reflect on next state change', () => {
      leader = new LeaderAnnotation(materials, {
        anchor: new THREE.Vector3(0, 0, 0),
        textPosition: new THREE.Vector3(1, 1, 0),
        text: 'L',
      });

      leader.setMaterialSet(materials.green);

      const { leaderLine, arrowHead } = leader as unknown as {
        leaderLine: { material: THREE.Material };
        arrowHead: { material: THREE.Material };
      };
      // setMaterialSet 直接 applyMaterials()，normal 状态下应立即切到 green
      expect(leaderLine.material).toBe(materials.green.line);
      expect(arrowHead.material).toBe(materials.green.mesh);
    });
  });

  describe('dispose', () => {
    it('should remove from parent', () => {
      leader = new LeaderAnnotation(materials, {
        anchor: new THREE.Vector3(0, 0, 0),
        textPosition: new THREE.Vector3(1, 1, 0),
        text: 'L',
      });
      const parent = new THREE.Group();
      parent.add(leader);
      leader.dispose();
      expect(parent.children).not.toContain(leader);
    });
  });
});
