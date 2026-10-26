#!/usr/bin/env node
/**
 * Plant3D-Web 离线部署包打包脚本
 *
 * 功能：
 *   1. 构建前端 (vite build)
 *   2. 下载 nginx Windows 稳定版
 *   3. 可选调用 ../gen-model/scripts/New-LocalRelease.ps1 打包 gen-model + plant-ui（默认开启）并整合到 backend/
 *   4. 整合前端构建产物 + nginx + bat 脚本
 *   5. 生成前后端（含 plant-ui）版本清单，并校验后端清单与最终包布局
 *   6. 打包成 zip（含 .sha256）放到 ../gen-model/releases/
 *
 * 使用：
 *   node scripts/build-offline-release.mjs                     # 默认：构建 plant3d-web + 执行 ../gen-model 打包发布（含 plant-ui）并合包
 *   node scripts/build-offline-release.mjs --with-gen-model    # 显式开启 ../gen-model 打包发布整合（默认已开启）
 *   node scripts/build-offline-release.mjs --reuse-gen-model   # 整合 ../gen-model，但复用 releases 下最新 ams-local-*.zip 不重新编译
 *   node scripts/build-offline-release.mjs --backend-package <ams-local.zip> # 指定现成后端包整合
 *   node scripts/build-offline-release.mjs --no-gen-model      # 不打包 ../gen-model（同 --frontend-only）
 *   node scripts/build-offline-release.mjs --frontend-only     # 仅打前端兼容包
 *   node scripts/build-offline-release.mjs --skip-build        # 跳过前后端构建，直接用现成产物打包
 *   node scripts/build-offline-release.mjs --skip-gen-model-smoke # 调用 ../gen-model 打包时跳过其冒烟门
 *   node scripts/build-offline-release.mjs --skip-nginx        # 跳过下载 nginx（已有的话）
 *   node scripts/build-offline-release.mjs --with-surreal      # 在 backend/bin 下附带 surreal.exe（默认不带：rocks 库由现场自己提供，启动时只查服务版本）
 *   node scripts/build-offline-release.mjs --force             # 允许覆盖同名输出
 *   node scripts/build-offline-release.mjs --allow-dirty       # 允许 dirty 后端出包（默认拒绝，仅联调用）
 */

import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import https from 'node:https';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertBackendNotDirty, rebuildBackendManifest, validateOfflinePackage } from './offline-release-manifest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');
const OFFLINE_SOURCE_DIR = join(PROJECT_DIR, 'deploy', 'offline');
const stagingIndex = process.argv.indexOf('--staging-dir');
if (stagingIndex >= 0 && (!process.argv[stagingIndex + 1] || process.argv[stagingIndex + 1].startsWith('--'))) {
  throw new Error('--staging-dir 需要提供一个空的暂存目录');
}
const OFFLINE_DIR = stagingIndex >= 0
  ? resolve(PROJECT_DIR, process.argv[stagingIndex + 1])
  : OFFLINE_SOURCE_DIR;
const DIST_DIR = join(PROJECT_DIR, 'dist');
const NGINX_DIR = join(OFFLINE_DIR, 'nginx');
const WWW_DIR = join(OFFLINE_DIR, 'www');
const BACKEND_DIR = join(OFFLINE_DIR, 'backend');
const GEN_MODEL_DIR = resolve(PROJECT_DIR, '..', 'gen-model');
const RELEASES_DIR = join(GEN_MODEL_DIR, 'releases');

// nginx Windows 稳定版下载地址
const NGINX_VERSION = '1.30.5';
const NGINX_DOWNLOAD_URL = `https://nginx.org/download/nginx-${NGINX_VERSION}.zip`;

// 解析命令行参数
const args = process.argv.slice(2);
const skipBuild = args.includes('--skip-build');
const skipNginx = args.includes('--skip-nginx');
const force = args.includes('--force');
const allowDirty = args.includes('--allow-dirty');
const releaseSuffixIndex = args.indexOf('--release-suffix');
const releaseSuffix = releaseSuffixIndex >= 0 ? args[releaseSuffixIndex + 1] : '';
if (releaseSuffixIndex >= 0 && (!releaseSuffix || !/^[a-zA-Z0-9_-]+$/.test(releaseSuffix))) {
  throw new Error('--release-suffix 需要仅包含字母、数字、下划线或连字符的标识');
}

