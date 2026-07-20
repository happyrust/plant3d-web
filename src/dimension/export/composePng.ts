export function composeViewerCanvases(input: Readonly<{
  webgl: CanvasImageSource;
  dimensions?: CanvasImageSource | null;
  width: number;
  height: number;
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
}>): HTMLCanvasElement {
  if (
    !Number.isFinite(input.width)
    || !Number.isFinite(input.height)
    || input.width <= 0
    || input.height <= 0
  ) {
    throw new RangeError('Screenshot dimensions must be positive');
  }
  const width = Math.round(input.width);
  const height = Math.round(input.height);
  const canvas = input.createCanvas
    ? input.createCanvas(width, height)
    : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to create screenshot composition context');
  }
  context.drawImage(input.webgl, 0, 0, width, height);
  if (input.dimensions) {
    context.drawImage(input.dimensions, 0, 0, width, height);
  }
  return canvas;
}
