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

  // URL 参数透传规则：
  // - 如果项目本身配置了 showDbnum，则用项目配置覆盖 URL（历史行为）。
  // - 如果项目未配置 showDbnum，但 URL 已经带了 show_dbnum，则保留（用于 e2e/调试手动指定 dbno）。
  // - 只有两者都没有时才删除 show_dbnum。
  if (project.showDbnum != null) {
    url.searchParams.set('show_dbnum', String(project.showDbnum));
    url.searchParams.delete('debug_refno');
  } else {
    const hasShowDbnumInUrl = new URLSearchParams(window.location.search).has('show_dbnum');
    if (!hasShowDbnumInUrl) {
      url.searchParams.delete('show_dbnum');
    }
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
      // 从后端 API 加载项目列表（通过 Vite proxy 转发到 plant-model-gen）
      const response = await fetch('/api/projects');
      if (!response.ok) {
        throw new Error(`Failed to load projects: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      // 后端返回 {items: ProjectItem[], total, page, per_page}
      const items: Record<string, unknown>[] = data.items || [];

      // 将后端 ProjectItem 映射为前端 ModelProject
      // 后端字段: name, version, url, env, status, owner, ...
      // name 同时作为 output 目录名（path）
      projects.value = items.map((item) => ({
        id: String(item.id || item.name || ''),
        name: String(item.name || ''),
        description: String(item.notes || item.env || ''),
        path: String(item.name || ''),
        showDbnum: typeof item.show_dbnum === 'number' ? item.show_dbnum : undefined,
        thumbnail: '/favicon.ico',
        updatedAt: item.updated_at ? String(item.updated_at) : undefined,
        default: false,
      }));

      const requested = readRequestedProject();
      const matchedProject = projects.value.find((project) =>
        project.id === requested.projectId ||
        project.path === requested.projectId ||
        project.id === requested.projectPath ||
        project.path === requested.projectPath
      );
      if (matchedProject) {
        applyProject(matchedProject, false);
      } else if (requested.projectPath || requested.projectId) {
        // 后端项目列表中没有匹配项（可能未注册），
        // 但 URL 明确指定了项目，直接根据 URL 参数构造项目
        const projectPath = requested.projectPath || requested.projectId!;
        const urlParams = new URLSearchParams(window.location.search);
        const showDbnum = urlParams.get('show_dbnum');
        const autoProject: ModelProject = {
          id: projectPath,
          name: projectPath,
          description: '',
          path: projectPath,
          showDbnum: showDbnum ? Number(showDbnum) : undefined,
          default: false,
        };
        projects.value = [...projects.value, autoProject];
        applyProject(autoProject, false);
      }
    } catch (error) {
      console.error('Failed to load model projects from API:', error);
      projects.value = [];
      // 设置默认项目以防后端不可达
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
