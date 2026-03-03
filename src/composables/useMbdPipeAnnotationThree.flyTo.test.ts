import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Matrix4, PerspectiveCamera, Scene } from 'three'
import { ref } from 'vue'

import type { MbdPipeData } from '@/api/mbdPipeApi'

import { useMbdPipeAnnotationThree } from './useMbdPipeAnnotationThree'

describe('useMbdPipeAnnotationThree.flyTo', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('仅有 bends 数据时也应触发 flyTo', () => {
    const flyTo = vi.fn()
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo,
    } as any

    const vis = useMbdPipeAnnotationThree(
      ref(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() }
    )

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [],
      dims: [],
      welds: [],
      slopes: [],
      bends: [
        {
          id: 'bend-1',
          refno: '24381_145019',
          noun: 'ELBO',
          angle: 90,
          radius: 250,
          work_point: [0, 0, 0],
          face_center_1: [1000, 0, 0],
          face_center_2: [0, 1000, 0],
        },
      ],
      stats: {
        segments_count: 0,
        dims_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 1,
      },
    }

    vis.renderBranch(data)
    vis.flyTo()

    expect(flyTo).toHaveBeenCalledTimes(1)
  })
})