// 是否将 ../gen-model（含 plant-ui）打包到一起：默认开启
const disableGenModel =
  args.includes('--frontend-only') ||
  args.includes('--no-gen-model') ||
  args.includes('--without-gen-model');
const enableGenModel =
  args.includes('--with-gen-model') ||
  args.includes('--include-gen-model');
if (disableGenModel && enableGenModel) {
  throw new Error('--with-gen-model 与 --no-gen-model/--frontend-only 互斥');
}
const includeGenModel = enableGenModel ? true : !disableGenModel;
const frontendOnly = !includeGenModel;

const backendPackageArg = args.find((arg) => arg.startsWith('--backend-package='));
const backendPackageIndex = args.indexOf('--backend-package');
const backendPackage = backendPackageArg
  ? resolve(PROJECT_DIR, backendPackageArg.slice('--backend-package='.length))
  : backendPackageIndex >= 0 && args[backendPackageIndex + 1]
    ? resolve(PROJECT_DIR, args[backendPackageIndex + 1])
    : null;
if (backendPackageIndex >= 0 && !backendPackage) {
  throw new Error('--backend-package 需要提供 zip 路径');
}

// 是否联动执行 ../gen-model/scripts/New-LocalRelease.ps1（含 plant-ui wasm 打包）：
// 在开启 gen-model 合包且未指定现成包/未传 --skip-build/--reuse-gen-model 时默认开启
const forceBuildGenModel =
  args.includes('--build-gen-model') ||
  args.includes('--build-backend');
const skipGenModelBuild =
  args.includes('--reuse-gen-model') ||
  args.includes('--no-build-gen-model') ||
  args.includes('--skip-gen-model-build') ||
  args.includes('--skip-backend-build');
if (forceBuildGenModel && skipGenModelBuild) {
  throw new Error('--build-gen-model 与 --reuse-gen-model/--no-build-gen-model 互斥');
}
const shouldBuildGenModel =
  includeGenModel &&
  (forceBuildGenModel || (!skipBuild && !skipGenModelBuild && !backendPackage));
const skipGenModelSmoke =
  args.includes('--skip-gen-model-smoke') ||
  args.includes('--skip-backend-smoke');
// 默认不随包附带 SurrealDB 二进制：rocksdb 档指向的库由现场自己运行，
// start.bat → Start-BundledStore.ps1 只对其做 /version 版本检查。
const includeSurreal = args.includes('--with-surreal');

function log(msg) {
  console.log(`[offline-release] ${msg}`);
}

function logError(msg) {
  console.error(`[offline-release] ❌ ${msg}`);
}

function logSuccess(msg) {
  console.log(`[offline-release] ✅ ${msg}`);
}

/** 递归复制目录 */
function copyDir(src, dest) {
  if (!existsSync(src)) {
    throw new Error(`源目录不存在: ${src}`);
  }
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function normalizeWindowsScripts(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      normalizeWindowsScripts(path);
    } else if (name.toLowerCase().endsWith('.ps1')) {
      const content = readFileSync(path, 'utf-8').replace(/^\uFEFF/, '');
      if (/::new\s*\(/i.test(content)) {
        throw new Error(`运行脚本包含 PowerShell 5 构造语法，不兼容 Server 2012 R2: ${path}`);
      }
      writeFileSync(path, '\uFEFF' + content.replace(/\r?\n/g, '\r\n'));
    } else if (/\.(bat|cmd)$/i.test(name)) {
      const content = readFileSync(path, 'utf-8').replace(/^\uFEFF/, '');
      writeFileSync(path, content.replace(/\r?\n/g, '\r\n'));
    }
  }
}

