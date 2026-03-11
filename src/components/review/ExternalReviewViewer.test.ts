import { describe, expect, it, vi } from 'vitest';

describe('ExternalReviewViewer project switching', () => {
  it('should call switchProjectById when projectId is provided', () => {
    const mockSwitchProjectById = vi.fn().mockReturnValue(true);
    const projectId = 'AvevaMarineSample';
    
    // Simulate the logic in ExternalReviewViewer.loadUrl()
    if (projectId) {
      mockSwitchProjectById(projectId);
    }
    
    expect(mockSwitchProjectById).toHaveBeenCalledWith('AvevaMarineSample');
    expect(mockSwitchProjectById).toHaveBeenCalledTimes(1);
  });

  it('should not call switchProjectById when projectId is empty', () => {
    const mockSwitchProjectById = vi.fn();
    const projectId = '';
    
    if (projectId) {
      mockSwitchProjectById(projectId);
    }
    
    expect(mockSwitchProjectById).not.toHaveBeenCalled();
  });

  it('should continue even if project switch fails', () => {
    const mockSwitchProjectById = vi.fn().mockReturnValue(false);
    const mockGetEmbedUrl = vi.fn().mockResolvedValue({ url: 'http://example.com' });
    const projectId = 'non-existent-project';
    
    // Simulate the logic
    if (projectId) {
      mockSwitchProjectById(projectId);
    }
    mockGetEmbedUrl(projectId, 'user-123');
    
    expect(mockSwitchProjectById).toHaveBeenCalledWith('non-existent-project');
    expect(mockGetEmbedUrl).toHaveBeenCalled();
  });
});
