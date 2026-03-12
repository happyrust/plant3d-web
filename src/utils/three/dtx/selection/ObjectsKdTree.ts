/**
 * ObjectsKdTree - K-D 树空间索引
 *
 * 用于加速框选查询，通过空间分割实现 O(log n) 的查询复杂度。
 * 参考 xeokit ObjectsKdTree3 实现。
 *
 * @see docs/3d-libs/xeokit/xeokit-sdk.es.js (行 7828-7927)
 */

import { Box3, Vector3, Frustum, Matrix4 } from 'three';

// ========== 类型定义 ==========

/**
 * K-D 树节点
 */
type KdTreeNode = {
  /** 节点包围盒 */
  aabb: Box3;
  /** 叶子节点存储的对象 ID 列表 */
  objectIds?: string[];
  /** 左子节点 */
  left?: KdTreeNode;
  /** 右子节点 */
  right?: KdTreeNode;
  /** 分割维度 (0=x, 1=y, 2=z) */
  splitDim?: number;
  /** 分割位置 */
  splitPos?: number;
}

/**
 * 对象数据接口 (用于构建 K-D 树)
 */
export type KdTreeObject = {
  objectId: string;
  boundingBox: Box3;
}

/**
 * 视锥体相交状态
 */
export enum FrustumIntersection {
  INSIDE = 0,
  INTERSECT = 1,
  OUTSIDE = 2
}

/**
 * 框选模式
 */
export enum MarqueePickMode {
  /** 相交模式：选择与框相交的对象 */
  INTERSECTS = 0,
  /** 包含模式：选择完全在框内的对象 */
  INSIDE = 1
}

// ========== 常量 ==========

/** 最大树深度 */
const DEFAULT_MAX_DEPTH = 15;
/** 叶子节点最大对象数 */
const MAX_OBJECTS_PER_LEAF = 10;

// ========== ObjectsKdTree 类 ==========

/**
 * K-D 树空间索引
 */
export class ObjectsKdTree {
  private _root: KdTreeNode | null = null;
  private _maxDepth: number;
  private _needsRebuild = true;
  private _objects = new Map<string, Box3>();

  constructor(maxDepth: number = DEFAULT_MAX_DEPTH) {
    this._maxDepth = maxDepth;
  }

  /**
   * 添加对象到索引
   */
  addObject(objectId: string, boundingBox: Box3): void {
    this._objects.set(objectId, boundingBox.clone());
    this._needsRebuild = true;
  }

  /**
   * 批量添加对象
   */
  addObjects(objects: KdTreeObject[]): void {
    for (const obj of objects) {
      this._objects.set(obj.objectId, obj.boundingBox.clone());
    }
    this._needsRebuild = true;
  }

  /**
   * 移除对象
   */
  removeObject(objectId: string): void {
    if (this._objects.delete(objectId)) {
      this._needsRebuild = true;
    }
  }

  /**
   * 清空索引
   */
  clear(): void {
    this._objects.clear();
    this._root = null;
    this._needsRebuild = true;
  }

  /**
   * 获取对象数量
   */
  get objectCount(): number {
    return this._objects.size;
  }

  /**
   * 构建 K-D 树
   */
  build(): void {
    if (!this._needsRebuild) return;

    const objectIds = Array.from(this._objects.keys());
    if (objectIds.length === 0) {
      this._root = null;
      this._needsRebuild = false;
      return;
    }

    // 计算根节点包围盒
    const rootAABB = new Box3();
    for (const bbox of this._objects.values()) {
      rootAABB.union(bbox);
    }

    // 递归构建树
    this._root = this._buildNode(objectIds, rootAABB, 0);
    this._needsRebuild = false;
  }

