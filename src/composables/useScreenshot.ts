// 截图工具 composable
// 提供 3D 视图截图功能，支持上传到服务器

import { ref } from 'vue';

import { useViewerContext } from './useViewerContext';

import type { ReviewAttachment } from '@/types/auth';

import { reviewAttachmentUploadWithProgress } from '@/api/reviewApi';

export type ScreenshotKind = 'manual' | 'annotation_shot' | 'auto_cloud_finish';

export interface CaptureOptions {
  filename?: string;
  kind?: ScreenshotKind;
  sourceAnnotationId?: string;
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
    if (!viewer) return null;

    const scene = viewer.scene as unknown as {
      canvas?: { canvas?: HTMLCanvasElement };
    };
    return scene.canvas?.canvas || null;
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

    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob),
        format,
        quality
      );
    });
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
   *
   * 第二个参数兼容两种写法：
   *  - string: 作为 filename 使用（旧调用方式，保留向后兼容）
   *  - CaptureOptions: 结构化配置，支持 kind 与 sourceAnnotationId 元数据
   *
   * 注：kind / sourceAnnotationId 目前通过 filename 前缀暗含（`{kind}-{annotationId}-...`）。
   * 后端扩展 ReviewAttachment 字段后，可改为显式传递。
   */
  async function captureAndUpload(
    taskId: string | null = null,
    optionsOrFilename?: CaptureOptions | string
  ): Promise<ReviewAttachment | null> {
    if (isCapturing.value) return null;

    const opts: CaptureOptions =
      typeof optionsOrFilename === 'string'
        ? { filename: optionsOrFilename }
        : optionsOrFilename || {};

    isCapturing.value = true;
    uploadProgress.value = 0;

    try {
      const blob = await captureToBlob('image/png');
      if (!blob) {
        console.error('Failed to capture screenshot');
        return null;
      }

      const defaultFilename = buildDefaultFilename(opts);
      const name = opts.filename || defaultFilename;
      const file = new File([blob], name, { type: 'image/png' });

      const response = await reviewAttachmentUploadWithProgress(
        taskId,
        file,
        (percent) => {
          uploadProgress.value = percent;
        }
      );

      if (response.success && response.attachment) {
        return response.attachment;
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

  function buildDefaultFilename(opts: CaptureOptions): string {
    const ts = Date.now();
    if (opts.kind === 'annotation_shot' && opts.sourceAnnotationId) {
      return `annotation-${opts.sourceAnnotationId}-${ts}.png`;
    }
    if (opts.kind === 'auto_cloud_finish' && opts.sourceAnnotationId) {
      return `cloud-${opts.sourceAnnotationId}-${ts}.png`;
    }
    return `screenshot-${ts}.png`;
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
