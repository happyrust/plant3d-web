/**
 * 离线包清单重建与最终包布局自检。
 *
 * gen-model 的 New-LocalRelease.ps1 按打包时的暂存目录生成 files 清单；plant3d-web
 * 整合阶段还会覆盖 web/、剔除 web/assets/config 与 bin/surreal.exe、重写 DbOption.toml
 * 和启动脚本。rebuildBackendManifest 按最终磁盘内容重建 web 清单、重算被改写文件的
 * 哈希，并在写回前逐个校验；validateOfflinePackage 在打 zip 前检查最终包的关键文件、
 * 版本一致性与清单存在性，避免再发出「清单列了包里没有的文件」或版本对不上的包。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function normalizePath(value) {
  return String(value).replace(/\\/g, '/');
}

function resolveEntry(backendDir, entryPath) {
  return join(backendDir, normalizePath(entryPath));
}

function listFiles(dir, relDir = '', out = []) {
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    const relPath = relDir ? `${relDir}/${name}` : name;
    if (statSync(fullPath).isDirectory()) {
      listFiles(fullPath, relPath, out);
    } else {
      out.push(relPath);
    }
  }
  return out;
}

function hashEntry(backendDir, relPath) {
  const content = readFileSync(resolveEntry(backendDir, relPath));
  return {
    path: normalizePath(relPath),
    sha256: createHash('sha256').update(content).digest('hex'),
    bytes: content.length,
  };
}

/**
 * 重建并校验 backend/release.json。
 *
 * @param {string} backendDir 整合后的 backend 目录
 * @param {{ plantUiOverlayApplied?: boolean, includeSurreal?: boolean }} options
 * @returns {{ manifestPath: string, fileCount: number, webCount: number, removed: string[], added: string[] }}
 */
