import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as THREE from 'three'
import { AlignedDimension } from './AlignedDimension'
import { AnnotationMaterials } from '../core/AnnotationMaterials'

describe('AlignedDimension', () => {
  let materials: AnnotationMaterials
  let aligned: AlignedDimension

  beforeEach(() => {
    materials = new AnnotationMaterials()
  })

  afterEach(() => {
    aligned?.dispose()
    materials.dispose()
  })

  describe('constructor', () => {
    it('should create an aligned dimension with start and end points', () => {
      const start = new THREE.Vector3(0, 0, 0)
      const end = new THREE.Vector3(10, 10, 0)

      aligned = new AlignedDimension(materials, { start, end })

      expect(aligned).toBeInstanceOf(AlignedDimension)
      expect(aligned).toBeInstanceOf(THREE.Object3D)
    })

    it('should set default parameters', () => {
      const start = new THREE.Vector3(0, 0, 0)
      const end = new THREE.Vector3(10, 10, 0)

      aligned = new AlignedDimension(materials, { start, end })
      const params = aligned.getParams()

      expect(params.unit).toBe('')
      expect(params.decimals).toBe(1)
      expect(params.textOffset).toBe(0)
    })

    it('should accept custom parameters', () => {
      const start = new THREE.Vector3(0, 0, 0)
      const end = new THREE.Vector3(10, 10, 0)

      aligned = new AlignedDimension(materials, {
        start,
        end,
        text: 'Custom',
        unit: 'mm',
        decimals: 2,
        textOffset: 5,
      })

      const params = aligned.getParams()
      expect(params.text).toBe('Custom')
      expect(params.unit).toBe('mm')
      expect(params.decimals).toBe(2)
      expect(params.textOffset).toBe(5)
    })

    it('should clone vectors', () => {
      const start = new THREE.Vector3(1, 2, 3)
      const end = new THREE.Vector3(4, 5, 6)

      aligned = new AlignedDimension(materials, { start, end })

      start.set(100, 100, 100)
      end.set(200, 200, 200)

      const params = aligned.getParams()
      expect(params.start.x).toBe(1)
      expect(params.end.x).toBe(4)
    })
  })

  describe('getDistance', () => {
    it('should calculate correct distance for horizontal line', () => {
      const start = new THREE.Vector3(0, 0, 0)
      const end = new THREE.Vector3(10, 0, 0)

      aligned = new AlignedDimension(materials, { start, end })

      expect(aligned.getDistance()).toBe(10)
    })

    it('should calculate correct distance for diagonal line', () => {
      const start = new THREE.Vector3(0, 0, 0)
      const end = new THREE.Vector3(3, 4, 0)

      aligned = new AlignedDimension(materials, { start, end })

      expect(aligned.getDistance()).toBe(5)
    })

    it('should calculate correct distance for 3D line', () => {
      const start = new THREE.Vector3(0, 0, 0)
      const end = new THREE.Vector3(1, 2, 2)

      aligned = new AlignedDimension(materials, { start, end })

      expect(aligned.getDistance()).toBe(3)
    })
  })

  describe('getParams', () => {
    it('should return cloned vectors', () => {
      const start = new THREE.Vector3(0, 0, 0)
      const end = new THREE.Vector3(10, 10, 0)

      aligned = new AlignedDimension(materials, { start, end })
      const params = aligned.getParams()

      params.start.set(100, 100, 100)
      params.end.set(200, 200, 200)

      const params2 = aligned.getParams()
      expect(params2.start.x).toBe(0)
      expect(params2.end.x).toBe(10)
    })
  })

  describe('setParams', () => {
    it('should update start point', () => {
      const start = new THREE.Vector3(0, 0, 0)
      const end = new THREE.Vector3(10, 10, 0)

      aligned = new AlignedDimension(materials, { start, end })
      aligned.setParams({ start: new THREE.Vector3(5, 5, 5) })

      const params = aligned.getParams()
      expect(params.start.x).toBe(5)
    })

    it('should update end point', () => {
      const start = new THREE.Vector3(0, 0, 0)
      const end = new THREE.Vector3(10, 10, 0)

      aligned = new AlignedDimension(materials, { start, end })
      aligned.setParams({ end: new THREE.Vector3(20, 20, 0) })

      const params = aligned.getParams()
      expect(params.end.x).toBe(20)
    })

    it('should update text', () => {
      const start = new THREE.Vector3(0, 0, 0)
      const end = new THREE.Vector3(10, 10, 0)

      aligned = new AlignedDimension(materials, { start, end })
      aligned.setParams({ text: 'New Text' })

      const params = aligned.getParams()
      expect(params.text).toBe('New Text')
    })

    it('should update textOffset', () => {
      const start = new THREE.Vector3(0, 0, 0)
      const end = new THREE.Vector3(10, 10, 0)

      aligned = new AlignedDimension(materials, { start, end })
      aligned.setParams({ textOffset: 10 })

      const params = aligned.getParams()
      expect(params.textOffset).toBe(10)
    })
  })

  describe('setMaterialSet', () => {
    it('should change material set', () => {
      const start = new THREE.Vector3(0, 0, 0)
      const end = new THREE.Vector3(10, 10, 0)

      aligned = new AlignedDimension(materials, { start, end })

      expect(() => aligned.setMaterialSet(materials.blue)).not.toThrow()
    })
  })

  describe('highlighted', () => {
    it('should toggle highlight state', () => {
      const start = new THREE.Vector3(0, 0, 0)
      const end = new THREE.Vector3(10, 10, 0)

      aligned = new AlignedDimension(materials, { start, end })

      expect(aligned.highlighted).toBe(false)
      aligned.highlighted = true
      expect(aligned.highlighted).toBe(true)
      aligned.highlighted = false
      expect(aligned.highlighted).toBe(false)
    })
  })

  describe('update', () => {
    it('should update with perspective camera', () => {
      const start = new THREE.Vector3(0, 0, 0)
      const end = new THREE.Vector3(10, 10, 0)

      aligned = new AlignedDimension(materials, { start, end })
      const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000)
      camera.position.set(0, 0, 10)

      expect(() => aligned.update(camera)).not.toThrow()
    })

    it('should update with orthographic camera', () => {
      const start = new THREE.Vector3(0, 0, 0)
      const end = new THREE.Vector3(10, 10, 0)

      aligned = new AlignedDimension(materials, { start, end })
      const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
      camera.position.set(0, 0, 10)

      expect(() => aligned.update(camera)).not.toThrow()
    })
  })

  describe('dispose', () => {
    it('should remove from parent', () => {
      const start = new THREE.Vector3(0, 0, 0)
      const end = new THREE.Vector3(10, 10, 0)

      aligned = new AlignedDimension(materials, { start, end })
      const parent = new THREE.Group()
      parent.add(aligned)

      expect(parent.children).toContain(aligned)
      aligned.dispose()
      expect(parent.children).not.toContain(aligned)
    })
  })
})
