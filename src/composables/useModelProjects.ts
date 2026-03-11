import { ref, computed } from 'vue';

import { setCurrentProjectPath } from '@/lib/filesOutput';

export type ModelProject = {
  id: string;
  name: string;
  description: string;
  path: string;
  showDbnum?: number;
  thumbnail?: string;
  updatedAt?: string;
  default?: boolean;
};

const projects = ref<ModelProject[]>([]);
const currentProject = ref<ModelProject | null>(null);
const isLoading = ref(false);

function readRequestedProject(): { projectId: string | null; projectPath: string | null } {
  if (typeof window === 'undefined') {
    return { projectId: null, projectPath: null };
  }

  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('project_id');
  const projectPath = params.get('output_project');
  return {
    projectId: projectId ? String(projectId).trim() : null,
    projectPath: projectPath ? String(projectPath).trim() : null,
  };
}

function syncProjectUrl(project: ModelProject): void {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  url.searchParams.set('output_project', project.path);

  if (project.showDbnum != null) {
    url.searchParams.set('show_dbnum', String(project.showDbnum));
    url.searchParams.delete('debug_refno');
  } else {
    url.searchParams.delete('show_dbnum');
  }

  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function applyProject(project: ModelProject, emitChangeEvent: boolean): void {
  currentProject.value = project;
  setCurrentProjectPath(project.path);
  syncProjectUrl(project);

  if (emitChangeEvent && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('modelProjectChanged', {
      detail: { project }
    }));
  }
}

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

      const requested = readRequestedProject();
      const matchedProject = projects.value.find((project) =>
        project.id === requested.projectId ||
        project.path === requested.projectId ||
        project.id === requested.projectPath ||
        project.path === requested.projectPath
      );
      if (matchedProject) {
        applyProject(matchedProject, false);
      }
    } catch (error) {
      console.error('Failed to load model projects:', error);
      projects.value = [];
      // 设置默认项目以防加载失败
      const fallbackProject = {
        id: 'ams-model',
        name: 'AMS 项目',
        description: 'AMS 系统模型',
        path: 'AvevaMarineSample',
        showDbnum: 7997,
        default: true
      };
      projects.value = [fallbackProject];
      applyProject(fallbackProject, false);
    } finally {
      isLoading.value = false;
    }
  }

  // 选择项目（首次进入）
  function selectProject(projectId: string) {
    const project = projects.value.find(p => p.id === projectId);
    if (project) {
      applyProject(project, true);
    }
  }

  // 切换项目
  function switchProject(projectId: string) {
    const project = projects.value.find(p => p.id === projectId);
    if (project) {
      applyProject(project, true);
    }
  }

  // 按 ID 切换项目（支持嵌入模式，支持通过 id 或 path 匹配）
  function switchProjectById(projectId: string): boolean {
    const project = projects.value.find(p => p.id === projectId || p.path === projectId);
    if (project && currentProject.value?.id !== project.id) {
      applyProject(project, true);
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
    selectProject,
    switchProject,
    switchProjectById,
    currentBundleUrl,
  };
}
