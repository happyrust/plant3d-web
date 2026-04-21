#!/usr/bin/env npx tsx
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

import {
  buildPmsSimulatorEnvironmentConfig,
  formatPmsSimulatorConsoleSummary,
  type PmsSimulatorContractReport,
  type PmsSimulatorRunReport,
} from '../src/debug/pmsSimulatorAutomation';

import {
  formatSequenceSummary,
  runSequence as runPmsContractSequence,
  type PmsContractSequenceOptions,
} from './pms-contract-sequence';
import { runPmsSimulatorScenarios } from './pms-simulator-runner';

type ManagedProcess = {
  name: 'frontend' | 'backend' | 'surreal';
  child: ChildProcess;
  logPath: string;
};

type BackendConfigSnapshot = {
  backendRepoRoot: string;
  configArg: string;
  configPath: string;
  autoStartSurreal: boolean;
  surrealMode: string;
  surrealBinary: string;
  surrealBind: string;
  surrealUser: string;
  surrealPassword: string;
  surrealDataPath: string | null;
};

const FRONTEND_HEALTH_TIMEOUT_MS = 120_000;
const BACKEND_HEALTH_TIMEOUT_MS = 180_000;

function appendNoProxy(value: string | undefined): string {
  const items = new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
  items.add('127.0.0.1');
  items.add('localhost');
  return [...items].join(',');
}

function prepareLocalNoProxy(): void {
  process.env.NO_PROXY = appendNoProxy(process.env.NO_PROXY);
  process.env.no_proxy = appendNoProxy(process.env.no_proxy);
}

async function postJson<T>(url: string, payload: unknown, bearerToken?: string): Promise<{ status: number; body: T }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    throw new Error(`POST ${url} 返回非 JSON：HTTP ${response.status} ${text}`);
  }
  if (!response.ok) {
    throw new Error(`POST ${url} 失败：HTTP ${response.status} ${text}`);
  }
  return { status: response.status, body };
}

async function waitForBackendContractReadiness(env: ReturnType<typeof buildPmsSimulatorEnvironmentConfig>, artifactDir: string): Promise<void> {
  const deadline = Date.now() + BACKEND_HEALTH_TIMEOUT_MS;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const authResponse = await postJson<{ code?: number; data?: { token?: string }; token?: string }>(
        `${trimTrailingSlash(env.backendBaseUrl)}/api/auth/token`,
        {
          project_id: env.projectId,
          user_id: 'SJ',
          role: 'sj',
        },
      );
      const token = authResponse.body.data?.token || authResponse.body.token || '';
      if (!token) {
        throw new Error('auth/token 未返回 token');
      }
      const embedResponse = await postJson<{ code?: number; message?: string }>(
        `${trimTrailingSlash(env.backendBaseUrl)}/api/review/embed-url`,
        {
          project_id: env.projectId,
          user_id: 'SJ',
          workflow_role: 'sj',
          workflow_mode: 'external',
          token,
        },
        token,
      );
      if (embedResponse.body.code === 0 || embedResponse.body.code === 200) {
        return;
      }
      throw new Error(embedResponse.body.message || `embed-url code=${embedResponse.body.code}`);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  const logPath = path.join(artifactDir, 'backend.log');
  const suffix = lastError instanceof Error ? `：${lastError.message}` : '';
  throw new Error(`backend 契约预热超时，详见 ${logPath}${suffix}`);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

function stripTomlValue(raw: string): string {
  const withoutComment = raw.split('#')[0]?.trim() || '';
  if (!withoutComment) return '';
  if (
    (withoutComment.startsWith('"') && withoutComment.endsWith('"'))
    || (withoutComment.startsWith('\'') && withoutComment.endsWith('\''))
  ) {
    return withoutComment.slice(1, -1);
  }
  return withoutComment;
}

async function loadBackendConfigSnapshot(backendRepoRoot: string): Promise<BackendConfigSnapshot> {
  const configArg = 'db_options/DbOption-mac.toml';
  const configPath = path.join(backendRepoRoot, configArg);
  const content = await fsp.readFile(configPath, 'utf8');
  let currentSection = '';
  const values = new Map<string, string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1] || '';
      continue;
    }
    const keyMatch = rawLine.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (!keyMatch) continue;
    const key = keyMatch[1];
    const value = stripTomlValue(keyMatch[2] || '');
    values.set(`${currentSection}.${key}`, value);
  }

  return {
    backendRepoRoot,
    configArg,
    configPath,
    autoStartSurreal: values.get('web_server.auto_start_surreal') === 'true',
    surrealMode: values.get('surrealdb.mode') || 'ws',
    surrealBinary: values.get('web_server.surreal_bin') || 'surreal',
    surrealBind: values.get('web_server.surreal_bind') || '0.0.0.0:8020',
    surrealUser: values.get('web_server.surreal_user') || 'root',
    surrealPassword: values.get('web_server.surreal_password') || 'root',
    surrealDataPath: values.get('web_server.surreal_data_path') || values.get('surrealdb.path') || null,
  };
}

