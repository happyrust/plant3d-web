import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { AnnotationMaterials } from './AnnotationMaterials'

describe('AnnotationMaterials', () => {
  let materials: AnnotationMaterials

  beforeEach(() => {
    materials = new AnnotationMaterials()
  })

  afterEach(() => {
    materials.dispose()
  })

  describe('constructor', () => {
    it('should create all predefined color sets', () => {
      expect(materials.green).toBeDefined()
      expect(materials.orange).toBeDefined()
      expect(materials.blue).toBeDefined()
      expect(materials.white).toBeDefined()
      expect(materials.yellow).toBeDefined()
    })

    it('should return all color sets via all getter', () => {
      const allSets = materials.all
      expect(allSets).toHaveLength(5)
      expect(allSets).toContain(materials.green)
      expect(allSets).toContain(materials.orange)
      expect(allSets).toContain(materials.blue)
      expect(allSets).toContain(materials.white)
      expect(allSets).toContain(materials.yellow)
    })
  })

  describe('material sets', () => {
    it('should have line materials of type LineMaterial', () => {
      expect(materials.green.line).toBeInstanceOf(LineMaterial)
      expect(materials.green.lineHover).toBeInstanceOf(LineMaterial)
    })

    it('should have mesh materials of type MeshBasicMaterial', () => {
      expect(materials.green.mesh).toBeInstanceOf(THREE.MeshBasicMaterial)
      expect(materials.green.meshHover).toBeInstanceOf(THREE.MeshBasicMaterial)
    })

    it('should have correct colors for green set', () => {
      expect(materials.green.line.color.getHex()).toBe(0x22c55e)
      expect(materials.green.lineHover.color.getHex()).toBe(0x4ade80)
    })

    it('should have correct colors for orange set', () => {
      expect(materials.orange.line.color.getHex()).toBe(0xf97316)
      expect(materials.orange.lineHover.color.getHex()).toBe(0xfb923c)
    })

    it('should have correct colors for blue set', () => {
      expect(materials.blue.line.color.getHex()).toBe(0x3b82f6)
      expect(materials.blue.lineHover.color.getHex()).toBe(0x60a5fa)
    })

    it('should have hover line thicker than normal line', () => {
      expect(materials.green.lineHover.linewidth).toBeGreaterThan(materials.green.line.linewidth)
    })

    it('should have depth test enabled by default', () => {
      expect(materials.green.line.depthTest).toBe(true)
      expect(materials.green.mesh.depthTest).toBe(true)
    })

    it('should have polygon offset enabled', () => {
      expect(materials.green.line.polygonOffset).toBe(true)
      expect(materials.green.mesh.polygonOffset).toBe(true)
    })
  })

  describe('setResolution', () => {
    it('should update resolution on all line materials', () => {
      const width = 1920
      const height = 1080

      materials.setResolution(width, height)

      for (const set of materials.all) {
        expect(set.line.resolution.x).toBe(width)
        expect(set.line.resolution.y).toBe(height)
        expect(set.lineHover.resolution.x).toBe(width)
        expect(set.lineHover.resolution.y).toBe(height)
      }
    })

    it('should handle different resolutions', () => {
      materials.setResolution(800, 600)
      expect(materials.green.line.resolution.x).toBe(800)
      expect(materials.green.line.resolution.y).toBe(600)

      materials.setResolution(2560, 1440)
      expect(materials.green.line.resolution.x).toBe(2560)
      expect(materials.green.line.resolution.y).toBe(1440)
    })
  })

  describe('dispose', () => {
    it('should dispose all materials', () => {
      const lineSpy = vi.spyOn(materials.green.line, 'dispose')
      const lineHoverSpy = vi.spyOn(materials.green.lineHover, 'dispose')
      const meshSpy = vi.spyOn(materials.green.mesh, 'dispose')
      const meshHoverSpy = vi.spyOn(materials.green.meshHover, 'dispose')

      materials.dispose()

      expect(lineSpy).toHaveBeenCalled()
      expect(lineHoverSpy).toHaveBeenCalled()
      expect(meshSpy).toHaveBeenCalled()
      expect(meshHoverSpy).toHaveBeenCalled()
    })
  })
})
