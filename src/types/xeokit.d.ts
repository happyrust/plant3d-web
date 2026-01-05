/**
 * Xeokit SDK 类型扩展
 * 为项目中的 xeokit 使用提供完整类型定义
 * 
 * 这个文件定义了 xeokit-sdk 中缺少的类型，为整个项目提供类型安全保障
 */

import { Viewer } from '@xeokit/xeokit-sdk';

// 基础数学类型
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

// Xeokit 扩展类型
export interface SceneModelWithAios {
  id: string;
  aabb?: {
    min: Vec3;
    max: Vec3;
  };
  __aiosLazyEntityManagers?: Record<string, LazyEntityManager>;
  __aiosActiveLazyModelId?: string;
}

// LazyEntityManager 类型定义
export interface LazyEntityManager {
  id: string;
  hasRefno?(refno: string): boolean;
  showEntity?(refno: string): void;
  hideEntity?(refno: string): void;
  destroy?(): void;
}

// Viewer 扩展
export interface ExtendedViewer extends Viewer {
  scene: ExtendedScene;
  camera: ExtendedCamera;
  cameraFlight: {
    flyTo(options: { aabb?: any; duration?: number }): void;
    jumpTo(options: { aabb?: any }): void;
  };
}

export interface ExtendedScene {
  objects: Record<string, any>;
  __aiosLazyEntityManagers?: Record<string, LazyEntityManager>;
  __aiosActiveLazyModelId?: string;
}

export interface ExtendedCamera {
  projectWorldPos(worldPos: Vec3): { x: number; y: number };
  worldMatrix: number[];
  on(eventName: 'matrix', callback: () => void): void;
  off(eventName: 'matrix', callback: () => void): void;
}

// 几何体和材质类型
export interface ReadableGeometry {
  id: string;
  destroy(): void;
}

export interface Material {
  id: string;
  destroy(): void;
}

export interface Mesh {
  id: string;
  destroyed: boolean;
  destroy(): void;
  visible: boolean;
  position: Vec3;
}

export interface LineSet {
  id: string;
  destroyed: boolean;
  destroy(): void;
  visible: boolean;
}

// 导出兼容的类型别名
export type Vec3Array = [number, number, number];
export type Vec4Array = [number, number, number, number];