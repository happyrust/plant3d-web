export const PMS_SIMULATOR_CASE_ORDER = [
  'approved',
  'return',
  'stop',
  'restore',
  'gate-block',
  'gate-return',
] as const;

export type PmsSimulatorCaseId = (typeof PMS_SIMULATOR_CASE_ORDER)[number];

export type PmsSimulatorEnvironmentConfig = {
  projectId: string;
  frontendPort: number;
  backendPort: number;
  frontendBaseUrl: string;
  backendBaseUrl: string;
  simulatorUrl: string;
  caseIds: PmsSimulatorCaseId[];
  headless: boolean;
  outputPath: string;
};

export type PmsSimulatorAssertionResult = {
  key: string;
  passed: boolean;
  detail?: string;
  expected?: unknown;
  actual?: unknown;
};

export type PmsSimulatorContractStepReport = {
  step: string;
  ok: boolean;
  status: number;
  code: number | null;
  formId?: string | null;
  taskId?: string | null;
  passed?: boolean | null;
  reason?: string | null;
  recommendedAction?: string | null;
  errorCode?: string | null;
  seededTask?: boolean;
  detail?: string | null;
};

export type PmsSimulatorContractReport = {
  ok: boolean;
  command: string;
  exitCode: number;
  summary: string;
  steps?: PmsSimulatorContractStepReport[];
};

export type PmsSimulatorScenarioReport = {
  caseId: PmsSimulatorCaseId;
  name: string;
  ok: boolean;
  formId: string | null;
  taskId: string | null;
  finalNode: string | null;
  finalStatus: string | null;
  packageName: string | null;
  assertions: PmsSimulatorAssertionResult[];
  failureMessage?: string | null;
  screenshotPath?: string | null;
};

export type PmsSimulatorRunReport = {
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  environment: PmsSimulatorEnvironmentConfig & {
    frontendAutoStarted: boolean;
    backendAutoStarted: boolean;
  };
  contractSmoke?: PmsSimulatorContractReport;
  scenarios: PmsSimulatorScenarioReport[];
};

const CASE_ID_SET = new Set<string>(PMS_SIMULATOR_CASE_ORDER);

function normalizePort(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw?.trim() || '');
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }
  return fallback;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

export function isTruthyLike(value?: string | null): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function resolvePmsSimulatorCaseSelection(raw?: string | null): PmsSimulatorCaseId[] {
  const normalized = String(raw || '').trim().toLowerCase();
  if (!normalized || normalized === 'all') {
    return [...PMS_SIMULATOR_CASE_ORDER];
  }

  const tokens = normalized
    .split(/[|,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const invalid = tokens.filter((item) => !CASE_ID_SET.has(item));
  if (invalid.length > 0) {
    throw new Error(`不支持的 PMS_SIMULATOR_CASE：${invalid.join(', ')}`);
  }

  const selected = new Set(tokens);
  return PMS_SIMULATOR_CASE_ORDER.filter((item) => selected.has(item));
}

export function buildPmsSimulatorEnvironmentConfig(
  env: Record<string, string | undefined>,
): PmsSimulatorEnvironmentConfig {
  const frontendPort = normalizePort(env.PMS_SIMULATOR_FRONTEND_PORT, 3101);
  const backendPort = normalizePort(env.PMS_SIMULATOR_BACKEND_PORT, 3100);
  const frontendBaseUrl = trimTrailingSlash(env.PMS_SIMULATOR_FRONTEND_BASE_URL?.trim() || `http://127.0.0.1:${frontendPort}`);
  const backendBaseUrl = trimTrailingSlash(env.PMS_SIMULATOR_BACKEND_BASE_URL?.trim() || `http://127.0.0.1:${backendPort}`);
  const projectId = env.PMS_SIMULATOR_PROJECT_ID?.trim()
    || env.PMS_CONTRACT_PROJECT_ID?.trim()
    || 'AvevaMarineSample';
  const simulatorUrl = `${frontendBaseUrl}/pms-review-simulator.html?debug_ui=1&auth_strict=0&project=${encodeURIComponent(projectId)}`;

  return {
    projectId,
    frontendPort,
    backendPort,
    frontendBaseUrl,
    backendBaseUrl,
    simulatorUrl,
    caseIds: resolvePmsSimulatorCaseSelection(env.PMS_SIMULATOR_CASE),
    headless: env.PMS_SIMULATOR_HEADLESS == null ? true : isTruthyLike(env.PMS_SIMULATOR_HEADLESS),
    outputPath: env.PMS_SIMULATOR_OUTPUT?.trim() || 'artifacts/pms-simulator-report.json',
  };
}

export function formatPmsSimulatorConsoleSummary(report: PmsSimulatorRunReport): string {
  const lines = [
    `PMS simulator 自动化：${report.ok ? '通过' : '失败'}`,
    `契约烟测：${report.contractSmoke?.ok ? '通过' : '失败'}`,
  ];
  const verifyStep = report.contractSmoke?.steps?.find((item) => item.step === 'workflow/verify');
  if (verifyStep) {
    lines.push([
      '契约 verify',
      verifyStep.ok ? '通过' : '失败',
      `HTTP ${verifyStep.status > 0 ? verifyStep.status : '-'}`,
      verifyStep.passed == null ? '' : `passed=${String(verifyStep.passed)}`,
      verifyStep.recommendedAction ? `recommendedAction=${verifyStep.recommendedAction}` : '',
      verifyStep.reason ? `reason=${verifyStep.reason}` : '',
    ].filter(Boolean).join(' ｜ '));
  }

  for (const scenario of report.scenarios) {
    lines.push(
      [
        `- ${scenario.caseId}`,
        scenario.ok ? '通过' : '失败',
        scenario.finalStatus ? `status=${scenario.finalStatus}` : '',
        scenario.finalNode ? `node=${scenario.finalNode}` : '',
        scenario.formId ? `form=${scenario.formId}` : '',
        scenario.failureMessage ? `原因=${scenario.failureMessage}` : '',
      ].filter(Boolean).join(' ｜ '),
    );
  }

  return lines.join('\n');
}
