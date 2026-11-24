export type Vec2 = Readonly<{ x: number; y: number }>;
export type Vec3 = readonly [number, number, number];
export type DimensionKind = 'linear' | 'projected' | 'angular' | 'radial' | 'chain';
export type DimensionAccuracy = 'exact' | 'approximate';
export type DimensionValidity = 'valid' | 'invalid';
export type DimensionArcChoice = 'minor' | 'major';
export type RadialDisplay = 'radius' | 'diameter';

export type SemanticAnchorRef = Readonly<{
  source:
    | 'p-point'
    | 'instance-origin'
    | 'primitive-key-point'
    | 'model-surface'
    | 'circle'
    | 'arc'
    | 'direction';
  refno?: string;
  candidateId?: string;
}>;

export type DimensionAnchor = Readonly<{
  snapshot: Vec3 | null;
  accuracy: DimensionAccuracy;
  semanticRef?: SemanticAnchorRef;
}>;

export type ProjectionAxisRef =
  | Readonly<{ kind: 'design-axis'; axis: 'x' | 'y' | 'z' }>
  | Readonly<{
    kind: 'semantic-direction';
    snapshot: Vec3;
    semanticRef: SemanticAnchorRef;
  }>;

/**
 * 线性 / 投影尺寸的三类方向（#68，E3D DMCHEK 的口径）：量的是哪根轴（`measuredAxis`）、尺寸线沿哪个方向画
 * （`dimensionDirection`）、点沿哪个方向投到尺寸线上（`projectionDirection`，只投影尺寸有），以及尺寸线与偏移所在
 * 的平面（`dimensionPlane`，法向）。都是设计系单位向量，与相机无关——视向（`viewDirection`）是瞬态的，不入库。
 *
 * `source = 'legacy-derived'`：旧记录没有这几项，由迁移从端点 / 轴快照推出来；端点重绑后随之重推。
 * `source = 'explicit'`：创建 / 编辑时用户（或交互）定下的，重绑不改。
 */
export type DimensionDirections = Readonly<{
  schema: 1;
  source: 'explicit' | 'legacy-derived';
  measuredAxis?: Vec3;
  dimensionDirection?: Vec3;
  projectionDirection?: Vec3;
  dimensionPlane?: Readonly<{ normal: Vec3 }>;
}>;

export type LinearPlacementIntent = Readonly<{
  offsetM: number;
  labelT: number;
  side: 1 | -1;
}>;

/**
 * 角度所在的设计平面（#71）。法向定死弧的旋向，转相机不改。
 * `explicit` 是创建时由三条射线叉积定下的；`legacy-derived` 是旧记录迁移时补的，重绑后重算。
 */
export type AngularPlane = Readonly<{
  schema: 1;
  source: 'explicit' | 'legacy-derived';
  normal: Vec3;
}>;

export type AngularPlacementIntent = Readonly<{
  radiusM?: number;
  labelT: number;
  arcChoice: DimensionArcChoice;
  /**
   * 近 90° 正交吸附。缺省或 false 表示关：显示角就是两条射线的真实夹角。
   * 打开后按 `ANGULAR_ORTHOGONAL_SNAP` 吸到 90° 的整数倍，锚点坐标不动。
   */
  orthogonalSnap?: boolean;
}>;

export type RadialPlacementIntent = Readonly<{
  leaderDirection: Vec3;
  labelDistanceM: number;
}>;

type UserDimensionCommon = Readonly<{
  id: string;
  labelPinned: boolean;
  authorId: string;
  authorRole: string;
  createdAt: number;
  updatedAt: number;
  validity: DimensionValidity;
}>;

export type UserDimensionRecord =
  | Readonly<UserDimensionCommon & {
    kind: 'linear';
    a: DimensionAnchor;
    b: DimensionAnchor;
    placement: LinearPlacementIntent;
    directions?: DimensionDirections;
  }>
  | Readonly<UserDimensionCommon & {
    kind: 'projected';
    a: DimensionAnchor;
    b: DimensionAnchor;
    axis: ProjectionAxisRef;
    placement: LinearPlacementIntent;
    directions?: DimensionDirections;
  }>
  | Readonly<UserDimensionCommon & {
    kind: 'angular';
    vertex: DimensionAnchor;
    rayA: DimensionAnchor;
    rayB: DimensionAnchor;
    placement: AngularPlacementIntent;
    /** 缺省的旧记录按两条射线现算平面；有值时布局用这份，不跟相机走。 */
    anglePlane?: AngularPlane;
  }>
  | Readonly<UserDimensionCommon & {
    kind: 'radial';
    center: DimensionAnchor;
    rim: DimensionAnchor;
    normal: ProjectionAxisRef;
    display: RadialDisplay;
    placement: RadialPlacementIntent;
    /**
     * 拾取时的半径（设计系 m）。圆周点还在时布局用圆周点；圆周点丢了仍留着这份，
     * 让半径/直径切换和校审回放知道原来的圆有多大，但不拿它编一个新的圆周点。
     */
    referencedRadiusM?: number;
  }>
  | Readonly<UserDimensionCommon & {
    kind: 'chain';
    /** 拾取顺序。相邻两点是一段，首尾是可选总长。少于 2 个点不是一条链。 */
    anchors: readonly DimensionAnchor[];
    placement: LinearPlacementIntent;
    /** 再画一条从第一点到最后一点的总长，偏得比各段更远。 */
    showOverall: boolean;
    directions?: DimensionDirections;
  }>;