  /**
   * 递归构建节点
   */
  private _buildNode(objectIds: string[], aabb: Box3, depth: number): KdTreeNode {
    const node: KdTreeNode = { aabb: aabb.clone() };

    // 达到最大深度或对象数量足够少，创建叶子节点
    if (depth >= this._maxDepth || objectIds.length <= MAX_OBJECTS_PER_LEAF) {
      node.objectIds = objectIds;
      return node;
    }

    // 选择最长维度进行分割
    const size = aabb.getSize(new Vector3());
    let splitDim = 0;
    if (size.y > size.x && size.y > size.z) splitDim = 1;
    else if (size.z > size.x && size.z > size.y) splitDim = 2;

    // 计算分割位置 (中点)
    const center = aabb.getCenter(new Vector3());
    const splitPos = splitDim === 0 ? center.x : splitDim === 1 ? center.y : center.z;

    node.splitDim = splitDim;
    node.splitPos = splitPos;

    // 分割对象到左右子节点
    const leftIds: string[] = [];
    const rightIds: string[] = [];
    const leftAABB = new Box3();
    const rightAABB = new Box3();

    for (const objectId of objectIds) {
      const bbox = this._objects.get(objectId)!;
      const objCenter = bbox.getCenter(new Vector3());
      const objPos = splitDim === 0 ? objCenter.x : splitDim === 1 ? objCenter.y : objCenter.z;

      if (objPos <= splitPos) {
        leftIds.push(objectId);
        leftAABB.union(bbox);
      } else {
        rightIds.push(objectId);
        rightAABB.union(bbox);
      }
    }

    // 如果分割不均匀，创建叶子节点
    if (leftIds.length === 0 || rightIds.length === 0) {
      node.objectIds = objectIds;
      delete node.splitDim;
      delete node.splitPos;
      return node;
    }

    // 递归构建子节点
    node.left = this._buildNode(leftIds, leftAABB, depth + 1);
    node.right = this._buildNode(rightIds, rightAABB, depth + 1);

    return node;
  }

  /**
   * 使用视锥体查询对象
   * @param frustum Three.js Frustum 对象
   * @param mode 框选模式
   * @returns 匹配的对象 ID 列表
   */
  queryFrustum(frustum: Frustum, mode: MarqueePickMode = MarqueePickMode.INTERSECTS): string[] {
    if (this._needsRebuild) {
      this.build();
    }

    if (!this._root) return [];

    const result: string[] = [];
    this._queryFrustumNode(this._root, frustum, mode, result, FrustumIntersection.INTERSECT);
    return result;
  }

  /**
   * 递归查询节点
   */
  private _queryFrustumNode(
    node: KdTreeNode,
    frustum: Frustum,
    mode: MarqueePickMode,
    result: string[],
    parentIntersection: FrustumIntersection
  ): void {
    // 检查节点与视锥体的相交状态
    let intersection = parentIntersection;
    if (parentIntersection === FrustumIntersection.INTERSECT) {
      intersection = this._frustumIntersectsAABB(frustum, node.aabb);
    }

    // 完全在视锥体外，剪枝
    if (intersection === FrustumIntersection.OUTSIDE) {
      return;
    }

    // 叶子节点，检查每个对象
    if (node.objectIds) {
      for (const objectId of node.objectIds) {
        const bbox = this._objects.get(objectId);
        if (!bbox) continue;

        const objIntersection = this._frustumIntersectsAABB(frustum, bbox);

        if (mode === MarqueePickMode.INSIDE) {
          // 包含模式：只选择完全在视锥体内的对象
          if (objIntersection === FrustumIntersection.INSIDE) {
            result.push(objectId);
          }
        } else {
          // 相交模式：选择与视锥体相交或在内部的对象
          if (objIntersection !== FrustumIntersection.OUTSIDE) {
            result.push(objectId);
          }
        }
      }
      return;
    }

    // 递归查询子节点
    if (node.left) {
      this._queryFrustumNode(node.left, frustum, mode, result, intersection);
    }
    if (node.right) {
      this._queryFrustumNode(node.right, frustum, mode, result, intersection);
    }
  }

  /**
   * 检查视锥体与 AABB 的相交状态
   */
  private _frustumIntersectsAABB(frustum: Frustum, aabb: Box3): FrustumIntersection {
    const planes = frustum.planes;
    let result = FrustumIntersection.INSIDE;

    const min = aabb.min;
    const max = aabb.max;

    for (let i = 0; i < 6; i++) {
      const plane = planes[i]!;
      const normal = plane.normal;

      // 计算 AABB 相对于平面的正负顶点
      const px = normal.x > 0 ? max.x : min.x;
      const py = normal.y > 0 ? max.y : min.y;
      const pz = normal.z > 0 ? max.z : min.z;

      const nx = normal.x > 0 ? min.x : max.x;
      const ny = normal.y > 0 ? min.y : max.y;
      const nz = normal.z > 0 ? min.z : max.z;

      // 正顶点在平面外，AABB 完全在外
      if (normal.x * px + normal.y * py + normal.z * pz + plane.constant < 0) {
        return FrustumIntersection.OUTSIDE;
      }

      // 负顶点在平面外，AABB 与平面相交
      if (normal.x * nx + normal.y * ny + normal.z * nz + plane.constant < 0) {
        result = FrustumIntersection.INTERSECT;
      }
    }

    return result;
  }