export function rebuildBackendManifest(backendDir, options = {}) {
  const { plantUiOverlayApplied = false, includeSurreal = true } = options;
  const manifestPath = join(backendDir, 'release.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`找不到后端清单: ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  if (!Array.isArray(manifest.files)) {
    throw new Error('后端 release.json 缺少 files 清单');
  }
  // gen-model 的清单用反斜杠，下面重建的 web 条目用正斜杠；统一成正斜杠，一份清单里不混用两种分隔符。
  for (const entry of manifest.files) {
    entry.path = normalizePath(entry.path);
  }

  // bin/surreal.exe 默认不随包；与前面删除文件保持一致。
  if (!includeSurreal) {
    manifest.files = manifest.files.filter(
      (entry) => !/^bin\/surreal\.exe$/i.test(normalizePath(entry.path)),
    );
  }

  // web/ 是整合阶段改动最大的一层：plant-ui 覆盖、assets/config 剔除。按最终磁盘内容重建。
  const webDir = join(backendDir, 'web');
  if (!existsSync(webDir)) {
    throw new Error(`找不到后端 web 目录: ${webDir}`);
  }
  const oldWebPaths = new Set(
    manifest.files
      .map((entry) => normalizePath(entry.path))
      .filter((entryPath) => entryPath.toLowerCase().startsWith('web/')),
  );
  const webEntries = [];
  for (const relPath of listFiles(webDir)) {
    const normalized = `web/${normalizePath(relPath)}`;
    // assets/config 是现场接入点、assets/meshes 是现场数据，都不随包分发。
    if (/^web\/assets\/(?:config|meshes)\//i.test(normalized)) continue;
    webEntries.push(hashEntry(backendDir, normalized));
  }
  const newWebPaths = new Set(webEntries.map((entry) => entry.path));
  const removed = [...oldWebPaths].filter((entryPath) => !newWebPaths.has(entryPath));
  const added = [...newWebPaths].filter((entryPath) => !oldWebPaths.has(entryPath));
  manifest.files = [
    ...manifest.files.filter(
      (entry) => !normalizePath(entry.path).toLowerCase().startsWith('web/'),
    ),
    ...webEntries,
  ];

  // 整合阶段改写过脚本换行/BOM 和 DbOption.toml，重算这些条目的哈希。
  for (const entry of manifest.files) {
    const normalized = normalizePath(entry.path);
    if (!/\.(ps1|bat|cmd)$/i.test(normalized) && normalized !== 'DbOption.toml') continue;
    const content = readFileSync(resolveEntry(backendDir, normalized));
    entry.sha256 = createHash('sha256').update(content).digest('hex');
    entry.bytes = content.length;
  }

  // 写回前自检：清单里每个文件都必须存在，且 sha256/bytes 与磁盘一致。
  const problems = [];
  for (const entry of manifest.files) {
    const target = resolveEntry(backendDir, entry.path);
    if (!existsSync(target)) {
      problems.push(`${entry.path}: missing`);
      continue;
    }
    const content = readFileSync(target);
    if (
      entry.sha256 !== createHash('sha256').update(content).digest('hex') ||
      entry.bytes !== content.length
    ) {
      problems.push(`${entry.path}: sha256/bytes mismatch`);
    }
  }
  if (problems.length) {
    throw new Error(`后端 release.json 清单自检失败: ${problems.join('; ')}`);
  }

  if (
    plantUiOverlayApplied &&
    manifest.web_source &&
    !manifest.web_source.includes('+plant-ui-web-public-overlay')
  ) {
    manifest.web_source = `${manifest.web_source}+plant-ui-web-public-overlay`;
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return {
    manifestPath,
    fileCount: manifest.files.length,
    webCount: webEntries.length,
    removed,
    added,
  };
}

/**
 * 默认拒绝 dirty 后端出包；联调确需如此时显式传 --allow-dirty。
 *
 * @param {{ dirty?: boolean | null, buildId?: string | null, commit?: string | null } | null} backendVersion
 * @param {boolean} allowDirty
 */
export function assertBackendNotDirty(backendVersion, allowDirty = false) {
  if (!backendVersion?.dirty || allowDirty) return;
  throw new Error(
    `后端发布包是 dirty 构建（build_id=${backendVersion.buildId ?? 'unknown'}，commit=${backendVersion.commit ?? 'unknown'}），拒绝出包；先提交/清理 gen-model 工作区重建，或显式加 --allow-dirty。`,
  );
}

const BASE_REQUIRED_FILES = [
  'README.md',
  'release.json',
  'start.bat',
  'stop.bat',
  'config.bat',
  'Sync-OfflineConfig.ps1',
  'Start-BundledStore.ps1',
  'Test-OfflineHttp.ps1',
  'nginx.conf.template',
  'nginx/nginx.exe',
  'nginx/conf/nginx.conf',
  'nginx/conf/mime.types',
  'www/index.html',
  'www/version.json',
];

const BACKEND_REQUIRED_FILES = [
  'backend/.first-run-pending',
  'backend/aios-database.exe',
  'backend/Start-AMS.ps1',
  'backend/DbOption.toml',
  'backend/release.json',
  'backend/resource/surreal',
  'backend/schema',
  'backend/web/index.html',
  'backend/web/setup.html',
  'backend/web/pkg/rs-plant_bg.wasm',
];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 校验最终离线包的关键文件、backend/release.json 清单存在性与版本一致性。
 *
 * @param {string} packageDir 最终包根目录
 * @param {{ includeGenModel?: boolean, includeSurreal?: boolean }} options
 * @returns {string[]} 问题列表；空数组表示通过
 */
export function validateOfflinePackage(packageDir, options = {}) {
  const { includeGenModel = true, includeSurreal = false } = options;
  const problems = [];
  const requirePath = (relPath) => {
    if (!existsSync(join(packageDir, relPath))) problems.push(`${relPath}: missing`);
  };

  for (const relPath of BASE_REQUIRED_FILES) requirePath(relPath);
  if (includeGenModel) {
    for (const relPath of BACKEND_REQUIRED_FILES) requirePath(relPath);
    if (existsSync(join(packageDir, 'backend/web/assets/config'))) {
      problems.push('backend/web/assets/config: should not be packaged');
    }
    if (existsSync(join(packageDir, 'backend/web/assets/meshes'))) {
      problems.push('backend/web/assets/meshes: should not be packaged');
    }
    if (!includeSurreal && existsSync(join(packageDir, 'backend/bin/surreal.exe'))) {
      problems.push('backend/bin/surreal.exe: should not be packaged');
    }
  }

  const root = readJson(join(packageDir, 'release.json'));
  const www = readJson(join(packageDir, 'www/version.json'));
  if (!root) problems.push('release.json: invalid JSON');
  if (!www) problems.push('www/version.json: invalid JSON');
  if (root && www) {
    if (root.frontend?.version !== www.version) {
      problems.push(
        `frontend version mismatch: release.json=${root.frontend?.version} www/version.json=${www.version}`,
      );
    }
    if (root.frontend?.commit !== www.commit) {
      problems.push(
        `frontend commit mismatch: release.json=${root.frontend?.commit} www/version.json=${www.commit}`,
      );
    }
  }

  const expectedMode = includeGenModel ? 'integrated' : 'frontend-only';
  if (root) {
    if (root.mode !== expectedMode) {
      problems.push(`release.json mode=${root.mode} expected=${expectedMode}`);
    }
    if (root.genModelIncluded !== includeGenModel) {
      problems.push(
        `release.json genModelIncluded=${root.genModelIncluded} expected=${includeGenModel}`,
      );
    }
  }

  if (includeGenModel) {
    const backend = readJson(join(packageDir, 'backend/release.json'));
    if (!backend) {
      problems.push('backend/release.json: invalid JSON');
    } else {
      if (root && root.backend?.version !== backend.backend_version) {
        problems.push(
          `backend version mismatch: release.json=${root.backend?.version} backend/release.json=${backend.backend_version}`,
        );
      }
      if (root && root.backend?.commit !== backend.backend_git_commit) {
        problems.push(
          `backend commit mismatch: release.json=${root.backend?.commit} backend/release.json=${backend.backend_git_commit}`,
        );
      }
      if (root && root.backend?.buildId !== backend.backend_build_id) {
        problems.push(
          `backend buildId mismatch: release.json=${root.backend?.buildId} backend/release.json=${backend.backend_build_id}`,
        );
      }
      if (backend.plant_ui_version && root?.plantUi?.version !== backend.plant_ui_version) {
        problems.push(
          `plant-ui version mismatch: release.json=${root?.plantUi?.version} backend/release.json=${backend.plant_ui_version}`,
        );
      }
      for (const entry of Array.isArray(backend.files) ? backend.files : []) {
        const relPath = `backend/${normalizePath(entry.path)}`;
        if (!existsSync(join(packageDir, relPath))) {
          problems.push(`${relPath}: listed in backend/release.json but missing`);
        }
      }
    }
  }

  return problems;
}