/** 递归删除目录 */
function removeDir(dir) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 下载文件 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    log(`下载: ${url}`);
    log(`  → ${destPath}`);
    const file = createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // 跟随重定向
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`下载失败: HTTP ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/** 使用 Windows 自带 bsdtar 解压 zip，避免依赖 PowerShell Archive 模块。 */
function extractZip(zipPath, destDir) {
  log(`解压: ${zipPath}`);
  mkdirSync(destDir, { recursive: true });
  execFileSync('tar.exe', ['-xf', zipPath, '-C', destDir], { stdio: 'inherit' });
}

/** 使用 Windows 自带 bsdtar 打包 zip。 */
function createZip(srcDir, zipPath) {
  log(`打包: ${srcDir}`);
  log(`  → ${zipPath}`);
  mkdirSync(dirname(zipPath), { recursive: true });
  if (existsSync(zipPath)) {
    if (!force) throw new Error(`输出文件已存在，拒绝覆盖: ${zipPath}（确需覆盖请加 --force）`);
    rmSync(zipPath);
  }
  execFileSync('tar.exe', ['-a', '-cf', zipPath, '-C', srcDir, '.'], { stdio: 'inherit' });
}

/** 流式算文件 sha256：发布 zip 一百多 MB，不整读进内存。 */
function sha256File(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolvePromise(hash.digest('hex')));
  });
}

function findLatestBackendPackage() {
  if (!existsSync(RELEASES_DIR)) return null;
  const candidates = readdirSync(RELEASES_DIR)
    .filter((name) => /^ams-local-.*\.zip$/i.test(name))
    .map((name) => join(RELEASES_DIR, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  return candidates[0] ?? null;
}

/** 调用 ../gen-model/scripts/New-LocalRelease.ps1 构建并产出包含 plant-ui 的 ams-local-*.zip */
function buildGenModelRelease() {
  const releaseScript = join(GEN_MODEL_DIR, 'scripts', 'New-LocalRelease.ps1');
  if (!existsSync(releaseScript)) {
    throw new Error(`找不到 gen-model 发布脚本: ${releaseScript}`);
  }
  if (!allowDirty) {
    // gen-model 工作区 dirty 时 New-LocalRelease.ps1 会把包标成 dirty，整合完才被拒就白跑十几分钟；
    // 这里提前到构建之前就拒（同一口径：只看已跟踪文件）。读不到 git 状态就交给后面按清单再判。
    let genModelStatus = null;
    try {
      genModelStatus = execSync('git status --porcelain --untracked-files=no', {
        cwd: GEN_MODEL_DIR,
        encoding: 'utf-8',
      }).trim();
    } catch {
      // ignore
    }
    if (genModelStatus) {
      throw new Error(
        `../gen-model 工作区有未提交改动，构建出来的后端包会是 dirty，拒绝出包；先提交/清理，或显式加 --allow-dirty:\n${genModelStatus}`,
      );
    }
  }
  log('正在执行 ../gen-model 打包发布（含 plant-ui Web/WASM 构建）...');
  const psArgs = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    releaseScript,
    '-Force',
  ];
  if (skipGenModelSmoke) {
    psArgs.push('-SkipSmoke');
  }
  const childEnv = { ...process.env };
  delete childEnv.PSModulePath;
  execFileSync('powershell.exe', psArgs, {
    cwd: GEN_MODEL_DIR,
    env: childEnv,
    stdio: 'inherit',
  });
  const latest = findLatestBackendPackage();
  if (!latest) {
    throw new Error(`gen-model 打包完成后未在 ${RELEASES_DIR} 找到 ams-local-*.zip`);
  }
  logSuccess(`gen-model + plant-ui 发布包已生成: ${latest}`);
  return latest;
}

function prepareBackend(packagePath) {
  if (!existsSync(packagePath)) {
    throw new Error(`后端发布包不存在: ${packagePath}`);
  }
  const tmpDir = join(PROJECT_DIR, '.tmp-backend-release');
  removeDir(tmpDir);
  removeDir(BACKEND_DIR);
  extractZip(packagePath, tmpDir);

  const entries = readdirSync(tmpDir);
  const packageRoot = entries.length === 1 && statSync(join(tmpDir, entries[0])).isDirectory()
    ? join(tmpDir, entries[0])
    : tmpDir;
  const requiredPaths = [
    'aios-database.exe',
    'Start-AMS.ps1',
    'DbOption.toml',
    'release.json',
    join('resource', 'surreal'),
    'schema',
    join('web', 'index.html'),
    join('web', 'pkg', 'rs-plant_bg.wasm'),
  ];
  for (const required of requiredPaths) {
    if (!existsSync(join(packageRoot, required))) {
      throw new Error(`后端发布包缺少 ${required}: ${packagePath}`);
    }
  }
  // dirty 后端在整合之前就拒（复用现成包 / --backend-package 也走这里），别等覆盖、重建清单都做完才说不要。
  const sourceManifest = JSON.parse(readFileSync(join(packageRoot, 'release.json'), 'utf-8'));
  assertBackendNotDirty(
    {
      dirty: sourceManifest.backend_git_dirty ?? null,
      buildId: sourceManifest.backend_build_id ?? null,
      commit: sourceManifest.backend_git_commit ?? null,
    },
    allowDirty,
  );

  copyDir(packageRoot, BACKEND_DIR);
  // plant-ui Web 层叠加：后端真正服务的永远是 backend/web 磁盘副本（handler 磁盘优先，
  // exe 内嵌只是兜底），所以这里把当前 ../plant-ui/web/public 盖进包内 web/——
  // plant-ui 的修复不需要重编冻结的后端 exe 就能进包。assets/config 与 assets/meshes
  // 是现场项目数据不是 Web 构建产物，跳过（ron 由 Sync-OfflineConfig 在现场生成）。
  const plantUiWebDir = resolve(PROJECT_DIR, '..', 'plant-ui', 'web', 'public');
  let plantUiOverlayApplied = false;
  if (existsSync(plantUiWebDir)) {
    const webTarget = join(BACKEND_DIR, 'web');
    const skipDirs = new Set(['config', 'meshes']);
    const overlay = (srcDir, relDir) => {
      for (const name of readdirSync(srcDir)) {
        const srcPath = join(srcDir, name);
        if (statSync(srcPath).isDirectory()) {
          if (relDir === 'assets' && skipDirs.has(name.toLowerCase())) continue;
          overlay(srcPath, relDir ? join(relDir, name) : name);
        } else {
          const destPath = join(webTarget, relDir, name);
          mkdirSync(dirname(destPath), { recursive: true });
          copyFileSync(srcPath, destPath);
        }
      }
    };
    overlay(plantUiWebDir, '');
    plantUiOverlayApplied = true;
    log('已用 ../plant-ui/web/public 覆盖 backend/web（assets/config、assets/meshes 除外）');
  }
  // web/assets/config 里的 ron 是现场项目数据不是构建产物：它到不了浏览器（/assets/*
  // 由 asset_root 服务），留在包里只会误导运维改错文件——真正的接入点由
  // Sync-OfflineConfig 在现场生成到 backend/assets/config/。
  const staleLegacyConfig = join(BACKEND_DIR, 'web', 'assets', 'config');
  if (existsSync(staleLegacyConfig)) {
    rmSync(staleLegacyConfig, { recursive: true, force: true });
    log('已剔除 backend/web/assets/config（现场配置目录，不应随包分发）');
  }
  if (!includeSurreal) {
    // 默认不带 SurrealDB 二进制：包内 Start-BundledStore.ps1 只对目标服务做版本检查；
    // 需要打包时用 --with-surreal 加回。
    const bundledSurreal = join(BACKEND_DIR, 'bin', 'surreal.exe');
    if (existsSync(bundledSurreal)) {
      rmSync(bundledSurreal);
      const binDir = join(BACKEND_DIR, 'bin');
      if (existsSync(binDir) && readdirSync(binDir).length === 0) {
        rmSync(binDir, { recursive: true, force: true });
      }
    }
  }
  const configPath = join(BACKEND_DIR, 'DbOption.toml');
  let config = readFileSync(configPath, 'utf-8')
    .replace(/^server_release_ip\s*=.*$/m, 'server_release_ip = "0.0.0.0:8022"')
    .replace(/^http_api_addr\s*=.*$/m, 'http_api_addr = "0.0.0.0:8022"')
    .replace(/^store_mode\s*=.*\r?\n?/gm, '')
    .replace(/^frontend_(?:compat_)?port\s*=.*\r?\n?/gm, '') + '\nfrontend_port = 80\nfrontend_compat_port = 3100\n';
  // 离线包出厂介质走配置文件层：store_mode = "rocksdb"（external，默认）。
  // 向导第②步改选 memory 时重写这一行；deploy.env 的 STORE_MODE 仍可作运维 pin 覆盖。
  config += 'store_mode = "rocksdb"\n';
  writeFileSync(configPath, config);

  const startAmsPath = join(BACKEND_DIR, 'Start-AMS.ps1');
  const startAmsContent = readFileSync(startAmsPath, 'utf-8');
  if (!startAmsContent.includes('Remove-Item Env:AIOS_ROOM_MEMBERSHIP')) {
    const schemaLine = '$env:AIOS_E3D_SCHEMA_ROOT = Join-Path $root \'schema\'';
    const patchedStartAms = startAmsContent.replace(
      schemaLine,
      [
        schemaLine,
        '    Remove-Item Env:AIOS_ROOM_MEMBERSHIP -ErrorAction SilentlyContinue',
        '    Remove-Item Env:AIOS_SKIP_STARTUP_ROOM_BUILD -ErrorAction SilentlyContinue',
      ].join('\r\n'),
    );
    writeFileSync(startAmsPath, patchedStartAms);
  }

  normalizeWindowsScripts(BACKEND_DIR);
  // 整合阶段删了 web/assets/config、可能删了 bin/surreal.exe，也覆盖过 web/ 与脚本；
  // 清单必须按最终磁盘内容重建并自检，否则现场按 release.json 验包会报缺文件。
  const manifestResult = rebuildBackendManifest(BACKEND_DIR, {
    plantUiOverlayApplied,
    includeSurreal,
  });
  if (manifestResult.removed.length) {
    log(
      `release.json 清单已剔除 ${manifestResult.removed.length} 个不存在/已替换的文件: ${manifestResult.removed.join(', ')}`,
    );
  }
  if (manifestResult.added.length) {
    log(`release.json 清单已补入 ${manifestResult.added.length} 个新增 web 文件`);
  }
  log(`release.json 清单自检通过: ${manifestResult.fileCount} 个文件`);

  removeDir(tmpDir);
  logSuccess(`后端发布包（含 gen-model + plant-ui）已整合: ${packagePath}`);
}

function readBackendVersion() {
  const manifestPath = join(BACKEND_DIR, 'release.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  return {
    packageName: manifest.name ?? null,
    version: manifest.backend_version ?? null,
    buildId: manifest.backend_build_id ?? null,
    commit: manifest.backend_git_commit ?? null,
    dirty: manifest.backend_git_dirty ?? null,
    plantUiVersion: manifest.plant_ui_version ?? null,
    webSource: manifest.web_source ?? null,
  };
}

/** 获取版本信息 */
function getVersionInfo() {
  const pkg = JSON.parse(readFileSync(join(PROJECT_DIR, 'package.json'), 'utf-8'));
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
  } catch {
    // ignore
  }
  // 与 gen-model New-LocalRelease.ps1 同口径：只看已跟踪文件，根目录的未跟踪杂物不算 dirty。
  let dirty = null;
  try {
    dirty = execSync('git status --porcelain --untracked-files=no', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim().length > 0;
  } catch {
    // ignore
  }
  const now = new Date();
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return {
    version: pkg.version,
    commit,
    dirty,
    buildDate: beijingTime.toISOString(),
  };
}

/** 生成 version.json */
function writeVersionJson(versionInfo) {
  const versionJson = {
    version: versionInfo.version,
    commit: versionInfo.commit,
    dirty: versionInfo.dirty,
    buildDate: versionInfo.buildDate,
  };
  // 写入 www 目录
  writeFileSync(join(WWW_DIR, 'version.json'), JSON.stringify(versionJson, null, 2) + '\n');
  // 写入 dist 目录（构建产物也需要）
  if (existsSync(DIST_DIR)) {
    writeFileSync(join(DIST_DIR, 'version.json'), JSON.stringify(versionJson, null, 2) + '\n');
  }
  logSuccess(`version.json 已生成: v${versionInfo.version}`);
}

/** 主流程 */
async function main() {
  console.log('==========================================');
  console.log('  Plant3D-Web 离线部署包打包工具');
  console.log('==========================================');
  console.log('');

  if (OFFLINE_DIR !== OFFLINE_SOURCE_DIR) {
    if (existsSync(OFFLINE_DIR) && readdirSync(OFFLINE_DIR).length > 0) {
      throw new Error(`暂存目录非空，拒绝覆盖: ${OFFLINE_DIR}`);
    }
    mkdirSync(OFFLINE_DIR, { recursive: true });
    for (const name of ['README.md', 'start.bat', 'stop.bat', 'config.bat', 'Sync-OfflineConfig.ps1', 'Test-OfflineHttp.ps1', 'Start-BundledStore.ps1', 'nginx.conf.template']) {
      copyFileSync(join(OFFLINE_SOURCE_DIR, name), join(OFFLINE_DIR, name));
    }
    if (existsSync(join(OFFLINE_SOURCE_DIR, 'nginx', 'nginx.exe'))) {
      mkdirSync(join(NGINX_DIR, 'conf'), { recursive: true });
      copyFileSync(join(OFFLINE_SOURCE_DIR, 'nginx', 'nginx.exe'), join(NGINX_DIR, 'nginx.exe'));
      copyFileSync(join(OFFLINE_SOURCE_DIR, 'nginx', 'conf', 'mime.types'), join(NGINX_DIR, 'conf', 'mime.types'));
      copyFileSync(join(OFFLINE_SOURCE_DIR, 'nginx.conf.template'), join(NGINX_DIR, 'conf', 'nginx.conf'));
      mkdirSync(join(NGINX_DIR, 'logs'), { recursive: true });
      mkdirSync(join(NGINX_DIR, 'temp'), { recursive: true });
    }
    log(`独立暂存目录: ${OFFLINE_DIR}`);
  }

  const versionInfo = getVersionInfo();
  log(`版本: v${versionInfo.version}`);
  log(`Commit: ${versionInfo.commit.slice(0, 7)}`);
  if (versionInfo.dirty) {
    log('警告: 前端工作区有未提交改动，release.json 会记录 frontend.dirty=true');
  }
  log(`合包 ../gen-model（含 plant-ui）: ${includeGenModel ? '开启（默认）' : '关闭'}`);
  if (includeGenModel) {
    log(`联动构建 ../gen-model 发布包: ${shouldBuildGenModel ? '开启（默认）' : '复用现有发布包'}`);
  }
  log('');

  // Step 1: 构建前端
  if (!skipBuild) {
    log('Step 1/6: 构建前端...');
    execSync('npm run build', { cwd: PROJECT_DIR, stdio: 'inherit' });
    logSuccess('前端构建完成');
  } else {
    log('Step 1/6: 跳过前端构建 (--skip-build)');
    if (!existsSync(DIST_DIR)) {
      logError('dist 目录不存在，请先构建或去掉 --skip-build 参数');
      process.exit(1);
    }
  }
  console.log('');

  // Step 2: 准备 nginx
  if (!skipNginx) {
    log('Step 2/6: 准备 nginx Windows 版...');
    const nginxExe = join(NGINX_DIR, 'nginx.exe');
    if (existsSync(nginxExe)) {
      log('nginx.exe 已存在，跳过下载');
    } else {
      // 下载 nginx
      const tmpDir = join(PROJECT_DIR, '.tmp-nginx-download');
      mkdirSync(tmpDir, { recursive: true });
      const zipPath = join(tmpDir, `nginx-${NGINX_VERSION}.zip`);
      
      try {
        await downloadFile(NGINX_DOWNLOAD_URL, zipPath);
        
        // 解压
        const extractDir = join(tmpDir, 'extracted');
        extractZip(zipPath, extractDir);
        
        // 复制 nginx 文件到 offline 目录（只复制需要的文件，减小包体积）
        // nginx zip 解压后是一个 nginx-1.30.5 目录
        const nginxExtracted = join(extractDir, `nginx-${NGINX_VERSION}`);
        
        // 确保目标目录存在
        mkdirSync(NGINX_DIR, { recursive: true });
        
        // 只复制 nginx.exe
        copyFileSync(join(nginxExtracted, 'nginx.exe'), join(NGINX_DIR, 'nginx.exe'));
        
        // 复制 conf 目录：mime.types 从官方包复制，nginx.conf 使用我们的模板
        const confSrc = join(nginxExtracted, 'conf');
        const confDest = join(NGINX_DIR, 'conf');
        mkdirSync(confDest, { recursive: true });
        copyFileSync(join(confSrc, 'mime.types'), join(confDest, 'mime.types'));
        
        // 复制我们的 nginx.conf 模板
        const nginxConfTemplate = join(OFFLINE_DIR, 'nginx.conf.template');
        if (existsSync(nginxConfTemplate)) {
          copyFileSync(nginxConfTemplate, join(confDest, 'nginx.conf'));
        } else {
          logError(`找不到 nginx.conf 模板: ${nginxConfTemplate}`);
          process.exit(1);
        }
        
        // 创建空的 logs 和 temp 目录
        mkdirSync(join(NGINX_DIR, 'logs'), { recursive: true });
        mkdirSync(join(NGINX_DIR, 'temp'), { recursive: true });
        
        // 清理临时文件
        removeDir(tmpDir);
        
        logSuccess(`nginx ${NGINX_VERSION} 已下载并解压（精简版）`);
      } catch (err) {
        logError(`nginx 下载失败: ${err.message}`);
        logError('请手动下载 nginx for Windows:');
        logError(`  ${NGINX_DOWNLOAD_URL}`);
        logError(`解压到: ${NGINX_DIR}`);
        process.exit(1);
      }
    }
  } else {
    log('Step 2/6: 跳过 nginx 准备 (--skip-nginx)');
    if (!existsSync(join(NGINX_DIR, 'nginx.exe'))) {
      logError('nginx.exe 不存在，请先准备或去掉 --skip-nginx 参数');
      process.exit(1);
    }
  }
  
  // 确保 nginx.conf 存在（从模板复制）
  const nginxConfDest = join(NGINX_DIR, 'conf', 'nginx.conf');
  const nginxConfTemplate = join(OFFLINE_DIR, 'nginx.conf.template');
  if (!existsSync(nginxConfDest)) {
    if (existsSync(nginxConfTemplate)) {
      mkdirSync(join(NGINX_DIR, 'conf'), { recursive: true });
      copyFileSync(nginxConfTemplate, nginxConfDest);
      log('已从模板复制 nginx.conf');
    } else {
      logError(`找不到 nginx.conf 模板: ${nginxConfTemplate}`);
      process.exit(1);
    }
  }
  console.log('');

  // Step 3: 准备后端（含 gen-model + plant-ui）
  log('Step 3/6: 准备 ../gen-model 发布包（含 plant-ui）...');
  let backendVersion = null;
  if (frontendOnly) {
    removeDir(BACKEND_DIR);
    log('已跳过 ../gen-model 打包整合 (--no-gen-model / --frontend-only)');
  } else {
    const selectedBackendPackage = shouldBuildGenModel
      ? buildGenModelRelease()
      : (backendPackage ?? findLatestBackendPackage());
    if (!selectedBackendPackage) {
      throw new Error(`未找到后端发布包。请去掉 --reuse-gen-model 自动打包，或使用 --backend-package <zip> 指定 ${RELEASES_DIR} 下的 ams-local-*.zip`);
    }
    prepareBackend(selectedBackendPackage);
    backendVersion = readBackendVersion();
  }
  console.log('');

  // Step 4: 复制前端构建产物到 www
  log('Step 4/6: 复制前端构建产物...');
  removeDir(WWW_DIR);
  copyDir(DIST_DIR, WWW_DIR);
  logSuccess(`前端文件已复制到: ${WWW_DIR}`);
  console.log('');

  // Step 5: 生成 version.json
  log('Step 5/6: 生成版本信息...');
  writeVersionJson(versionInfo);
  const plantUiInfo = backendVersion?.plantUiVersion
    ? {
      version: backendVersion.plantUiVersion,
      source: backendVersion.webSource ?? 'bundled-in-gen-model',
      webRoot: 'backend/web',
    }
    : null;
  writeFileSync(join(OFFLINE_DIR, 'release.json'), JSON.stringify({
    frontend: versionInfo,
    backend: backendVersion,
    plantUi: plantUiInfo,
    genModelIncluded: includeGenModel,
    mode: frontendOnly ? 'frontend-only' : 'integrated',
  }, null, 2) + '\n');
  console.log('');

  log('Step 5.5/6: 校验最终包布局与版本一致性...');
  const packageProblems = validateOfflinePackage(OFFLINE_DIR, {
    includeGenModel,
    includeSurreal,
  });
  if (packageProblems.length) {
    throw new Error(`最终包布局自检失败: ${packageProblems.join('; ')}`);
  }
  logSuccess('最终包布局自检通过');

  // Step 6: 打包成 zip
  log('Step 6/6: 打包成 zip...');
  const dateStr = versionInfo.buildDate.slice(0, 10).replace(/-/g, '');
  const backendSuffix = backendVersion?.version ? `-backend-v${backendVersion.version}` : '';
  const zipName = `plant3d-web-offline-v${versionInfo.version}${backendSuffix}-${dateStr}${releaseSuffix ? `-${releaseSuffix}` : ''}.zip`;
  const zipPath = join(RELEASES_DIR, zipName);
  
  normalizeWindowsScripts(OFFLINE_DIR);
  createZip(OFFLINE_DIR, zipPath);
  // GNU `sha256sum -c` 格式（两个空格、LF 结尾），Windows 上 `Get-FileHash` 比对也不在乎换行。
  const zipSha256 = await sha256File(zipPath);
  writeFileSync(`${zipPath}.sha256`, `${zipSha256}  ${zipName}\n`, 'ascii');

  // 计算文件大小
  const stat = statSync(zipPath);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
  
  console.log('');
  console.log('==========================================');
  console.log('  打包完成！');
  console.log('==========================================');
  console.log('');
  console.log(`  前端 (plant3d-web): v${versionInfo.version} (${versionInfo.commit.slice(0, 7)})`);
  if (backendVersion) {
    console.log(`  后端 (gen-model):   v${backendVersion.version} (${backendVersion.buildId ?? 'unknown'})`);
    console.log(`  内嵌 (plant-ui):    v${backendVersion.plantUiVersion ?? 'unknown'} (${backendVersion.webSource ?? 'backend/web'})`);
  } else {
    console.log('  后端 (gen-model):   未包含 (frontend-only)');
  }
  console.log(`  构建时间: ${versionInfo.buildDate}`);
  console.log(`  输出文件: ${zipPath}`);
  console.log(`  文件大小: ${sizeMB} MB`);
  console.log(`  sha256:   ${zipSha256}`);
  console.log('');
  console.log('  发包位置: ../gen-model/releases/');
  console.log('');
  console.log('  部署说明:');
  console.log('    1. 将 zip 解压到目标机器');
  console.log('    2. 运行 start.bat 启动服务');
  console.log('    3. 在 setup 页面统一配置项目路径和前后端端口（外部后端模式用 config.bat）');
  console.log('');
}

main().catch((err) => {
  logError(err.message);
  console.error(err.stack);
  process.exit(1);
});