function parseBindPort(bind: string): number {
  const normalized = bind.trim();
  const lastColon = normalized.lastIndexOf(':');
  const port = lastColon >= 0 ? Number.parseInt(normalized.slice(lastColon + 1), 10) : Number.NaN;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`无法解析 SurrealDB 端口：${bind}`);
  }
  return port;
}

function buildSurrealStoragePath(config: BackendConfigSnapshot): string {
  if (!config.surrealDataPath) {
    throw new Error(`未在 ${config.configPath} 找到 web_server.surreal_data_path`);
  }
  if (/^[a-z]+:\/\//i.test(config.surrealDataPath) || /^[a-z]+:/i.test(config.surrealDataPath)) {
    return config.surrealDataPath;
  }
  const resolved = path.isAbsolute(config.surrealDataPath)
    ? config.surrealDataPath
    : path.resolve(config.backendRepoRoot, config.surrealDataPath);
  const normalized = resolved.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `rocksdb:///${normalized}`;
  }
  return `rocksdb:////${normalized.replace(/^\/+/, '')}`;
}

async function isTcpPortHealthy(host: string, port: number): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const cleanup = () => {
        socket.removeAllListeners();
        socket.destroy();
      };
      socket.once('connect', () => {
        cleanup();
        resolve();
      });
      socket.once('error', (error) => {
        cleanup();
        reject(error);
      });
      socket.setTimeout(1200, () => {
        cleanup();
        reject(new Error('timeout'));
      });
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForTcpPort(host: string, port: number, timeoutMs: number, message: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isTcpPortHealthy(host, port)) return;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new Error(message);
}

async function waitForTcpPortReleased(host: string, port: number, timeoutMs: number, message: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isTcpPortHealthy(host, port))) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(message);
}

async function ensureDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

async function isUrlHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(url: string, timeoutMs: number, message: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isUrlHealthy(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new Error(message);
}

async function captureCommandOutput(options: {
  cwd: string;
  command: string;
  args: string[];
}): Promise<{ exitCode: number; stdout: string }> {
  return await new Promise<{ exitCode: number; stdout: string }>((resolve) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: process.env,
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.on('error', () => resolve({ exitCode: 1, stdout: '' }));
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout: stdout.trim() }));
  });
}

async function resolveListeningProcess(port: number): Promise<{ pid: number; command: string } | null> {
  const pidResult = await captureCommandOutput({
    cwd: process.cwd(),
    command: 'sh',
    args: ['-lc', `lsof -nP -iTCP:${port} -sTCP:LISTEN -t | head -1`],
  });
  if (pidResult.exitCode !== 0 || !pidResult.stdout) {
    return null;
  }
  const pid = Number.parseInt(pidResult.stdout, 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  const commandResult = await captureCommandOutput({
    cwd: process.cwd(),
    command: 'ps',
    args: ['-p', String(pid), '-o', 'comm='],
  });
  return { pid, command: commandResult.stdout };
}

async function restartUnhealthyBackendIfNeeded(env: ReturnType<typeof buildPmsSimulatorEnvironmentConfig>): Promise<boolean> {
  const listening = await resolveListeningProcess(env.backendPort);
  if (!listening) {
    return false;
  }
  const command = listening.command.toLowerCase();
  if (!command.includes('web_serve')) {
    return false;
  }
  try {
    process.kill(listening.pid, 'SIGTERM');
  } catch {
    return false;
  }
  try {
    await waitForTcpPortReleased('127.0.0.1', env.backendPort, 15_000, `端口 ${env.backendPort} 未释放，无法自动重启 backend`);
    return true;
  } catch {
    try {
      process.kill(listening.pid, 'SIGKILL');
      await waitForTcpPortReleased('127.0.0.1', env.backendPort, 8_000, `端口 ${env.backendPort} 未释放，无法自动重启 backend`);
      return true;
    } catch {
      return false;
    }
  }
}

function spawnBackgroundProcess(options: {
  name: 'frontend' | 'backend' | 'surreal';
  cwd: string;
  command: string;
  args: string[];
  logPath: string;
}): ManagedProcess {
  const logFd = fs.openSync(options.logPath, 'a');
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });
  child.unref();
  return {
    name: options.name,
    child,
    logPath: options.logPath,
  };
}