  /**
   * 使用 AABB 查询对象
   */
  queryAABB(queryBox: Box3): string[] {
    if (this._needsRebuild) {
      this.build();
    }

    if (!this._root) return [];

    const result: string[] = [];
    this._queryAABBNode(this._root, queryBox, result);
    return result;
  }

  /**
   * 递归 AABB 查询
   */
  private _queryAABBNode(node: KdTreeNode, queryBox: Box3, result: string[]): void {
    // 检查节点与查询框是否相交
    if (!node.aabb.intersectsBox(queryBox)) {
      return;
    }

    // 叶子节点，检查每个对象
    if (node.objectIds) {
      for (const objectId of node.objectIds) {
        const bbox = this._objects.get(objectId);
        if (bbox && bbox.intersectsBox(queryBox)) {
          result.push(objectId);
        }
      }
      return;
    }

    // 递归查询子节点
    if (node.left) {
      this._queryAABBNode(node.left, queryBox, result);
    }
    if (node.right) {
      this._queryAABBNode(node.right, queryBox, result);
    }
  }

  /**
   * 射线查询 (用于点击拾取)
   */
  queryRay(origin: Vector3, direction: Vector3): string[] {
    if (this._needsRebuild) {
      this.build();
    }

    if (!this._root) return [];

    const result: string[] = [];
    this._queryRayNode(this._root, origin, direction, result);
    return result;
  }

  /**
   * 递归射线查询
   */
  private _queryRayNode(node: KdTreeNode, origin: Vector3, direction: Vector3, result: string[]): void {
    // 检查射线与节点 AABB 是否相交
    if (!this._rayIntersectsAABB(origin, direction, node.aabb)) {
      return;
    }

    // 叶子节点，检查每个对象
    if (node.objectIds) {
      for (const objectId of node.objectIds) {
        const bbox = this._objects.get(objectId);
        if (bbox && this._rayIntersectsAABB(origin, direction, bbox)) {
          result.push(objectId);
        }
      }
      return;
    }

    // 递归查询子节点
    if (node.left) {
      this._queryRayNode(node.left, origin, direction, result);
    }
    if (node.right) {
      this._queryRayNode(node.right, origin, direction, result);
    }
  }

  /**
   * 检查射线与 AABB 是否相交
   */
  private _rayIntersectsAABB(origin: Vector3, direction: Vector3, aabb: Box3): boolean {
    const invDirX = direction.x !== 0 ? 1 / direction.x : Infinity;
    const invDirY = direction.y !== 0 ? 1 / direction.y : Infinity;
    const invDirZ = direction.z !== 0 ? 1 / direction.z : Infinity;

    const t1 = (aabb.min.x - origin.x) * invDirX;
    const t2 = (aabb.max.x - origin.x) * invDirX;
    const t3 = (aabb.min.y - origin.y) * invDirY;
    const t4 = (aabb.max.y - origin.y) * invDirY;
    const t5 = (aabb.min.z - origin.z) * invDirZ;
    const t6 = (aabb.max.z - origin.z) * invDirZ;

    const tmin = Math.max(
      Math.min(t1, t2),
      Math.min(t3, t4),
      Math.min(t5, t6)
    );
    const tmax = Math.min(
      Math.max(t1, t2),
      Math.max(t3, t4),
      Math.max(t5, t6)
    );

    return tmax >= 0 && tmin <= tmax;
  }

  /**
   * 标记需要重建
   */
  markDirty(): void {
    this._needsRebuild = true;
  }

  /**
   * 获取树的统计信息
   */
  getStats(): { nodeCount: number; maxDepth: number; leafCount: number } {
    if (!this._root) {
      return { nodeCount: 0, maxDepth: 0, leafCount: 0 };
    }

    let nodeCount = 0;
    let maxDepth = 0;
    let leafCount = 0;

    const traverse = (node: KdTreeNode, depth: number) => {
      nodeCount++;
      maxDepth = Math.max(maxDepth, depth);

      if (node.objectIds) {
        leafCount++;
      } else {
        if (node.left) traverse(node.left, depth + 1);
        if (node.right) traverse(node.right, depth + 1);
      }
    };

    traverse(this._root, 0);

    return { nodeCount, maxDepth, leafCount };
  }
}
