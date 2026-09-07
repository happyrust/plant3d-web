// Throwaway harness: mount the review attachment upload / list / preview components
// with a stubbed backend, for demo screenshots.
// See scripts/pen-preview/review-attachment-shot.mjs.
import { createApp, h, ref } from 'vue';

import '@/assets/tailwind.css';

import type { UploadedFile } from '@/components/review/FileUploadSection.vue';
import type { ReviewAttachment } from '@/types/auth';

import ReviewAttachmentPreviewPanelDock from '@/components/dock_panels/ReviewAttachmentPreviewPanelDock.vue';
import AssociatedFilesList from '@/components/review/AssociatedFilesList.vue';
import FileUploadSection from '@/components/review/FileUploadSection.vue';
import { openReviewAttachmentPreview } from '@/composables/useReviewAttachmentPreview';

const TASK_ID = 'TASK-DEMO-2026-0820';
const now = Date.now();
const MINUTE = 60_000;

const attachments = ref<ReviewAttachment[]>([
  {
    id: 'att-pdf-1',
    name: '管道支架受力分析报告.pdf',
    url: '/demo-assets/stress-report.pdf',
    size: 486_912,
    mimeType: 'application/pdf',
    uploadedAt: now - 180 * MINUTE,
  },
  {
    id: 'att-img-1',
    name: '碰撞检查截图-A区管廊.png',
    url: '/demo-assets/collision-shot.png',
    size: 214_308,
    mimeType: 'image/png',
    uploadedAt: now - 95 * MINUTE,
  },
  {
    id: 'att-dwg-1',
    name: 'A区设备布置图.dwg',
    url: '/demo-assets/layout.dwg',
    size: 3_482_112,
    mimeType: 'image/vnd.dwg',
    uploadedAt: now - 40 * MINUTE,
  },
  {
    id: 'att-xlsx-1',
    name: '管道材料统计表.xlsx',
    url: '/demo-assets/material.xlsx',
    size: 71_680,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    uploadedAt: now - 22 * MINUTE,
  },
  {
    id: 'att-broken-1',
    name: '历史版本审查意见（链接已失效）.pdf',
    url: '/demo-assets/missing.pdf',
    size: 128_000,
    mimeType: 'application/pdf',
    uploadedAt: now - 6 * MINUTE,
  },
]);

const uploadFiles = ref<UploadedFile[]>([]);

function previewAttachment(attachment: ReviewAttachment): void {
  openReviewAttachmentPreview(TASK_ID, attachment);
}

createApp({
  render: () =>
    h(FileUploadSection, {
      modelValue: uploadFiles.value,
      taskId: TASK_ID,
      autoUpload: true,
      maxFiles: 10,
      maxSize: 50,
      'onUpdate:modelValue': (next: UploadedFile[]) => {
        uploadFiles.value = next;
      },
      // 上传成功后并入附件列表，演示「上传 → 列表 → 预览」完整闭环
      onUploadComplete: (file: UploadedFile) => {
        if (!file.serverAttachmentId || attachments.value.some((a) => a.id === file.serverAttachmentId)) return;
        attachments.value = [
          ...attachments.value,
          {
            id: file.serverAttachmentId,
            name: file.name,
            url: file.serverUrl || '',
            size: file.size,
            mimeType: file.type,
            uploadedAt: Date.now(),
          },
        ];
      },
    }),
}).mount('#app-upload');

createApp({
  render: () =>
    h(AssociatedFilesList, {
      attachments: attachments.value,
      title: '附件材料',
      description: '',
      emptyText: '暂无附件材料',
      previewable: true,
      editable: true,
      onPreview: previewAttachment,
    }),
}).mount('#app-files');

createApp(ReviewAttachmentPreviewPanelDock).mount('#app-preview');