async function runForegroundCommand(options: {
  cwd: string;
  command: string;
  args: string[];
  logPath: string;
}): Promise<number> {
  await ensureDir(path.dirname(options.logPath));
  const stream = fs.createWriteStream(options.logPath, { flags: 'a' });
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    child.stdout.on('data', (chunk) => stream.write(chunk));
    child.stderr.on('data', (chunk) => stream.write(chunk));
    child.on('error', (error) => {
      stream.end();
      reject(error);
    });
    child.on('close', (code) => {
      stream.end();
      resolve(code ?? 1);
    });
  });
}

async function ensureBackendBinary(backendRepoRoot: string, logPath: string): Promise<void> {
  const binaryPath = path.join(backendRepoRoot, 'target/debug/web_server');
  try {
    await fsp.access(binaryPath);
    return;
  } catch {
    const exitCode = await runForegroundCommand({
      cwd: backendRepoRoot,
      command: 'cargo',
      args: ['build', '--bin', 'web_server', '--features', 'web_server'],
      logPath,
    });
    if (exitCode !== 0) {
      throw new Error(`构建 backend web_server 失败，详见 ${logPath}`);
    }
  }
}

async function ensureSurreal(artifactDir: string): Promise<{ started: boolean; process?: ManagedProcess; config: BackendConfigSnapshot }> {
  const backendRepoRoot = path.resolve(process.cwd(), '../plant-model-gen');
  const config = await loadBackendConfigSnapshot(backendRepoRoot);
  if (config.autoStartSurreal || config.surrealMode !== 'ws') {
    return { started: false, config };
  }

  const port = parseBindPort(config.surrealBind);
  if (await isTcpPortHealthy('127.0.0.1', port)) {
    return { started: false, config };
  }

  const logPath = path.join(artifactDir, 'surreal.log');
  const storagePath = buildSurrealStoragePath(config);
  const managed = spawnBackgroundProcess({
    name: 'surreal',
    cwd: config.backendRepoRoot,
    command: config.surrealBinary,
    args: ['start', '--log', 'info', '--user', config.surrealUser, '--pass', config.surrealPassword, '--bind', config.surrealBind, storagePath],
    logPath,
  });
  await waitForTcpPort('127.0.0.1', port, BACKEND_HEALTH_TIMEOUT_MS, `SurrealDB 未在 127.0.0.1:${port} 就绪，详见 ${logPath}`);
  return { started: true, process: managed, config };
}

async function ensureFrontend(env: ReturnType<typeof buildPmsSimulatorEnvironmentConfig>, artifactDir: string): Promise<{ started: boolean; process?: ManagedProcess }> {
  if (await isUrlHealthy(env.simulatorUrl)) {
    return { started: false };
  }
  const logPath = path.join(artifactDir, 'frontend.log');
  const managed = spawnBackgroundProcess({
    name: 'frontend',
    cwd: process.cwd(),
    command: 'npm',
    args: ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(env.frontendPort), '--strictPort'],
    logPath,
  });
  await waitForHealth(env.simulatorUrl, FRONTEND_HEALTH_TIMEOUT_MS, `frontend 未在 ${env.simulatorUrl} 就绪，详见 ${logPath}`);
  return { started: true, process: managed };
}

async function ensureBackend(env: ReturnType<typeof buildPmsSimulatorEnvironmentConfig>, artifactDir: string): Promise<{ started: boolean; process?: ManagedProcess }> {
  const healthUrl = `${trimTrailingSlash(env.backendBaseUrl)}/api/health`;
  if (await isUrlHealthy(healthUrl)) {
    try {
      await waitForBackendContractReadiness(env, artifactDir);
      return { started: false };
    } catch (error) {
      const restarted = await restartUnhealthyBackendIfNeeded(env);
      if (!restarted) {
        throw error;
      }
    }
  }

  const backendRepoRoot = path.resolve(process.cwd(), '../plant-model-gen');
  const buildLogPath = path.join(artifactDir, 'backend-build.log');
  await ensureBackendBinary(backendRepoRoot, buildLogPath);

  const logPath = path.join(artifactDir, 'backend.log');
  const managed = spawnBackgroundProcess({
    name: 'backend',
    cwd: backendRepoRoot,
    command: path.join(backendRepoRoot, 'target/debug/web_server'),
    args: ['--config', 'db_options/DbOption-mac'],
    logPath,
  });
  await waitForHealth(healthUrl, BACKEND_HEALTH_TIMEOUT_MS, `backend 未在 ${healthUrl} 就绪，详见 ${logPath}`);
  await waitForBackendContractReadiness(env, artifactDir);
  return { started: true, process: managed };
}

