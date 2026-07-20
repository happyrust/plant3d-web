// 截图工具 composable
// 提供 3D 视图截图功能，支持上传到服务器

import { ref } from 'vue';

import { useViewerContext } from './useViewerContext';

import type { ReviewAttachment } from '@/types/auth';

import {
  reviewAttachmentUploadWithProgress,
  type ReviewAttachmentUploadOptions,
} from '@/api/reviewApi';
import { composeViewerCanvases } from '@/dimension';

export type ScreenshotUploadResult = {
  attachment: ReviewAttachment;
  width: number;
  height: number;
  capturedAt: number;
};

export type CaptureAndUploadOptions = {
  filename?: string;
  format?: 'image/png' | 'image/jpeg';
  quality?: number;
  upload?: ReviewAttachmentUploadOptions;
};

export function useScreenshot() {
  const { viewerRef, dimensionSystem } = useViewerContext();
  const isCapturing = ref(false);
  const uploadProgress = ref(0);

  /**
   * 从 Viewer 获取 canvas 元素
   */
  function getCanvas(): HTMLCanvasElement | null {
    const viewer = viewerRef.value;
    if (!viewer) return null;

    const canvas = (viewer as unknown as { canvas?: HTMLCanvasElement }).canvas;
    if (canvas instanceof HTMLCanvasElement) {
      return canvas;
    }

    const scene = viewer.scene as unknown as {
      canvas?: { canvas?: HTMLCanvasElement };
    };
    return scene.canvas?.canvas || null;
  }

  function getCaptureCanvas(): HTMLCanvasElement | null {
    const canvas = getCanvas();
    if (!canvas) return null;
    const dimensionCanvas =
      dimensionSystem?.value?.viewport.getCanvas() ?? null;
    if (!dimensionCanvas || dimensionCanvas.width <= 0 || dimensionCanvas.height <= 0) {
      return canvas;
    }
    return composeViewerCanvases({
      webgl: canvas,
      dimensions: dimensionCanvas,
      width: canvas.width || canvas.clientWidth,
      height: canvas.height || canvas.clientHeight,
    });
  }

  function canvasToBlob(
    canvas: HTMLCanvasElement,
    format: 'image/png' | 'image/jpeg',
    quality: number,
  ): Promise<Blob | null> {
    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob),
        format,
        quality,
      );
    });
  }

  /**
   * 截取当前视图为 Blob
   */
  async function captureToBlob(
    format: 'image/png' | 'image/jpeg' = 'image/png',
    quality = 0.92
  ): Promise<Blob | null> {
    const canvas = getCaptureCanvas();
    if (!canvas) {
      console.warn('Canvas not available for screenshot');
      return null;
    }

    return canvasToBlob(canvas, format, quality);
  }

  /**
   * 截取当前视图为 Data URL
   */
  function captureToDataURL(
    format: 'image/png' | 'image/jpeg' = 'image/png',
    quality = 0.92
  ): string | null {
    const canvas = getCaptureCanvas();
    if (!canvas) {
      console.warn('Canvas not available for screenshot');
      return null;
    }

    return canvas.toDataURL(format, quality);
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
      const canvas = getCaptureCanvas();
      if (!canvas) {
        console.error('Canvas not available for screenshot');
        return null;
      }

      const capturedAt = Date.now();
      const format = resolved.format ?? 'image/png';
      const blob = await canvasToBlob(canvas, format, resolved.quality ?? 0.92);
      if (!blob) {
        console.error('Failed to capture screenshot');
        return null;
      }

      const ext = format === 'image/jpeg' ? 'jpg' : 'png';
      const name = resolved.filename || `screenshot-${capturedAt}.${ext}`;
      const file = new File([blob], name, { type: format });

      const response = await reviewAttachmentUploadWithProgress(
        taskId,
        file,
        (percent) => {
          uploadProgress.value = percent;
        },
        resolved.upload,
      );

      if (response.success && response.attachment) {
        return {
          attachment: response.attachment,
          width: canvas.width || canvas.clientWidth || 0,
          height: canvas.height || canvas.clientHeight || 0,
          capturedAt,
        };
      }

      console.error('Upload failed:', response.error_message);
      return null;
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
    captureAndDownload,
    captureAndUpload,
  };
}
