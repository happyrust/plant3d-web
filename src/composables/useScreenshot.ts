// 截图工具 composable
// 提供 3D 视图截图功能，支持上传到服务器

import { ref } from 'vue';

import { useViewerContext } from './useViewerContext';

import type { ReviewAttachment } from '@/types/auth';

import {
  reviewAttachmentUploadWithProgress,
  type ReviewAttachmentUploadOptions,
} from '@/api/reviewApi';

export type ScreenshotUploadResult = ReviewAttachment & {
  width: number;
  height: number;
  capturedAt: number;
};

export type CaptureKind =
  | 'manual'
  | 'annotation_shot'
  | 'annotation_shot_pending'
  | 'auto_cloud_finish';

export type CaptureOptions = {
  filename?: string;
  format?: 'image/png' | 'image/jpeg';
  quality?: number;
  includeOverlays?: boolean;
  kind?: CaptureKind;
  sourceAnnotationId?: string;
  sourceAnnotationType?: string;
  formId?: string | null;
  description?: string;
  upload?: ReviewAttachmentUploadOptions;
};

export type CaptureAndUploadOptions = CaptureOptions;

export type CapturedViewportScreenshot = {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  capturedAt: number;
  format: 'image/png' | 'image/jpeg';
};

export type CaptureViewportOptions = Pick<CaptureOptions, 'format' | 'quality' | 'includeOverlays'>;

function buildDefaultFilename(options: CaptureOptions, capturedAt: number, ext: string): string {
  if (options.kind === 'annotation_shot' && options.sourceAnnotationId) {
    return `annotation-${options.sourceAnnotationId}-${capturedAt}.${ext}`;
  }
  if (options.kind === 'annotation_shot_pending') {
    // pending 采样阶段 sourceAnnotationId 尚未存在，使用 pending- 前缀；drain 时不改文件名。
    return `annotation-pending-${capturedAt}.${ext}`;
  }
  if (options.kind === 'auto_cloud_finish' && options.sourceAnnotationId) {
    return `cloud-${options.sourceAnnotationId}-${capturedAt}.${ext}`;
  }
  return `screenshot-${capturedAt}.${ext}`;
}

function buildUploadOptions(options: CaptureOptions): ReviewAttachmentUploadOptions | undefined {
  const upload: ReviewAttachmentUploadOptions = {
    ...(options.upload ?? {}),
  };

  if (options.kind === 'annotation_shot' || options.kind === 'annotation_shot_pending') {
    upload.fileType = upload.fileType ?? 'annotation_screenshot';
  }
  if (options.formId !== undefined) {
    upload.formId = options.formId;
  }
  if (options.description) {
    upload.description = options.description;
  }
  if (options.sourceAnnotationId) {
    upload.sourceAnnotationId = options.sourceAnnotationId;
  }
  if (options.sourceAnnotationType) {
    upload.sourceAnnotationType = options.sourceAnnotationType;
  }

  return Object.keys(upload).length > 0 ? upload : undefined;
}

function getCanvasSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  const rect = typeof canvas.getBoundingClientRect === 'function'
    ? canvas.getBoundingClientRect()
    : null;
  const width = canvas.width || Math.round(rect?.width || canvas.clientWidth || 0);
  const height = canvas.height || Math.round(rect?.height || canvas.clientHeight || 0);
  return { width, height };
}

function blobFromCanvas(
  canvas: HTMLCanvasElement,
  format: 'image/png' | 'image/jpeg',
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      format,
      quality
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load screenshot image'));
    image.src = src;
  });
}

function findViewerOverlay(canvas: HTMLCanvasElement): HTMLElement | null {
  const container = canvas.parentElement;
  if (!container) return null;
  return container.querySelector(':scope > .xeokitOverlay')
    ?? container.querySelector('.xeokitOverlay');
}

function copyFormState(source: Element, target: Element): void {
  if (source instanceof HTMLInputElement && target instanceof HTMLInputElement) {
    target.value = source.value;
    target.setAttribute('value', source.value);
  }
  if (source instanceof HTMLTextAreaElement && target instanceof HTMLTextAreaElement) {
    target.value = source.value;
    target.textContent = source.value;
  }
}