async function stopManagedProcess(processRef?: ManagedProcess): Promise<void> {
  if (!processRef?.child.pid) return;
  try {
    process.kill(-processRef.child.pid, 'SIGTERM');
  }
  catch {
    return;
  }
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try {
      process.kill(processRef.child.pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch {
      return;
    }
  }
  try {
    process.kill(-processRef.child.pid, 'SIGKILL');
  } catch {
    /* ignore */
  }
}

async function runContractSmoke(env: ReturnType<typeof buildPmsSimulatorEnvironmentConfig>, artifactDir: string): Promise<PmsSimulatorContractReport> {
  const logPath = path.join(artifactDir, 'contract-smoke.log');
  await ensureDir(path.dirname(logPath));
  const options: PmsContractSequenceOptions = {
    base: env.backendBaseUrl,
    projectId: env.projectId,
    user: 'SJ',
    workflowMode: 'external',
    verbose: false,
  };
  const results = await runPmsContractSequence(options);
  const summary = formatSequenceSummary(options, results);
  await fsp.writeFile(logPath, `${summary}\n`);
  const exitCode = results.every((item) => item.ok) ? 0 : 1;
  console.log(summary);
  return {
    ok: exitCode === 0,
    command: 'scripts/pms-contract-sequence.ts (in-process)',
    exitCode,
    summary: summary.trim(),
    steps: results.map((item) => ({
      step: item.step,
      ok: item.ok,
      status: item.status,
      code: item.code,
      formId: item.formId ?? null,
      taskId: item.taskId ?? null,
      passed: item.passed ?? null,
      reason: item.reason ?? null,
      recommendedAction: item.recommendedAction ?? null,
      errorCode: item.errorCode ?? null,
      seededTask: item.seededTask ?? false,
      detail: item.detail ?? null,
    })),
  };
}

async function writeReport(report: PmsSimulatorRunReport, outputPath: string): Promise<void> {
  const resolved = path.resolve(outputPath);
  await ensureDir(path.dirname(resolved));
  await fsp.writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`);
}

async function main(): Promise<void> {
  prepareLocalNoProxy();
  const env = buildPmsSimulatorEnvironmentConfig(process.env);
  const outputPath = path.resolve(env.outputPath);
  const artifactDir = path.resolve(path.dirname(outputPath), 'pms-simulator-artifacts');
  await ensureDir(artifactDir);

  let frontend = { started: false, process: undefined as ManagedProcess | undefined };
  let backend = { started: false, process: undefined as ManagedProcess | undefined };
  let surreal = { started: false, process: undefined as ManagedProcess | undefined };
  let contractSmoke: PmsSimulatorContractReport | undefined;
  let scenarios = [] as Awaited<ReturnType<typeof runPmsSimulatorScenarios>>;
  let ok = false;
  const startedAt = new Date().toISOString();

  try {
    surreal = await ensureSurreal(artifactDir);
    backend = await ensureBackend(env, artifactDir);
    frontend = await ensureFrontend(env, artifactDir);

    contractSmoke = await runContractSmoke(env, artifactDir);
    if (contractSmoke.ok) {
      scenarios = await runPmsSimulatorScenarios({ env, artifactDir });
    }
    ok = contractSmoke.ok && scenarios.every((item) => item.ok);
  } finally {
    const report: PmsSimulatorRunReport = {
      startedAt,
      finishedAt: new Date().toISOString(),
      ok,
      environment: {
        ...env,
        frontendAutoStarted: frontend.started,
        backendAutoStarted: backend.started,
      },
      contractSmoke,
      scenarios,
    };
    await writeReport(report, outputPath);
    console.log(formatPmsSimulatorConsoleSummary(report));
    console.log(`JSON 报告：${outputPath}`);
    await stopManagedProcess(frontend.process);
    await stopManagedProcess(backend.process);
    await stopManagedProcess(surreal.process);
    if (!report.ok) {
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
