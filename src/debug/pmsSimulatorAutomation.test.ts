import { describe, expect, it } from 'vitest';

import {
  buildPmsSimulatorEnvironmentConfig,
  formatPmsSimulatorConsoleSummary,
  resolvePmsSimulatorCaseSelection,
  type PmsSimulatorRunReport,
} from './pmsSimulatorAutomation';

describe('resolvePmsSimulatorCaseSelection', () => {
  it('默认返回全部场景', () => {
    expect(resolvePmsSimulatorCaseSelection()).toEqual([
      'approved',
      'return',
      'stop',
      'restore',
      'gate-block',
      'gate-return',
    ]);
    expect(resolvePmsSimulatorCaseSelection('all')).toEqual([
      'approved',
      'return',
      'stop',
      'restore',
      'gate-block',
      'gate-return',
    ]);
  });

  it('支持按顺序解析过滤场景', () => {
    expect(resolvePmsSimulatorCaseSelection('gate-return|approved|stop')).toEqual([
      'approved',
      'stop',
      'gate-return',
    ]);
  });

  it('非法场景值直接报错', () => {
    expect(() => resolvePmsSimulatorCaseSelection('approved|unknown')).toThrowError(
      /不支持的 PMS_SIMULATOR_CASE/,
    );
  });
});

describe('buildPmsSimulatorEnvironmentConfig', () => {
  it('按环境变量解析端口、项目号与输出路径', () => {
    expect(buildPmsSimulatorEnvironmentConfig({
      PMS_SIMULATOR_FRONTEND_PORT: '3201',
      PMS_SIMULATOR_BACKEND_PORT: '3200',
      PMS_SIMULATOR_PROJECT_ID: 'TEST_PROJECT',
      PMS_SIMULATOR_CASE: 'approved|gate-block',
      PMS_SIMULATOR_HEADLESS: '0',
      PMS_SIMULATOR_OUTPUT: 'artifacts/custom-report.json',
    })).toEqual({
      projectId: 'TEST_PROJECT',
      frontendPort: 3201,
      backendPort: 3200,
      frontendBaseUrl: 'http://127.0.0.1:3201',
      backendBaseUrl: 'http://127.0.0.1:3200',
      simulatorUrl: 'http://127.0.0.1:3201/pms-review-simulator.html?debug_ui=1&auth_strict=0&project=TEST_PROJECT',
      caseIds: ['approved', 'gate-block'],
      headless: false,
      outputPath: 'artifacts/custom-report.json',
    });
  });
});

describe('formatPmsSimulatorConsoleSummary', () => {
  it('输出契约结果与场景摘要', () => {
    const report: PmsSimulatorRunReport = {
      startedAt: '2026-04-21T00:00:00.000Z',
      finishedAt: '2026-04-21T00:05:00.000Z',
      ok: false,
      environment: {
        projectId: 'AvevaMarineSample',
        frontendPort: 3101,
        backendPort: 3100,
        frontendBaseUrl: 'http://127.0.0.1:3101',
        backendBaseUrl: 'http://127.0.0.1:3100',
        simulatorUrl: 'http://127.0.0.1:3101/pms-review-simulator.html?debug_ui=1&auth_strict=0&project=AvevaMarineSample',
        caseIds: ['approved'],
        headless: true,
        outputPath: 'artifacts/pms-simulator-report.json',
        frontendAutoStarted: true,
        backendAutoStarted: false,
      },
      contractSmoke: {
        ok: true,
        command: 'npx tsx scripts/pms-contract-sequence.ts',
        exitCode: 0,
        summary: 'ok',
        steps: [{
          step: 'workflow/verify',
          ok: true,
          status: 200,
          code: 200,
          formId: 'FORM-001',
          taskId: 'task-001',
          passed: true,
          reason: '验证通过，可继续流转',
          recommendedAction: 'proceed',
        }],
      },
      scenarios: [{
        caseId: 'approved',
        name: '主链通过到 approved',
        ok: false,
        formId: 'FORM-001',
        taskId: 'task-001',
        finalNode: 'pz',
        finalStatus: 'in_review',
        packageName: 'pkg-001',
        assertions: [],
        failureMessage: '最终未到 approved',
      }],
    };

    expect(formatPmsSimulatorConsoleSummary(report)).toContain('PMS simulator 自动化：失败');
    expect(formatPmsSimulatorConsoleSummary(report)).toContain('契约烟测：通过');
    expect(formatPmsSimulatorConsoleSummary(report)).toContain('契约 verify ｜ 通过 ｜ HTTP 200 ｜ passed=true ｜ recommendedAction=proceed');
    expect(formatPmsSimulatorConsoleSummary(report)).toContain('approved');
    expect(formatPmsSimulatorConsoleSummary(report)).toContain('原因=最终未到 approved');
  });

  it('workflow/verify 被业务阻塞时应明确显示失败', () => {
    const report: PmsSimulatorRunReport = {
      startedAt: '2026-04-21T00:00:00.000Z',
      finishedAt: '2026-04-21T00:05:00.000Z',
      ok: false,
      environment: {
        projectId: 'AvevaMarineSample',
        frontendPort: 3101,
        backendPort: 3100,
        frontendBaseUrl: 'http://127.0.0.1:3101',
        backendBaseUrl: 'http://127.0.0.1:3100',
        simulatorUrl: 'http://127.0.0.1:3101/pms-review-simulator.html?debug_ui=1&auth_strict=0&project=AvevaMarineSample',
        caseIds: ['gate-block'],
        headless: true,
        outputPath: 'artifacts/pms-simulator-report.json',
        frontendAutoStarted: false,
        backendAutoStarted: false,
      },
      contractSmoke: {
        ok: false,
        command: 'npx tsx scripts/pms-contract-sequence.ts',
        exitCode: 1,
        summary: 'blocked',
        steps: [{
          step: 'workflow/verify',
          ok: false,
          status: 200,
          code: 200,
          formId: 'FORM-BLOCK',
          taskId: 'task-block',
          passed: false,
          reason: '当前仍有待确认批注',
          recommendedAction: 'block',
        }],
      },
      scenarios: [],
    };

    const summary = formatPmsSimulatorConsoleSummary(report);
    expect(summary).toContain('契约 verify ｜ 失败 ｜ HTTP 200 ｜ passed=false ｜ recommendedAction=block ｜ reason=当前仍有待确认批注');
  });
});
