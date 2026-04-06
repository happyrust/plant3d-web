import { ref, computed } from 'vue';

import { recordRecentProject } from '@/composables/dashboardRecentProjects';
import { refreshToolStorePersistedScope } from '@/composables/useToolStore';
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

/** 模块级：并发 loadProjects（如首屏初始化与 App 嵌入引导）共用同一次 fetch，避免后一次空返回导致 switch 落空列表 */
let loadProjectsInFlight: Promise<void> | null = null;

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

  // show_dbnum 仅在用户手动通过 URL 指定时生效，不从项目配置自动注入。
  // 模型按需加载（通过树导航 / refno 命令触发），无需预加载整个 dbnum。

  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

export function useModelProjects() {
  /** 每个 composable 调用独立，避免单测串扰；与当前实例上的 applyProject 闭包绑定 */
  let lastAppliedProjectPath: string | null = null;

  function applyProject(project: ModelProject, emitChangeEvent: boolean): void {
    const pathChanged = lastAppliedProjectPath !== project.path;
    lastAppliedProjectPath = project.path;

    currentProject.value = project;
    setCurrentProjectPath(project.path);
    syncProjectUrl(project);
    recordRecentProject(project);

    // 与 useToolStore 的持久化作用域对齐：模块首屏导入时可能尚未 setCurrentProjectPath，
    // 或 history.replaceState 不会触发 popstate，需在此处强制按当前项目重载对应 key 的数据。
    if (pathChanged && typeof window !== 'undefined') {
      refreshToolStorePersistedScope({ force: true });
    }

    if (emitChangeEvent && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('modelProjectChanged', {
        detail: { project }
      }));
    }
  }

  // 加载项目列表
  async function loadProjects() {
    if (loadProjectsInFlight) {
      return loadProjectsInFlight;
    }

    loadProjectsInFlight = (async () => {
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
          project.path === requested.projectPath ||
          (!!requested.projectId && project.path === requested.projectId),
        );
        if (matchedProject) {
          applyProject(matchedProject, false);
        } else if (requested.projectPath) {
          // 后端项目列表中没有匹配项（可能未注册），
          // 但 URL 明确指定了项目，直接根据 URL 参数构造项目
          const projectPath = requested.projectPath;
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
        const requested = readRequestedProject();
        // 设置默认项目以防后端不可达
        const fallbackProject = {
          id: 'ams-model',
          name: 'AMS 项目',
          description: 'AMS 系统模型',
          path: 'AvevaMarineSample',
          default: true
        };
        projects.value = [fallbackProject];
        // URL 若已指定其它项目，应避免静默落到默认 AMS；此处仍用 fallback 仅作兜底，但用 emit 让监听方与工具作用域一致
        const shouldEmit = !!(requested.projectPath || requested.projectId);
        applyProject(fallbackProject, shouldEmit);
      } finally {
        isLoading.value = false;
        loadProjectsInFlight = null;
      }
    })();

    return loadProjectsInFlight;
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
