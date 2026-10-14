import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import type { UploadedFile } from './FileUploadSection.vue';

const uploadMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('@/api/reviewApi', () => ({
  reviewAttachmentUploadWithProgress: uploadMock,
  reviewAttachmentDelete: deleteMock,
  isAttachmentUploadAborted: (error: unknown) => error instanceof Error && error.name === 'AbortError',
}));

function createFile(name: string, size = 1024, type = 'application/pdf'): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('FileUploadSection', () => {
  beforeEach(() => {
    uploadMock.mockReset();
    deleteMock.mockReset();
    deleteMock.mockResolvedValue({ success: true });
  });

  it('supports selecting files by click and removes uploaded items from the list', async () => {
    const { default: FileUploadSection } = await import('./FileUploadSection.vue');

    const host = document.createElement('div');
    document.body.appendChild(host);

    let modelValue: UploadedFile[] = [];
    const app = createApp({
      setup() {
        const handleUpdate = (value: UploadedFile[]) => {
          modelValue = value;
          app._instance?.proxy?.$forceUpdate();
        };

        return () => h(FileUploadSection, {
          modelValue,
          taskId: 'task-1',
          autoUpload: true,
          'onUpdate:modelValue': handleUpdate,
        });
      },
    });

    uploadMock.mockImplementation(async (_taskId: string | null, _file: File, onProgress?: (percent: number) => void) => {
      onProgress?.(55);
      await Promise.resolve();
      onProgress?.(100);
      return {
        success: true,
        attachment: {
          id: 'att-1',
          url: '/files/review_attachments/att-1.pdf',
        },
      };
    });

    app.mount(host);

    const input = host.querySelector('[data-testid="file-upload-input"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    const file = createFile('drawing.pdf');
    Object.defineProperty(input!, 'files', {
      configurable: true,
      value: [file],
    });

    input!.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
    await nextTick();

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('drawing.pdf');
    expect(host.textContent).toContain('已上传');

    const removeButton = host.querySelector('[data-testid="file-upload-remove-button"]') as HTMLButtonElement | null;
    expect(removeButton).not.toBeNull();
    removeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // 已上传的条目必须先删除服务端附件，否则任务恢复时会把它合并回列表
    await vi.waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith('att-1');
      expect(host.textContent).not.toContain('drawing.pdf');
    });

    app.unmount();
    host.remove();
  });

  it('supports drag-and-drop upload and shows completion state after upload resolves', async () => {
    const { default: FileUploadSection } = await import('./FileUploadSection.vue');

    const host = document.createElement('div');
    document.body.appendChild(host);

    let modelValue: UploadedFile[] = [];
    const app = createApp({
      setup() {
        const handleUpdate = (value: UploadedFile[]) => {
          modelValue = value;
          app._instance?.proxy?.$forceUpdate();
        };

        return () => h(FileUploadSection, {
          modelValue,
          taskId: 'task-2',
          autoUpload: true,
          'onUpdate:modelValue': handleUpdate,
        });
      },
    });

    uploadMock.mockImplementation(async (_taskId: string | null, _file: File, onProgress?: (percent: number) => void) => {
      onProgress?.(42);
      await Promise.resolve();
      return {
        success: true,
        attachment: {
          id: 'att-2',
          url: '/files/review_attachments/att-2.pdf',
        },
      };
    });

    app.mount(host);

    const dropzone = host.querySelector('[data-testid="file-upload-dropzone"]') as HTMLDivElement | null;
    expect(dropzone).not.toBeNull();

    const file = createFile('dragged.pdf');
    const dragEnterEvent = new Event('dragenter', { bubbles: true, cancelable: true });
    Object.defineProperty(dragEnterEvent, 'dataTransfer', {
      value: { files: [file] },
    });
    dropzone!.dispatchEvent(dragEnterEvent);
    await nextTick();

    expect(dropzone!.className).toContain('border-brand');

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [file] },
    });
    dropzone!.dispatchEvent(dropEvent);
    await nextTick();

    expect(host.textContent).toContain('dragged.pdf');

    await vi.waitFor(() => {
      expect(host.textContent).toContain('已上传');
      expect(uploadMock).toHaveBeenCalledTimes(1);
      const completedProgressBar = host.querySelector('[data-testid="file-upload-progress-bar"]') as HTMLDivElement | null;
      expect(completedProgressBar).toBeNull();
    });

    app.unmount();
    host.remove();
  });

  it('cancels an in-flight upload and leaves the entry retryable', async () => {
    const { default: FileUploadSection } = await import('./FileUploadSection.vue');

    const host = document.createElement('div');
    document.body.appendChild(host);

    let modelValue: UploadedFile[] = [];
    const cancelled: UploadedFile[] = [];
    const app = createApp({
      setup() {
        const handleUpdate = (value: UploadedFile[]) => {
          modelValue = value;
          app._instance?.proxy?.$forceUpdate();
        };

        return () => h(FileUploadSection, {
          modelValue,
          taskId: 'task-cancel',
          autoUpload: true,
          'onUpdate:modelValue': handleUpdate,
          onUploadCancel: (file: UploadedFile) => cancelled.push(file),
        });
      },
    });

    // 上传一直挂起，直到 signal 中止才 reject，模拟真实的大文件上传
    let observedSignal: AbortSignal | undefined;
    uploadMock.mockImplementation(async (
      _taskId: string | null,
      _file: File,
      onProgress?: (percent: number) => void,
      options?: { signal?: AbortSignal },
    ) => {
      observedSignal = options?.signal;
      onProgress?.(30);
      return await new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          const error = new Error('Upload aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    app.mount(host);

    const input = host.querySelector('[data-testid="file-upload-input"]') as HTMLInputElement | null;
    Object.defineProperty(input!, 'files', {
      configurable: true,
      value: [createFile('huge.pdf', 4096)],
    });
    input!.dispatchEvent(new Event('change', { bubbles: true }));

    const cancelButton = await vi.waitFor(() => {
      const button = host.querySelector('[data-testid="file-upload-cancel-button"]') as HTMLButtonElement | null;
      expect(button).not.toBeNull();
      return button!;
    });
    expect(observedSignal?.aborted).toBe(false);

    cancelButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(() => {
      expect(observedSignal?.aborted).toBe(true);
      expect(host.textContent).toContain('已取消上传');
      expect(cancelled).toHaveLength(1);
    });

    // 取消后仍保留条目与重试入口，不当成网络错误吞掉
    expect(host.querySelector('[data-testid="file-upload-retry-button"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="file-upload-cancel-button"]')).toBeNull();

    app.unmount();
    host.remove();
  });

  it('shows upload errors and retries failed files in manual mode', async () => {
    const { default: FileUploadSection } = await import('./FileUploadSection.vue');

    const host = document.createElement('div');
    document.body.appendChild(host);

    let modelValue: UploadedFile[] = [];
    const app = createApp({
      setup() {
        const handleUpdate = (value: UploadedFile[]) => {
          modelValue = value;
          app._instance?.proxy?.$forceUpdate();
        };

        return () => h(FileUploadSection, {
          modelValue,
          taskId: 'task-3',
          autoUpload: false,
          'onUpdate:modelValue': handleUpdate,
        });
      },
    });

    uploadMock
      .mockRejectedValueOnce(new Error('上传服务不可用'))
      .mockResolvedValueOnce({
        success: true,
        attachment: {
          id: 'att-3',
          url: '/files/review_attachments/att-3.pdf',
        },
      });

    app.mount(host);

    const input = host.querySelector('[data-testid="file-upload-input"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    const file = createFile('retry.pdf');
    Object.defineProperty(input!, 'files', {
      configurable: true,
      value: [file],
    });

    input!.dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();

    expect(host.textContent).toContain('retry.pdf');
    expect(host.textContent).not.toContain('上传服务不可用');

    const startButton = host.querySelector('[data-testid="file-upload-start-button"]') as HTMLButtonElement | null;
    expect(startButton).not.toBeNull();
    startButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    await nextTick();

    expect(host.textContent).toContain('上传服务不可用');

    const retryButton = host.querySelector('[data-testid="file-upload-retry-button"]') as HTMLButtonElement | null;
    expect(retryButton).not.toBeNull();
    retryButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    await nextTick();

    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('已上传');

    app.unmount();
    host.remove();
  });

  it('shows 查看 for an uploaded docx and emits preview when previewable', async () => {
    const { default: FileUploadSection } = await import('./FileUploadSection.vue');

    const host = document.createElement('div');
    document.body.appendChild(host);

    let modelValue: UploadedFile[] = [];
    const previews: UploadedFile[] = [];
    const app = createApp({
      setup() {
        const handleUpdate = (value: UploadedFile[]) => {
          modelValue = value;
          app._instance?.proxy?.$forceUpdate();
        };

        return () => h(FileUploadSection, {
          modelValue,
          taskId: 'task-preview',
          autoUpload: true,
          previewable: true,
          'onUpdate:modelValue': handleUpdate,
          onPreview: (file: UploadedFile) => {
            previews.push(file);
          },
        });
      },
    });

    uploadMock.mockImplementation(async (_taskId: string | null, _file: File, onProgress?: (percent: number) => void) => {
      onProgress?.(100);
      return {
        success: true,
        attachment: {
          id: 'att-docx',
          url: '/files/review_attachments/att-docx.docx',
        },
      };
    });

    app.mount(host);

    const input = host.querySelector('[data-testid="file-upload-input"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    const file = createFile(
      'notes.docx',
      1024,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    Object.defineProperty(input!, 'files', {
      configurable: true,
      value: [file],
    });
    input!.dispatchEvent(new Event('change', { bubbles: true }));

    const previewButton = await vi.waitFor(() => {
      const button = host.querySelector('[data-testid="file-upload-preview-att-docx"]') as HTMLButtonElement | null;
      expect(button).not.toBeNull();
      return button!;
    });
    expect(previewButton.textContent).toContain('查看');
    previewButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({
      name: 'notes.docx',
      status: 'success',
      serverAttachmentId: 'att-docx',
      serverUrl: '/files/review_attachments/att-docx.docx',
    });

    app.unmount();
    host.remove();
  });

  it('清空全部会删除已上传附件，删除失败的那条留在列表里', async () => {
    const { default: FileUploadSection } = await import('./FileUploadSection.vue');
    deleteMock.mockImplementation(async (id: string) => {
      if (id === 'att-bad') return { success: false, error_message: '仍被引用' };
      return { success: true };
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    let modelValue: UploadedFile[] = [
      {
        id: 'local-ok',
        name: 'ok.pdf',
        size: 12,
        type: 'application/pdf',
        status: 'success' as const,
        progress: 100,
        serverAttachmentId: 'att-ok',
      },
      {
        id: 'local-bad',
        name: 'bad.pdf',
        size: 12,
        type: 'application/pdf',
        status: 'success' as const,
        progress: 100,
        serverAttachmentId: 'att-bad',
      },
      {
        id: 'local-pending',
        name: 'pending.pdf',
        size: 12,
        type: 'application/pdf',
        status: 'pending' as const,
        progress: 0,
      },
    ];
    const app = createApp({
      setup() {
        const handleUpdate = (value: UploadedFile[]) => {
          modelValue = value;
          app._instance?.proxy?.$forceUpdate();
        };
        return () => h(FileUploadSection, {
          modelValue,
          taskId: 'task-clear',
          'onUpdate:modelValue': handleUpdate,
        });
      },
    });
    app.mount(host);

    const clearButton = host.querySelector('[data-testid="file-upload-clear-all"]') as HTMLButtonElement | null;
    expect(clearButton).not.toBeNull();
    clearButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith('att-ok');
      expect(deleteMock).toHaveBeenCalledWith('att-bad');
      expect(host.textContent).not.toContain('ok.pdf');
      expect(host.textContent).not.toContain('pending.pdf');
      expect(host.textContent).toContain('bad.pdf');
      expect(host.textContent).toContain('删除失败：仍被引用');
    });
    expect(deleteMock).toHaveBeenCalledTimes(2);

    app.unmount();
    host.remove();
  });

  it('删掉正在预览的附件时关掉预览，删不掉的仍留着', async () => {
    const { default: FileUploadSection } = await import('./FileUploadSection.vue');
    const preview = await import('@/composables/useReviewAttachmentPreview');
    preview.clearReviewAttachmentPreview();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new TextEncoder().encode('%PDF-1.7'), {
      status: 206,
      headers: { 'Content-Type': 'application/pdf' },
    })));

    const shown = {
      id: 'attachment-show',
      name: 'show.pdf',
      url: '/files/review_attachments/show.pdf',
      mimeType: 'application/pdf',
      uploadedAt: 1,
    };
    expect(preview.openReviewAttachmentPreview('task-1', shown)).toBe(true);

    const host = document.createElement('div');
    document.body.appendChild(host);
    let modelValue: UploadedFile[] = [{
      id: 'local-show',
      name: 'show.pdf',
      size: 12,
      type: 'application/pdf',
      status: 'success' as const,
      progress: 100,
      serverAttachmentId: 'attachment-show',
    }];
    const app = createApp({
      setup() {
        const handleUpdate = (value: UploadedFile[]) => {
          modelValue = value;
          app._instance?.proxy?.$forceUpdate();
        };
        return () => h(FileUploadSection, {
          modelValue,
          taskId: 'task-1',
          'onUpdate:modelValue': handleUpdate,
        });
      },
    });
    app.mount(host);

    deleteMock.mockResolvedValueOnce({ success: false, error_message: '仍被引用' });
    const removeButton = host.querySelector('[data-testid="file-upload-remove-button"]') as HTMLButtonElement | null;
    removeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(host.textContent).toContain('删除失败：仍被引用'));
    expect(preview.activeReviewAttachmentPreview.value?.attachment.id).toBe('attachment-show');

    deleteMock.mockResolvedValueOnce({ success: true });
    removeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(host.textContent).not.toContain('show.pdf'));
    expect(preview.activeReviewAttachmentPreview.value).toBeNull();

    app.unmount();
    host.remove();
    preview.clearReviewAttachmentPreview();
    vi.unstubAllGlobals();
  });
});
