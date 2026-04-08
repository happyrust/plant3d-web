import { describe, expect, it } from 'vitest';
import { ref, shallowRef } from 'vue';

import { Matrix4, PerspectiveCamera, Scene } from 'three';

import { resolveMbdDimensionMaterialSet } from './mbdDimensionMode';

import { useMbdPipeAnnotationThree } from '@/composables/useMbdPipeAnnotationThree';
import { AnnotationMaterials } from '@/utils/three/annotation';

describe('mbdDimensionMode', () => {
  it('rebarviz 模式下链式与总长应保持图一的紫色系', () => {
    const materials = new AnnotationMaterials();

    expect(
      resolveMbdDimensionMaterialSet(materials, 'chain', 'rebarviz'),
    ).toBe(materials.ssDimensionDefault);
    expect(
      resolveMbdDimensionMaterialSet(materials, 'overall', 'rebarviz'),
    ).toBe(materials.ssDimensionDefault);
  });

  it('施工模式下焊缝与坡度应走图一的深色系', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: () => undefined,
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    vis.applyModeDefaults('construction');
    vis.renderBranch({
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [],
      dims: [],
      bends: [],
      welds: [
        {
          id: 'weld-1',
          position: [0, 0, 0],
          weld_type: 'Butt',
          is_shop: false,
          label: '214',
          left_refno: 'A',
          right_refno: 'B',
        },
      ],
      slopes: [
        {
          id: 'slope-1',
          start: [0, 0, 0],
          end: [1000, 0, 0],
          slope: 0.01,
          text: '1%',
        },
      ],
      stats: {
        segments_count: 0,
        dims_count: 0,
        welds_count: 1,
        slopes_count: 1,
        bends_count: 0,
      },
    });

    const weld = vis.getWeldAnnotations().get('weld-1') as any;
    const slope = vis.getSlopeAnnotations().get('slope-1') as any;

    expect(weld?.materialSet?.line?.color?.getHex?.()).toBe(0x000000);
    expect(slope?.materialSet?.line?.color?.getHex?.()).toBe(0x000000);
  });
});
