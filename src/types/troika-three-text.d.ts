/**
 * Minimal module declaration for `troika-three-text`.
 *
 * The upstream package ships `.d.ts` only for its ESM entry in some
 * versions and exposes a large surface; we only consume `Text` in
 * `src/utils/three/annotation/text/TroikaBillboardText.ts` plus some
 * test-time mocks. The stub below covers that surface without
 * pulling in a brittle full type clone—the authoritative types live
 * in the runtime library, we just stop vue-tsc from complaining
 * about missing declarations.
 *
 * Expand the member list here if new TroikaBillboardText users need
 * more fields at compile time; `any` on the tail members keeps
 * flexibility for properties we don't use here.
 */
declare module 'troika-three-text' {
  import type { Color, Mesh } from 'three';

  // troika 的 color / outlineColor 支持 `number | string | THREE.Color`
  // —runtime 会统一解析到内部 THREE.Color；我们对 TS 侧做宽松放行，
  // 避免业务代码里已有的 `new THREE.Color(...)` 赋值报错。
  type TroikaColor = number | string | Color;

  export class Text extends Mesh {
    constructor();
    text: string;
    fontSize: number;
    font: string;
    color: TroikaColor;
    outlineColor: TroikaColor;
    outlineWidth: number;
    outlineBlur: number;
    outlineOpacity: number;
    outlineOffsetX: number;
    outlineOffsetY: number;
    anchorX: number | string;
    anchorY: number | string;
    textAlign: string;
    letterSpacing: number;
    lineHeight: number | string;
    whiteSpace: string;
    overflowWrap: string;
    maxWidth: number;
    depthOffset: number;
    sync(callback?: () => void): void;
    dispose(): void;

    // 注意：troika 会 dispatch `'synccomplete'` 事件，但 Object3D 的
    // generic eventMap 不包含这个 key。调用方需要 `(textMesh as any)
    // .addEventListener('synccomplete', ...)` 或本地补一个 eventMap
    // 扩展（按项目惯例）；这里不做 signature override，避免与
    // `Mesh.add / container.add(t)` 的 Object3D 契约产生不兼容。

    [key: string]: any;
  }
}
