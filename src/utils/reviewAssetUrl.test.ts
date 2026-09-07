import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./apiBase', () => ({
  getBackendApiBaseUrl: vi.fn(() => 'http://123.57.182.243:3100'),
}));

import { getBackendApiBaseUrl } from './apiBase';
import { resolveReviewAssetUrl } from './reviewAssetUrl';

describe('resolveReviewAssetUrl', () => {
  beforeEach(() => {
    vi.mocked(getBackendApiBaseUrl).mockReturnValue('http://123.57.182.243:3100');
  });

  it('将后端附件相对地址解析到后端服务', () => {
    expect(resolveReviewAssetUrl('/files/review_attachments/example.png'))
      .toBe('http://123.57.182.243:3100/files/review_attachments/example.png');
  });

  it('保留可直接显示的绝对地址和 data URL', () => {
    expect(resolveReviewAssetUrl('https://cdn.example.com/example.png'))
      .toBe('https://cdn.example.com/example.png');
    expect(resolveReviewAssetUrl('data:image/png;base64,abc'))
      .toBe('data:image/png;base64,abc');
  });

  it('同源代理模式下保留相对地址', () => {
    vi.mocked(getBackendApiBaseUrl).mockReturnValue('');
    expect(resolveReviewAssetUrl('/files/review_attachments/example.png'))
      .toBe('/files/review_attachments/example.png');
  });
});
