/**
 * files/output 路径构造工具
 *
 * 约定：
 * - 未指定 output_project：使用 `/files/output/<rel>`（兼容旧目录结构）
 * - 指定 output_project：使用 `/files/output/<project>/<rel>`（多项目并存）
 */

let currentProjectPath: string | null = null;

export function setCurrentProjectPath(path: string | null) {
  currentProjectPath = path;
}

export function getOutputProjectFromUrl(): string | null {
  if (currentProjectPath) return currentProjectPath;
  
  if (typeof window === 'undefined') return null;
  try {
    const q = new URLSearchParams(window.location.search);
    const raw = q.get('output_project');
    const s = raw ? String(raw).trim() : '';
    return s ? s : null;
  } catch {
    return null;
  }
}

export function buildFilesOutputUrl(relPath: string): string {
  const rel = String(relPath || '').replace(/^\/+/, '');
  const project = getOutputProjectFromUrl();
  if (!project) return `/files/output/${rel}`;
  return `/files/output/${encodeURIComponent(project)}/${rel}`;
}


