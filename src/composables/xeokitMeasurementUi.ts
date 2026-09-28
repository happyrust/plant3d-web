import type { XeokitHoverState, XeokitMarkerRole, XeokitPointerLensState } from './useToolStore';

type OverlayPalette = {
  markerBorder: string;
  markerFill: string;
  lensBorder: string;
  lensAccent: string;
};

export function formatXeokitHoverHint(input: {
  hover: XeokitHoverState;
  lens: XeokitPointerLensState;
}): string {
  const { hover, lens } = input;
  if (hover.visible && hover.entityId) {
    return `当前命中：${hover.entityId}`;
  }
  if (lens.visible && lens.title) {
    return lens.subtitle ? `${lens.title}：${lens.subtitle}` : lens.title;
  }
  return '当前未命中可拾取面。';
}

export function getXeokitOverlayPalette(role: XeokitMarkerRole, snapped: boolean, keypoint = false): OverlayPalette {
  if (keypoint) {
    // 吸附到关键点(ptset)：独立的绿色，与普通表面命中区分。
    return {
      markerBorder: '#22c55e',
      markerFill: 'rgba(34, 197, 94, 0.28)',
      lensBorder: 'rgba(34, 197, 94, 0.55)',
      lensAccent: '#4ade80',
    };
  }

  if (!snapped) {
    return {
      markerBorder: '#f59e0b',
      markerFill: 'rgba(245, 158, 11, 0.20)',
      lensBorder: 'rgba(251, 191, 36, 0.45)',
      lensAccent: '#fbbf24',
    };
  }

  if (role === 'corner') {
    return {
      markerBorder: '#60a5fa',
      markerFill: 'rgba(96, 165, 250, 0.22)',
      lensBorder: 'rgba(96, 165, 250, 0.48)',
      lensAccent: '#93c5fd',
    };
  }

  if (role === 'target') {
    return {
      markerBorder: '#34d399',
      markerFill: 'rgba(52, 211, 153, 0.22)',
      lensBorder: 'rgba(52, 211, 153, 0.48)',
      lensAccent: '#6ee7b7',
    };
  }

  return {
    markerBorder: '#38bdf8',
    markerFill: 'rgba(56, 189, 248, 0.20)',
    lensBorder: 'rgba(56, 189, 248, 0.45)',
    lensAccent: '#7dd3fc',
  };
}
