#!/usr/bin/env node
/**
 * Plant3D-Web 离线部署包打包脚本
 *
 * 功能：
 *   1. 构建前端 (vite build)
 *   2. 下载 nginx Windows 稳定版
 *   3. 整合 gen-model 官方 Windows 发布包
 *   4. 整合前端构建产物 + nginx + bat 脚本
 *   5. 生成前后端版本清单
 *   6. 打包成 zip 放到 ../gen-model/releases/
 *
 * 使用：
 *   node scripts/build-offline-release.mjs --backend-package <ams-local.zip>
 *   node scripts/build-offline-release.mjs                 # 自动使用 releases 下最新后端包
 *   node scripts/build-offline-release.mjs --frontend-only # 仅打前端兼容包
 *   node scripts/build-offline-release.mjs --skip-build    # 跳过构建，直接打包
 *   node scripts/build-offline-release.mjs --skip-nginx    # 跳过下载 nginx（已有的话）
 *   node scripts/build-offline-release.mjs --force         # 允许覆盖同名输出
 */

import { execFileSync, execSync } from 'node:child_process';
import {
  copyFileSync,
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');
const OFFLINE_DIR = join(PROJECT_DIR, 'deploy', 'offline');
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
const frontendOnly = args.includes('--frontend-only');
const force = args.includes('--force');
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

function findLatestBackendPackage() {
  if (!existsSync(RELEASES_DIR)) return null;
  const candidates = readdirSync(RELEASES_DIR)
    .filter((name) => /^ams-local-.*\.zip$/i.test(name))
    .map((name) => join(RELEASES_DIR, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  return candidates[0] ?? null;
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
    join('web', 'pkg', 'rs-plant_bg.wasm'),
  ];
  for (const required of requiredPaths) {
    if (!existsSync(join(packageRoot, required))) {
      throw new Error(`后端发布包缺少 ${required}: ${packagePath}`);
    }
  }

  copyDir(packageRoot, BACKEND_DIR);
  const configPath = join(BACKEND_DIR, 'DbOption.toml');
  const config = readFileSync(configPath, 'utf-8')
    .replace(/^server_release_ip\s*=.*$/m, 'server_release_ip = "0.0.0.0:8022"')
    .replace(/^http_api_addr\s*=.*$/m, 'http_api_addr = "0.0.0.0:8022"');
  writeFileSync(configPath, config);
  removeDir(tmpDir);
  logSuccess(`后端发布包已整合: ${packagePath}`);
}

function readBackendVersion() {
  const manifestPath = join(BACKEND_DIR, 'release.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  return {
    version: manifest.backend_version ?? null,
    buildId: manifest.backend_build_id ?? null,
    commit: manifest.backend_git_commit ?? null,
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
  const now = new Date();
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return {
    version: pkg.version,
    commit,
    buildDate: beijingTime.toISOString(),
  };
}

/** 生成 version.json */
function writeVersionJson(versionInfo) {
  const versionJson = {
    version: versionInfo.version,
    commit: versionInfo.commit,
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

  const versionInfo = getVersionInfo();
  log(`版本: v${versionInfo.version}`);
  log(`Commit: ${versionInfo.commit.slice(0, 7)}`);
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

  // Step 3: 准备后端
  log('Step 3/6: 准备 gen-model 后端...');
  if (frontendOnly) {
    removeDir(BACKEND_DIR);
    log('已选择纯前端包 (--frontend-only)');
  } else {
    const selectedBackendPackage = backendPackage ?? findLatestBackendPackage();
    if (!selectedBackendPackage) {
      throw new Error(`未找到后端发布包。请使用 --backend-package <zip>，或先在 ${RELEASES_DIR} 生成 ams-local-*.zip`);
    }
    prepareBackend(selectedBackendPackage);
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
  const backendVersion = frontendOnly ? null : readBackendVersion();
  writeFileSync(join(OFFLINE_DIR, 'release.json'), JSON.stringify({
    frontend: versionInfo,
    backend: backendVersion,
    mode: frontendOnly ? 'frontend-only' : 'integrated',
  }, null, 2) + '\n');
  console.log('');

  // Step 6: 打包成 zip
  log('Step 6/6: 打包成 zip...');
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const backendSuffix = backendVersion?.version ? `-backend-v${backendVersion.version}` : '';
  const zipName = `plant3d-web-offline-v${versionInfo.version}${backendSuffix}-${dateStr}.zip`;
  const zipPath = join(RELEASES_DIR, zipName);
  
  createZip(OFFLINE_DIR, zipPath);
  
  // 计算文件大小
  const stat = statSync(zipPath);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
  
  console.log('');
  console.log('==========================================');
  console.log('  打包完成！');
  console.log('==========================================');
  console.log('');
  console.log(`  版本:     v${versionInfo.version}`);
  console.log(`  Commit:   ${versionInfo.commit.slice(0, 7)}`);
  console.log(`  构建时间: ${versionInfo.buildDate}`);
  console.log(`  输出文件: ${zipPath}`);
  console.log(`  文件大小: ${sizeMB} MB`);
  console.log('');
  console.log('  发包位置: ../gen-model/releases/');
  console.log('');
  console.log('  部署说明:');
  console.log('    1. 将 zip 解压到目标机器');
  console.log('    2. 运行 config.bat 配置后端地址');
  console.log('    3. 运行 start.bat 启动服务');
  console.log('');
}

main().catch((err) => {
  logError(err.message);
  console.error(err.stack);
  process.exit(1);
});
