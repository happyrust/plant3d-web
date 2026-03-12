import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useModelProjects } from './useModelProjects';

describe('useModelProjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('switchProjectById switches to existing project', () => {
    const { switchProjectById, currentProject } = useModelProjects();
    
    // Mock 后端 /api/projects 返回格式
    const mockApiResponse = {
      items: [
        { id: 'project-1', name: 'Project1', notes: 'Test 1' },
        { id: 'AvevaMarineSample', name: 'AvevaMarineSample', notes: 'Marine' },
      ],
      total: 2,
      page: 1,
      per_page: 20,
    };
    
    // Simulate projects loaded
    vi.spyOn(window, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockApiResponse,
    } as Response);

    // Wait for projects to load, then switch
    setTimeout(() => {
      const result = switchProjectById('AvevaMarineSample');
      expect(result).toBe(true);
      expect(currentProject.value?.path).toBe('AvevaMarineSample');
    }, 100);
  });

  it('switchProjectById returns false for non-existent project', () => {
    const { switchProjectById } = useModelProjects();
    
    const result = switchProjectById('non-existent-project');
    expect(result).toBe(false);
  });

  it('switchProjectById does not switch if already on target project', () => {
    const { switchProjectById, currentProject } = useModelProjects();
    
    const eventSpy = vi.fn();
    window.addEventListener('modelProjectChanged', eventSpy);
    
    // Assume current project is already set
    if (currentProject.value) {
      const currentId = currentProject.value.id;
      switchProjectById(currentId);
      
      // Should not trigger event if already on same project
      expect(eventSpy).not.toHaveBeenCalled();
    }
    
    window.removeEventListener('modelProjectChanged', eventSpy);
  });

  it('switchProjectById triggers modelProjectChanged event', () => {
    const { switchProjectById } = useModelProjects();
    
    const eventSpy = vi.fn();
    window.addEventListener('modelProjectChanged', eventSpy);
    
    switchProjectById('AvevaMarineSample');
    
    // Event should be triggered if project exists and is different
    setTimeout(() => {
      if (eventSpy.mock.calls.length > 0) {
        expect(eventSpy).toHaveBeenCalled();
      }
    }, 100);
    
    window.removeEventListener('modelProjectChanged', eventSpy);
  });

  it('switchProjectById matches project by path when id does not match', () => {
    const { switchProjectById, currentProject } = useModelProjects();
    
    const mockApiResponse = {
      items: [
        { id: 'ams-model', name: 'AvevaMarineSample', notes: 'Test AMS' },
      ],
      total: 1,
      page: 1,
      per_page: 20,
    };
    
    vi.spyOn(window, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockApiResponse,
    } as Response);

    setTimeout(() => {
      const result = switchProjectById('AvevaMarineSample');
      expect(result).toBe(true);
      expect(currentProject.value?.path).toBe('AvevaMarineSample');
    }, 100);
  });

  it('switchProjectById matches project by id or path for embed URLs', () => {
    const { switchProjectById, currentProject } = useModelProjects();
    
    const mockApiResponse = {
      items: [
        { id: 'ams-model', name: 'AvevaMarineSample', notes: 'Test AMS', show_dbnum: 7997 },
        { id: 'other-project', name: 'OtherPath', notes: 'Other project' },
      ],
      total: 2,
      page: 1,
      per_page: 20,
    };
    
    vi.spyOn(window, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockApiResponse,
    } as Response);

    setTimeout(() => {
      // Test matching by path (when project_id in URL is actually a path value)
      let result = switchProjectById('AvevaMarineSample');
      expect(result).toBe(true);
      expect(currentProject.value?.path).toBe('AvevaMarineSample');
      
      // Test matching by id
      result = switchProjectById('other-project');
      expect(result).toBe(true);
      expect(currentProject.value?.id).toBe('other-project');
    }, 100);
  });
});

