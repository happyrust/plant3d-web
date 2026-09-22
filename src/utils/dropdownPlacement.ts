/**
 * 绝对定位下拉菜单在 `overflow: hidden` 容器里的竖向落位（issue #81）。
 *
 * 菜单挂在锚点按钮的 `position: relative` 包裹里，百分比 `max-height` 只能相对那个包裹解析，
 * 所以不能像 #80 那样按容器算 `max-h`；这里改成按「容器里还剩多少地方」决定：
 * - 下方放得下 → 向下开（菜单顶对齐锚点顶，`top-0`）；
 * - 下方放不下、上方放得下 → 向上翻（菜单底对齐锚点底，`bottom-0`）；
 * - 两头都放不下 → 选空间大的一侧，并把菜单限高到那一侧的空间、内部滚动。
 * 全部坐标用同一坐标系（如 `getBoundingClientRect`）即可，单位 px。
 */
export type DropdownPlacementInput = {
  /** 锚点（按钮）顶边 */
  anchorTop: number;
  /** 锚点（按钮）底边 */
  anchorBottom: number;
  /** 裁剪容器顶边 */
  containerTop: number;
  /** 裁剪容器底边 */
  containerBottom: number;
  /** 菜单不限高时的自然高度 */
  menuHeight: number;
  /** 菜单与容器边的最小留白，默认 8 */
  margin?: number;
}

export type DropdownPlacement = {
  /** true = 向上翻（`bottom-0`），false = 向下开（`top-0`） */
  up: boolean;
  /** 需要限高滚动时的像素值；放得下时为 null */
  maxHeight: number | null;
}

export const DEFAULT_DROPDOWN_PLACEMENT: DropdownPlacement = { up: false, maxHeight: null };

export function resolveDropdownPlacement(input: DropdownPlacementInput): DropdownPlacement {
  const margin = input.margin ?? 8;
  // 向下开时菜单占 [anchorTop, anchorTop + h]；向上翻时占 [anchorBottom - h, anchorBottom]
  const spaceBelow = Math.max(0, Math.floor(input.containerBottom - margin - input.anchorTop));
  const spaceAbove = Math.max(0, Math.floor(input.anchorBottom - margin - input.containerTop));
  const height = Math.max(0, input.menuHeight);

  if (height <= spaceBelow) return { up: false, maxHeight: null };
  if (height <= spaceAbove) return { up: true, maxHeight: null };

  const up = spaceAbove > spaceBelow;
  return { up, maxHeight: up ? spaceAbove : spaceBelow };
}
