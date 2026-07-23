// 截图工具 composable
// 提供 3D 视图截图功能，支持上传到服务器

import { ref } from 'vue';

import { useViewerContext } from './useViewerContext';

import type { ReviewAttachment } from '@/types/auth';

import {
  reviewAttachmentUploadWithProgress,
  type ReviewAttachmentUploadOptions,
} from '@/api/reviewApi';

export type ScreenshotKind = 'manual' | 'annotation_shot' | 'auto_cloud_finish';

/** 截图上传结果：扁平的附件字段 + 画布尺寸与拍摄时间 */
export type ScreenshotUploadResult = ReviewAttachment & {
  width: number;
  height: number;
  capturedAt: number;
};

export type CaptureOptions = {
  filename?: string;
  format?: 'image/png' | 'image/jpeg';
  quality?: number;
  /** 截图用途：参与默认文件名与附件 fileType 推导 */
  kind?: ScreenshotKind;
  /** 来源批注 ID：透传到附件元数据，并参与默认文件名 */
  sourceAnnotationId?: string;
  description?: string;
  fileType?: string;
  /** 额外上传元数据；上面的便捷字段会覆盖其中的同名项 */
  upload?: ReviewAttachmentUploadOptions;
};

export type CaptureAndUploadOptions = CaptureOptions;

function buildDefaultFilename(opts: CaptureOptions, capturedAt: number, ext: string): string {
  if (opts.kind === 'annotation_shot' && opts.sourceAnnotationId) {
    return `annotation-${opts.sourceAnnotationId}-${capturedAt}.${ext}`;
  }
  if (opts.kind === 'auto_cloud_finish' && opts.sourceAnnotationId) {
    return `cloud-${opts.sourceAnnotationId}-${capturedAt}.${ext}`;
  }
  return `screenshot-${capturedAt}.${ext}`;
}

function buildUploadOptions(opts: CaptureOptions): ReviewAttachmentUploadOptions | undefined {
  const options: ReviewAttachmentUploadOptions = { ...(opts.upload ?? {}) };
  if (opts.sourceAnnotationId) {
    options.sourceAnnotationId = opts.sourceAnnotationId;
  }
  if (opts.description) {
    options.description = opts.description;
  }
  const fileType = opts.fileType
    || options.fileType
    || (opts.kind === 'annotation_shot' ? 'annotation_screenshot' : undefined);
  if (fileType) {
    options.fileType = fileType;
  }
  return Object.keys(options).length > 0 ? options : undefined;
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

    const canvas = (viewer as unknown as { canvas?: HTMLCanvasElement }).canvas;
    if (canvas instanceof HTMLCanvasElement) {
      return canvas;
    }

    const scene = viewer.scene as unknown as {
      canvas?: { canvas?: HTMLCanvasElement };
    };
    return scene.canvas?.canvas || null;
  }

  /**
   * 截图前强制渲染一帧。
   *
   * 渲染器采用 preserveDrawingBuffer:false + 按需渲染，直接读 canvas
   * 理论上可能拿到空白 buffer；这里主动请求一帧并等待其完成后再截取。
   * 后台标签页 rAF 可能不触发，用 setTimeout 兜底避免流程挂起。
   */
  async function ensureFreshFrame(): Promise<void> {
    const viewer = viewerRef.value as unknown as {
      requestRender?: (() => void) | null;
    } | null;
    const requestRender = viewer?.requestRender;
    if (typeof requestRender !== 'function') return;

    requestRender();
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      return;
    }
    await Promise.race([
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      }),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 200);
      }),
    ]);
  }

  /**
   * 取用于截图的画布。尺寸标注已绘入主 WebGL scene，直接读取主画布。
   */
  function getCaptureCanvas(): HTMLCanvasElement | null {
    return getCanvas();
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
    await ensureFreshFrame();
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
    await ensureFreshFrame();
    const dataUrl = captureToDataURL(format);
    if (!dataUrl) return false;

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.click();
    return true;
  }

  /**
   * 截取并上传到服务器。
   *
   * 第二个参数兼容两种写法：
   *  - string：作为 filename 使用（旧调用方式，保留向后兼容）
   *  - CaptureOptions：结构化配置，支持 kind / sourceAnnotationId / description 元数据
   */
  async function captureAndUpload(
    taskId: string | null = null,
    options?: string | CaptureOptions
  ): Promise<ScreenshotUploadResult | null> {
    if (isCapturing.value) return null;

    const resolved: CaptureOptions = typeof options === 'string'
      ? { filename: options }
      : (options ?? {});

    isCapturing.value = true;
    uploadProgress.value = 0;

    try {
      await ensureFreshFrame();
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
      const name = resolved.filename || buildDefaultFilename(resolved, capturedAt, ext);
      const file = new File([blob], name, { type: format });

      const response = await reviewAttachmentUploadWithProgress(
        taskId,
        file,
        (percent) => {
          uploadProgress.value = percent;
        },
        buildUploadOptions(resolved),
      );

      if (response.success && response.attachment) {
        return {
          ...response.attachment,
          width: canvas.width || canvas.clientWidth || 0,
          height: canvas.height || canvas.clientHeight || 0,
          capturedAt: response.attachment.uploadedAt || capturedAt,
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
