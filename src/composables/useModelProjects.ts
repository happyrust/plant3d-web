import { ref, computed } from 'vue';

export type ModelProject = {
  id: string;
  name: string;
  description: string;
  path: string;
  default?: boolean;
};

const projects = ref<ModelProject[]>([]);
const currentProject = ref<ModelProject | null>(null);
const isLoading = ref(false);

export function useModelProjects() {
  // 加载项目列表
  async function loadProjects() {
    if (isLoading.value) return;
    
    isLoading.value = true;
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}bundles/projects.json`);
      if (!response.ok) {
        throw new Error(`Failed to load projects: ${response.status} ${response.statusText}`);
      }
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Projects endpoint did not return JSON');
      }
      
      const data = await response.json();
      projects.value = data;
      
      // 设置默认项目
      if (!currentProject.value && projects.value.length > 0) {
        const defaultProject = projects.value.find(p => p.default) || projects.value[0];
        if (defaultProject) {
          currentProject.value = defaultProject;
          
          // 如果只有一个项目，自动触发加载
          if (projects.value.length === 1) {
            window.dispatchEvent(new CustomEvent('modelProjectChanged', { 
              detail: { project: defaultProject } 
            }));
          }
        }
      }
    } catch (error) {
      console.error('Failed to load model projects:', error);
      projects.value = [];
      // 设置默认项目以防加载失败
      const fallbackProject = {
        id: 'ams-model',
        name: 'AMS 项目',
        description: 'AMS 系统模型',
        path: 'ams-model',
        default: true
      };
      projects.value = [fallbackProject];
      currentProject.value = fallbackProject;
    } finally {
      isLoading.value = false;
    }
  }

  // 切换项目
  function switchProject(projectId: string) {
    const project = projects.value.find(p => p.id === projectId);
    if (project) {
      currentProject.value = project;
      // 触发重新加载模型
      window.dispatchEvent(new CustomEvent('modelProjectChanged', { 
        detail: { project } 
      }));
    }
  }

  // 按 ID 切换项目（支持嵌入模式）
  function switchProjectById(projectId: string): boolean {
    const project = projects.value.find(p => p.id === projectId);
    if (project && currentProject.value?.id !== projectId) {
      currentProject.value = project;
      window.dispatchEvent(new CustomEvent('modelProjectChanged', { 
        detail: { project } 
      }));
      return true;
    }
    return false;
  }

  // 获取当前项目的 bundle URL
  const currentBundleUrl = computed(() => {
    if (!currentProject.value) return '';
    return `/bundles/${currentProject.value.path}/`;
  });

  // 初始化时加载项目列表
  loadProjects();

  return {
    projects: computed(() => projects.value),
    currentProject: computed(() => currentProject.value),
    isLoading: computed(() => isLoading.value),
    loadProjects,
    switchProject,
    switchProjectById,
    currentBundleUrl,
  };
}