function inlineComputedStyles(source: Element, target: Element): void {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return;
  const computed = window.getComputedStyle(source);
  const style = target instanceof HTMLElement || target instanceof SVGElement
    ? target.style
    : null;
  if (style) {
    for (const property of Array.from(computed)) {
      style.setProperty(
        property,
        computed.getPropertyValue(property),
        computed.getPropertyPriority(property),
      );
    }
  }
  copyFormState(source, target);

  const sourceChildren = Array.from(source.children);
  const targetChildren = Array.from(target.children);
  for (let index = 0; index < sourceChildren.length; index += 1) {
    const child = sourceChildren[index];
    const targetChild = targetChildren[index];
    if (targetChild) inlineComputedStyles(child, targetChild);
  }
}

function buildOverlaySvgDataUrl(
  overlay: HTMLElement,
  width: number,
  height: number,
): string {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  wrapper.style.position = 'relative';
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.style.overflow = 'hidden';
  wrapper.style.background = 'transparent';

  const clone = overlay.cloneNode(true) as HTMLElement;
  inlineComputedStyles(overlay, clone);
  clone.style.position = 'absolute';
  clone.style.inset = '0';
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.pointerEvents = 'none';
  wrapper.appendChild(clone);

  const html = new XMLSerializer().serializeToString(wrapper);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    `<foreignObject width="100%" height="100%">${html}</foreignObject>`,
    '</svg>',
  ].join('');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function useScreenshot() {
  const { viewerRef } = useViewerContext();
  const isCapturing = ref(false);
  const uploadProgress = ref(0);

  /**
   * 从 Viewer 获取 canvas 元素
   */
  function getCanvas(): HTMLCanvasElement | null {
    const viewer = viewerRef.value;
    if (viewer) {
      const canvas = (viewer as unknown as { canvas?: HTMLCanvasElement }).canvas;
      if (canvas instanceof HTMLCanvasElement) {
        return canvas;
      }

      const scene = viewer.scene as unknown as {
        canvas?: { canvas?: HTMLCanvasElement };
      };
      if (scene.canvas?.canvas instanceof HTMLCanvasElement) {
        return scene.canvas.canvas;
      }
    }

    if (typeof document === 'undefined') return null;
    return document.querySelector<HTMLCanvasElement>(
      '.viewer-panel-container canvas.viewer, canvas.viewer, .viewer-panel-container canvas',
    );
  }

  /**
   * 截取当前视图为 Blob
   */
  async function captureToBlob(
    format: 'image/png' | 'image/jpeg' = 'image/png',
    quality = 0.92
  ): Promise<Blob | null> {
    const canvas = getCanvas();
    if (!canvas) {
      console.warn('Canvas not available for screenshot');
      return null;
    }

    return blobFromCanvas(canvas, format, quality);
  }

  /**
   * 截取当前视图为 Data URL
   */
  function captureToDataURL(
    format: 'image/png' | 'image/jpeg' = 'image/png',
    quality = 0.92
  ): string | null {
    const canvas = getCanvas();
    if (!canvas) {
      console.warn('Canvas not available for screenshot');
      return null;
    }

    return canvas.toDataURL(format, quality);
  }

  async function captureCanvasOnly(
    canvas: HTMLCanvasElement,
    format: 'image/png' | 'image/jpeg',
    quality: number,
    capturedAt = Date.now(),
  ): Promise<CapturedViewportScreenshot | null> {
    const blob = await blobFromCanvas(canvas, format, quality);
    if (!blob) return null;
    const size = getCanvasSize(canvas);
    return {
      blob,
      dataUrl: canvas.toDataURL(format, quality),
      width: size.width,
      height: size.height,
      capturedAt,
      format,
    };
  }

  async function captureCanvasWithOverlay(
    canvas: HTMLCanvasElement,
    overlay: HTMLElement,
    format: 'image/png' | 'image/jpeg',
    quality: number,
    capturedAt: number,
  ): Promise<CapturedViewportScreenshot | null> {
    const { width, height } = getCanvasSize(canvas);
    if (!width || !height) return captureCanvasOnly(canvas, format, quality, capturedAt);

    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    if (!ctx) return captureCanvasOnly(canvas, format, quality, capturedAt);

    const canvasImage = await loadImage(canvas.toDataURL(format, quality));
    ctx.drawImage(canvasImage, 0, 0, width, height);

    if (overlay.childElementCount > 0) {
      const overlayImage = await loadImage(buildOverlaySvgDataUrl(overlay, width, height));
      ctx.drawImage(overlayImage, 0, 0, width, height);
    }

    const blob = await blobFromCanvas(out, format, quality);
    if (!blob) return null;

    return {
      blob,
      dataUrl: out.toDataURL(format, quality),
      width,
      height,
      capturedAt,
      format,
    };
  }

  async function captureViewport(
    options: CaptureViewportOptions = {},
  ): Promise<CapturedViewportScreenshot | null> {
    const canvas = getCanvas();
    if (!canvas) {
      console.warn('Canvas not available for screenshot');
      return null;
    }

    const capturedAt = Date.now();
    const format = options.format ?? 'image/png';
    const quality = options.quality ?? 0.92;
    const includeOverlays = options.includeOverlays !== false;
    const overlay = includeOverlays ? findViewerOverlay(canvas) : null;

    if (!overlay) {
      return captureCanvasOnly(canvas, format, quality, capturedAt);
    }

    try {
      return await captureCanvasWithOverlay(canvas, overlay, format, quality, capturedAt);
    } catch (error) {
      console.warn('Overlay screenshot failed, falling back to canvas only:', error);
      return captureCanvasOnly(canvas, format, quality, capturedAt);
    }
  }

  /**
   * 截取并下载图片
   */
  async function captureAndDownload(
    filename = 'screenshot.png',
    format: 'image/png' | 'image/jpeg' = 'image/png'
  ): Promise<boolean> {
    const dataUrl = captureToDataURL(format);
    if (!dataUrl) return false;

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.click();
    return true;
  }

  /**
   * 截取并上传到服务器
   */
  async function captureAndUpload(
    taskId: string | null = null,
    options?: string | CaptureAndUploadOptions
  ): Promise<ScreenshotUploadResult | null> {
    if (isCapturing.value) return null;

    const resolved: CaptureAndUploadOptions = typeof options === 'string'
      ? { filename: options }
      : (options ?? {});

    isCapturing.value = true;
    uploadProgress.value = 0;

    try {
      const captured = await captureViewport(resolved);
      if (!captured) {
        console.error('Failed to capture screenshot');
        return null;
      }
      return await uploadCapturedScreenshotInternal(taskId, captured, resolved);
    } catch (error) {
      console.error('Screenshot upload error:', error);
      return null;
    } finally {
      isCapturing.value = false;
      uploadProgress.value = 0;
    }
  }

  async function uploadCapturedScreenshotInternal(
    taskId: string | null,
    captured: CapturedViewportScreenshot,
    options: CaptureAndUploadOptions = {},
  ): Promise<ScreenshotUploadResult | null> {
    const ext = captured.format === 'image/jpeg' ? 'jpg' : 'png';
    const name = options.filename || buildDefaultFilename(options, captured.capturedAt, ext);
    const file = new File([captured.blob], name, { type: captured.blob.type || captured.format });
    const uploadOptions = buildUploadOptions(options);

    const response = await reviewAttachmentUploadWithProgress(
      taskId,
      file,
      (percent) => {
        uploadProgress.value = percent;
      },
      uploadOptions,
    );

    if (response.success && response.attachment) {
      return {
        ...response.attachment,
        width: captured.width,
        height: captured.height,
        capturedAt: response.attachment.uploadedAt ?? captured.capturedAt,
      };
    }

    console.error('Upload failed:', response.error_message);
    return null;
  }

  async function uploadCapturedScreenshot(
    taskId: string | null,
    captured: CapturedViewportScreenshot,
    options: CaptureAndUploadOptions = {},
  ): Promise<ScreenshotUploadResult | null> {
    if (isCapturing.value) return null;

    isCapturing.value = true;
    uploadProgress.value = 0;
    try {
      return await uploadCapturedScreenshotInternal(taskId, captured, options);
    } catch (error) {
      console.error('Screenshot upload error:', error);
      return null;
    } finally {
      isCapturing.value = false;
      uploadProgress.value = 0;
    }
  }

  return {
    isCapturing,
    uploadProgress,
    getCanvas,
    captureToBlob,
    captureToDataURL,
    captureViewport,
    captureAndDownload,
    captureAndUpload,
    uploadCapturedScreenshot,
  };
}
