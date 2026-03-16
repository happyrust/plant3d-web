import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

const uploadMock = vi.fn();

vi.mock('@/api/reviewApi', () => ({
  reviewAttachmentUploadWithProgress: uploadMock,
}));

function createFile(name: string, size = 1024, type = 'application/pdf'): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('FileUploadSection', () => {
  beforeEach(() => {
    uploadMock.mockReset();
  });

  it('supports selecting files by click and removes uploaded items from the list', async () => {
    const { default: FileUploadSection } = await import('./FileUploadSection.vue');

    const host = document.createElement('div');
    document.body.appendChild(host);

    let modelValue: unknown[] = [];
    const app = createApp({
      setup() {
        const handleUpdate = (value: unknown[]) => {
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
    await nextTick();

    expect(host.textContent).not.toContain('drawing.pdf');

    app.unmount();
    host.remove();
  });

  it('supports drag-and-drop upload and shows completion state after progress updates', async () => {
    const { default: FileUploadSection } = await import('./FileUploadSection.vue');

    const host = document.createElement('div');
    document.body.appendChild(host);

    let modelValue: unknown[] = [];
    const app = createApp({
      setup() {
        const handleUpdate = (value: unknown[]) => {
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

    uploadMock.mockImplementation((_taskId: string | null, _file: File, onProgress?: (percent: number) => void) => {
      setTimeout(() => onProgress?.(42), 0);
      return new Promise((resolve) => {
        setTimeout(() => resolve({
          success: true,
          attachment: {
            id: 'att-2',
            url: '/files/review_attachments/att-2.pdf',
          },
        }), 10);
      });
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

    expect(dropzone!.className).toContain('border-blue-500');

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [file] },
    });
    dropzone!.dispatchEvent(dropEvent);
    await new Promise((resolve) => setTimeout(resolve, 1));
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await nextTick();

    expect(host.textContent).toContain('dragged.pdf');
    const progressBar = host.querySelector('[data-testid="file-upload-progress-bar"]') as HTMLDivElement | null;
    expect(progressBar).not.toBeNull();
    expect(progressBar?.getAttribute('style')).toContain('width: 42%');

    await new Promise((resolve) => setTimeout(resolve, 20));
    await nextTick();

    expect(host.textContent).toContain('已上传');
    const completedProgressBar = host.querySelector('[data-testid="file-upload-progress-bar"]') as HTMLDivElement | null;
    expect(completedProgressBar).toBeNull();

    app.unmount();
    host.remove();
  });

  it('shows upload errors and retries failed files in manual mode', async () => {
    const { default: FileUploadSection } = await import('./FileUploadSection.vue');

    const host = document.createElement('div');
    document.body.appendChild(host);

    let modelValue: unknown[] = [];
    const app = createApp({
      setup() {
        const handleUpdate = (value: unknown[]) => {
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
});
