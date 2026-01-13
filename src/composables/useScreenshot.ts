// 截图工具 composable
// 提供 3D 视图截图功能，支持上传到服务器

import { ref } from 'vue';
import { useViewerContext } from './useViewerContext';
import { reviewAttachmentUploadWithProgress } from '@/api/reviewApi';
import type { ReviewAttachment } from '@/types/auth';

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
   */
  async function captureAndUpload(
    taskId: string | null = null,
    filename?: string
  ): Promise<ReviewAttachment | null> {
    if (isCapturing.value) return null;

    isCapturing.value = true;
    uploadProgress.value = 0;

    try {
      const blob = await captureToBlob('image/png');
      if (!blob) {
        console.error('Failed to capture screenshot');
        return null;
      }

      const name = filename || `screenshot-${Date.now()}.png`;
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
