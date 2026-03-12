import { describe, expect, it } from 'vitest';

import { BufferAttribute, BufferGeometry, Matrix4, Scene } from 'three';

import { DTXOverlayHighlighter } from './DTXOverlayHighlighter';

function createQuadGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
    ]), 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

describe('DTXOverlayHighlighter', () => {
  it('showEdges=false 时只创建填充 mesh，不创建 edge 线段', () => {
    const scene = new Scene();
    const geometry = createQuadGeometry();
    const highlighter = new DTXOverlayHighlighter(scene, {
      showFill: true,
      fillOpacity: 0.22,
      showEdges: false,
    } as any);

    highlighter.setGeometryGetter(() => ({
      geometry,
      matrix: new Matrix4(),
    }));

    highlighter.setHighlightedObjects(['o:demo:0']);

    const overlayGroup = scene.getObjectByName('DTXSelectionOverlay');
    expect(overlayGroup).toBeTruthy();
    expect(overlayGroup?.children.map((child) => child.name)).toEqual([
      'sel_fill_o:demo:0',
    ]);
  });

  it('默认仍会创建 edge 线段，保持现有兼容行为', () => {
    const scene = new Scene();
    const geometry = createQuadGeometry();
    const highlighter = new DTXOverlayHighlighter(scene, {
      showFill: false,
    });

    highlighter.setGeometryGetter(() => ({
      geometry,
      matrix: new Matrix4(),
    }));

    highlighter.setHighlightedObjects(['o:demo:1']);

    const overlayGroup = scene.getObjectByName('DTXSelectionOverlay');
    expect(overlayGroup?.children.map((child) => child.name)).toEqual([
      'sel_edge_o:demo:1',
    ]);
  });
});
