import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, shallowRef } from 'vue';

const uploadMock = vi.hoisted(() =>
  vi.fn(async () => ({
    success: true,
    attachment: {
      id: 'att-1',
      url: 'https://example.com/att-1.png',
      name: 'uploaded.png',
      size: 123,
    },
  }))
);

const viewerRef = shallowRef<unknown | null>(null);

vi.mock('@/api/reviewApi', () => ({
  reviewAttachmentUploadWithProgress: uploadMock,
}));

vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => ({ viewerRef }),
}));

import { useScreenshot, type CaptureOptions } from './useScreenshot';

type BlobCallback = (blob: Blob | null) => void;

function installCanvas(options: { toBlobBlob?: Blob | null; dataUrl?: string } = {}) {
  const { toBlobBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), dataUrl = 'data:image/png;base64,AAA' } = options;
  const canvas = {
    toBlob: vi.fn((cb: BlobCallback) => {
      cb(toBlobBlob);
    }),
    toDataURL: vi.fn(() => dataUrl),
  } as unknown as HTMLCanvasElement;

  viewerRef.value = {
    scene: {
      canvas: {
        canvas,
      },
    },
  };

  return canvas;
}

function clearCanvas() {
  viewerRef.value = null;
}

describe('useScreenshot', () => {
  beforeEach(() => {
    uploadMock.mockClear();
    clearCanvas();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T12:00:00Z'));
  });

  describe('captureAndUpload — 入参兼容性', () => {
    it('兼容旧 string 入参：作为 filename 使用', async () => {
      installCanvas();
      const { captureAndUpload } = useScreenshot();

      const attachment = await captureAndUpload('task-1', 'custom-name.png');

      expect(attachment).not.toBeNull();
      expect(uploadMock).toHaveBeenCalledTimes(1);
      const [, file] = uploadMock.mock.calls[0];
      expect((file as File).name).toBe('custom-name.png');
    });

    it('接受 CaptureOptions：显式 filename 覆盖默认值', async () => {
      installCanvas();
      const { captureAndUpload } = useScreenshot();

      const opts: CaptureOptions = {
        filename: 'override.png',
        kind: 'annotation_shot',
        sourceAnnotationId: 'ann-1',
      };
      await captureAndUpload('task-1', opts);

      const [, file] = uploadMock.mock.calls[0];
      expect((file as File).name).toBe('override.png');
    });

    it('省略 options → 使用默认 filename (screenshot-<ts>.png)', async () => {
      installCanvas();
      const { captureAndUpload } = useScreenshot();

      await captureAndUpload('task-1');

      const [, file] = uploadMock.mock.calls[0];
      expect((file as File).name).toMatch(/^screenshot-\d+\.png$/);
    });
  });

  describe('captureAndUpload — buildDefaultFilename 分支', () => {
    it('kind=annotation_shot + sourceAnnotationId → annotation-<id>-<ts>.png', async () => {
      installCanvas();
      const { captureAndUpload } = useScreenshot();

      await captureAndUpload('task-1', {
        kind: 'annotation_shot',
        sourceAnnotationId: 'ann-42',
      });

      const [, file] = uploadMock.mock.calls[0];
      expect((file as File).name).toMatch(/^annotation-ann-42-\d+\.png$/);
    });

    it('kind=auto_cloud_finish + sourceAnnotationId → cloud-<id>-<ts>.png', async () => {
      installCanvas();
      const { captureAndUpload } = useScreenshot();

      await captureAndUpload('task-1', {
        kind: 'auto_cloud_finish',
        sourceAnnotationId: 'cloud-7',
      });

      const [, file] = uploadMock.mock.calls[0];
      expect((file as File).name).toMatch(/^cloud-cloud-7-\d+\.png$/);
    });

    it('kind=manual → screenshot-<ts>.png（兜底）', async () => {
      installCanvas();
      const { captureAndUpload } = useScreenshot();

      await captureAndUpload('task-1', { kind: 'manual' });

      const [, file] = uploadMock.mock.calls[0];
      expect((file as File).name).toMatch(/^screenshot-\d+\.png$/);
    });

    it('kind 指定但缺 sourceAnnotationId → 降级到 screenshot-<ts>.png', async () => {
      installCanvas();
      const { captureAndUpload } = useScreenshot();

      await captureAndUpload('task-1', { kind: 'annotation_shot' });

      const [, file] = uploadMock.mock.calls[0];
      expect((file as File).name).toMatch(/^screenshot-\d+\.png$/);
    });
  });

  describe('captureAndUpload — 竞态与错误', () => {
    it('并发调用：第二次命中 isCapturing 门禁立即返回 null', async () => {
      installCanvas({
        toBlobBlob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
      });

      // 让 toBlob 异步以模拟慢回调，制造竞态窗口
      let pendingCb: BlobCallback | null = null;
      const scene = (viewerRef.value as { scene?: { canvas?: { canvas?: HTMLCanvasElement } } })?.scene;
      const canvas = scene?.canvas?.canvas as HTMLCanvasElement;
      (canvas.toBlob as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce((cb: BlobCallback) => {
        pendingCb = cb;
      });

      const { captureAndUpload, isCapturing } = useScreenshot();

      const first = captureAndUpload('task-1');
      await nextTick();
      expect(isCapturing.value).toBe(true);

      const second = await captureAndUpload('task-2');
      expect(second).toBeNull();

      pendingCb?.(new Blob([new Uint8Array([1])], { type: 'image/png' }));
      const firstRes = await first;
      expect(firstRes).not.toBeNull();
    });

    it('viewer 未就绪 → 返回 null 且不触发上传', async () => {
      clearCanvas();
      const { captureAndUpload } = useScreenshot();

      const result = await captureAndUpload('task-1');

      expect(result).toBeNull();
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it('上传返回 success=false → 返回 null', async () => {
      installCanvas();
      uploadMock.mockResolvedValueOnce({ success: false, error_message: 'boom' });

      const { captureAndUpload } = useScreenshot();
      const result = await captureAndUpload('task-1');

      expect(result).toBeNull();
    });
  });

  describe('其他辅助函数', () => {
    it('captureToDataURL：viewer 就绪时返回 dataUrl', () => {
      installCanvas({ dataUrl: 'data:image/png;base64,XYZ' });
      const { captureToDataURL } = useScreenshot();

      const dataUrl = captureToDataURL();
      expect(dataUrl).toBe('data:image/png;base64,XYZ');
    });

    it('captureToDataURL：viewer 未就绪返回 null', () => {
      clearCanvas();
      const { captureToDataURL } = useScreenshot();

      expect(captureToDataURL()).toBeNull();
    });
  });
});
