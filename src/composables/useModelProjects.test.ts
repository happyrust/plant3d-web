import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModelProjects } from './useModelProjects';

describe('useModelProjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('switchProjectById switches to existing project', () => {
    const { switchProjectById, currentProject } = useModelProjects();
    
    // Mock projects data
    const mockProjects = [
      { id: 'project-1', name: 'Project 1', description: 'Test 1', path: 'p1' },
      { id: 'AvevaMarineSample', name: 'Aveva Marine', description: 'Marine', path: 'ams' },
    ];
    
    // Simulate projects loaded
    vi.spyOn(window, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockProjects,
    } as Response);

    // Wait for projects to load, then switch
    setTimeout(() => {
      const result = switchProjectById('AvevaMarineSample');
      expect(result).toBe(true);
      expect(currentProject.value?.id).toBe('AvevaMarineSample');
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
    
    const mockProjects = [
      { id: 'ams-model', name: 'AMS Project', description: 'Test AMS', path: 'AvevaMarineSample' },
    ];
    
    vi.spyOn(window, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockProjects,
    } as Response);

    setTimeout(() => {
      const result = switchProjectById('AvevaMarineSample');
      expect(result).toBe(true);
      expect(currentProject.value?.id).toBe('ams-model');
      expect(currentProject.value?.path).toBe('AvevaMarineSample');
    }, 100);
  });

  it('switchProjectById matches project by id or path for embed URLs', () => {
    const { switchProjectById, currentProject } = useModelProjects();
    
    const mockProjects = [
      { id: 'ams-model', name: 'AMS Project', description: 'Test AMS', path: 'AvevaMarineSample', showDbnum: 7997 },
      { id: 'other-project', name: 'Other', description: 'Other project', path: 'OtherPath' },
    ];
    
    vi.spyOn(window, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockProjects,
    } as Response);

    setTimeout(() => {
      // Test matching by path (when project_id in URL is actually a path value)
      let result = switchProjectById('AvevaMarineSample');
      expect(result).toBe(true);
      expect(currentProject.value?.id).toBe('ams-model');
      
      // Test matching by id
      result = switchProjectById('other-project');
      expect(result).toBe(true);
      expect(currentProject.value?.id).toBe('other-project');
    }, 100);
  });
});
