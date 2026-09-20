import { ref, computed } from 'vue';

import { genModelV1Health } from '@/api/genModelV1Api';
import { recordRecentProject } from '@/composables/dashboardRecentProjects';
import { refreshToolStorePersistedScope } from '@/composables/useToolStore';
import { setCurrentProjectPath } from '@/lib/currentProject';

/** 无 URL 指定、后端也没答出工程名时的默认模型工程；与 gen-model `DbOption.toml` 的项目名对齐 */
export const DEFAULT_MODEL_PROJECT_PATH = 'AvevaMarineSample';

/**
 * 一个模型工程。gen-model 一个服务进程只服务一个 E3D 项目（`/api/v1/health` 的 `project`），
 * 所以清单里通常只有一项；`id` / `path` 都是项目名（PMS 登记的 `project_id` 也是它）。
 * 旧后端 `/api/projects` 的多工程清单 2026-09-20 随 legacy 退役。
 */
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

function readRequestedShowDbnum(): number | undefined {
  if (typeof window === 'undefined') return undefined;
  const showDbnum = new URLSearchParams(window.location.search).get('show_dbnum');
  if (!showDbnum) return undefined;
  const parsed = Number(showDbnum);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildRequestedOutputProject(): ModelProject | null {
  const requested = readRequestedProject();
  if (!requested.projectPath) return null;
  return {
    id: requested.projectPath,
    name: requested.projectPath,
    description: '',
    path: requested.projectPath,
    showDbnum: readRequestedShowDbnum(),
    default: false,
  };
}

function buildNamedProject(name: string, description = '', isDefault = false): ModelProject {
  return {
    id: name,
    name,
    description,
    path: name,
    thumbnail: '/favicon.ico',
    default: isDefault,
  };
}

function ensureProjectListed(project: ModelProject): void {
  if (!projects.value.some((item) => item.id === project.id || item.path === project.path)) {
    projects.value = [...projects.value, project];
  }
}

function syncProjectUrl(project: ModelProject): void {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  url.searchParams.set('output_project', project.path);

  // show_dbnum 仅在用户手动通过 URL 指定时生效，不从项目配置自动注入。
  // 模型按需加载（通过树导航 / refno 命令触发），无需预加载整个 dbnum。

  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

const initialRequestedProject = buildRequestedOutputProject();
const projects = ref<ModelProject[]>(initialRequestedProject ? [initialRequestedProject] : []);
const currentProject = ref<ModelProject | null>(initialRequestedProject);
const isLoading = ref(false);

if (initialRequestedProject) {
  setCurrentProjectPath(initialRequestedProject.path);
}

/** 模块级：并发 loadProjects（如首屏初始化与 App 嵌入引导）共用同一次 fetch，避免后一次空返回导致 switch 落空列表 */
let loadProjectsInFlight: Promise<void> | null = null;

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

  /** 加载工程清单：gen-model `/api/v1/health` 答出的那一个项目（`project` / `mdb`），没答就用默认工程。 */
  async function loadProjects() {
    if (loadProjectsInFlight) {
      return loadProjectsInFlight;
    }

    loadProjectsInFlight = (async () => {
      isLoading.value = true;
      try {
        const health = await genModelV1Health();
        const projectName = String(health.project || '').trim();
        const served = projectName
          ? [buildNamedProject(projectName, health.mdb ? `MDB ${health.mdb}` : '', true)]
          : [];
        projects.value = served;

        const requested = readRequestedProject();
        const matchedProject = projects.value.find((project) =>
          project.id === requested.projectId ||
          project.path === requested.projectPath ||
          (!!requested.projectId && project.path === requested.projectId),
        );
        if (matchedProject) {
          applyProject(matchedProject, false);
        } else if (requested.projectPath) {
          // 服务端答的不是 URL 指定的那个工程，但 URL 明确要它：照 URL 建一条并落为当前工程
          const autoProject = buildRequestedOutputProject() ?? buildNamedProject(requested.projectPath);
          ensureProjectListed(autoProject);
          applyProject(autoProject, false);
        } else if (served.length > 0) {
          // gen-model 只服务一个项目：不带参数就直接进它（PMS 的 project_id 不匹配也只能是它）
          applyProject(served[0]!, false);
        } else {
          const fallback = buildNamedProject(DEFAULT_MODEL_PROJECT_PATH, '', true);
          projects.value = [fallback];
          applyProject(fallback, false);
        }
      } catch (error) {
        console.error('Failed to load model project from gen-model /api/v1/health:', error);
        const requested = readRequestedProject();
        const requestedProject = buildRequestedOutputProject();
        if (requestedProject) {
          projects.value = [requestedProject];
          applyProject(requestedProject, true);
          return;
        }
        // 后端不可达：落到默认工程以防白屏
        const fallbackProject = buildNamedProject(DEFAULT_MODEL_PROJECT_PATH, '', true);
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
