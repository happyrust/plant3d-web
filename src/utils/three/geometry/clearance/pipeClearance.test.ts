import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { computePipeToWallClearance, computePipeToColumnClearance } from './pipeClearance'

describe('pipeClearance', () => {
  it('pipe-to-wall: should compute surface clearance', () => {
    const r = 1
    const gap = 0.5
    const res = computePipeToWallClearance({
      pipeCenter: new THREE.Vector3(r + gap, 0, 0),
      pipeRadius: r,
      wallPoint: new THREE.Vector3(0, 0, 0),
      wallNormal: new THREE.Vector3(1, 0, 0),
    })
    expect(res).not.toBeNull()
    expect(res!.distance).toBeCloseTo(gap, 8)
    expect(res!.otherSurfacePoint.x).toBeCloseTo(0, 8)
    expect(res!.pipeSurfacePoint.x).toBeCloseTo(gap, 8) // 管外壁到墙：x=gap
  })

  it('pipe-to-column: should compute surface clearance for parallel cylinders', () => {
    const pipeR = 1
    const colR = 2
    const gap = 0.5
    const res = computePipeToColumnClearance({
      pipeCenter: new THREE.Vector3(0, 0, 0),
      pipeRadius: pipeR,
      columnCenter: new THREE.Vector3(pipeR + colR + gap, 0, 0),
      columnRadius: colR,
      axis: new THREE.Vector3(0, 1, 0),
    })
    expect(res).not.toBeNull()
    expect(res!.distance).toBeCloseTo(gap, 8)
  })

  it('pipe-to-column: degenerates when centers overlap laterally', () => {
    const res = computePipeToColumnClearance({
      pipeCenter: new THREE.Vector3(0, 0, 0),
      pipeRadius: 1,
      columnCenter: new THREE.Vector3(0, 10, 0),
      columnRadius: 1,
      axis: new THREE.Vector3(0, 1, 0),
    })
    expect(res).toBeNull()
  })
})

