import { describe, expect, it, vi } from 'vitest';

import { composeViewerCanvases } from './composePng';

describe('composeViewerCanvases', () => {
  it('draws WebGL first and the dimension overlay second at physical size', () => {
    const drawImage = vi.fn();
    const output = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
    } as unknown as HTMLCanvasElement;
    const createCanvas = vi.fn(() => output);
    const webgl = { id: 'webgl' } as unknown as CanvasImageSource;
    const dimensions = { id: 'dimensions' } as unknown as CanvasImageSource;

    const result = composeViewerCanvases({
      webgl,
      dimensions,
      width: 1600,
      height: 900,
      createCanvas,
    });

    expect(result).toBe(output);
    expect(createCanvas).toHaveBeenCalledWith(1600, 900);
    expect(output.width).toBe(1600);
    expect(output.height).toBe(900);
    expect(drawImage.mock.calls).toEqual([
      [webgl, 0, 0, 1600, 900],
      [dimensions, 0, 0, 1600, 900],
    ]);
  });

  it('keeps the base image when no dimension overlay exists', () => {
    const drawImage = vi.fn();
    const output = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
    } as unknown as HTMLCanvasElement;

    composeViewerCanvases({
      webgl: {} as CanvasImageSource,
      dimensions: null,
      width: 100,
      height: 50,
      createCanvas: () => output,
    });

    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it('fails explicitly when a 2D context is unavailable', () => {
    const output = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => null),
    } as unknown as HTMLCanvasElement;
    expect(() => composeViewerCanvases({
      webgl: {} as CanvasImageSource,
      dimensions: null,
      width: 100,
      height: 50,
      createCanvas: () => output,
    })).toThrow('Unable to create screenshot composition context');
  });
});
