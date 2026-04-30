import { formatMeasurementPath } from './measurementDisplay';

import type {
  AnyAnnotationRecord,
  AnnotationRecord,
  AnnotationType,
  CloudAnnotationRecord,
  MeasurementRecord,
  ObbAnnotationRecord,
  RectAnnotationRecord,
  XeokitMeasurementRecord,
} from '@/composables/useToolStore';

import { getAnnotationRefnos } from '@/composables/useToolStore';
import {
  compareAnnotationSeverity,
  getAnnotationReviewDisplay,
  getAnnotationSeverityDisplay,
  normalizeAnnotationScreenshot,
  normalizeAnnotationReviewState,
  type AnnotationReviewState,
  type AnnotationScreenshot,
  type AnnotationSeverity,
} from '@/types/auth';

export type AnnotationWorkspaceRole = 'reviewer' | 'designer';

export type AnnotationWorkspaceFilter = 'all' | 'pending' | 'fixed' | 'rejected' | 'high_priority';

export type AnnotationWorkspacePriority = 'low' | 'medium' | 'high' | 'urgent';

export type AnnotationWorkspaceItem = {
  id: string;
  type: AnnotationType;
  title: string;
  description: string;
  createdAt: number;
  activityAt: number;
  visible: boolean;
  refnos: string[];
  formId?: string;
  commentCount: number;
  reviewState?: AnnotationReviewState;
  severity?: AnnotationSeverity;
  screenshot?: AnnotationScreenshot;
  thumbnailUrl?: string;
  authorId?: string;
  statusKey: 'pending' | 'fixed' | 'rejected' | 'approved' | 'wont_fix';
  statusLabel: string;
  statusTone: string;
  priority: AnnotationWorkspacePriority;
  priorityLabel: string;
  priorityTone: string;
};

export type AnnotationWorkspaceSummary = {
  total: number;
  pending: number;
  fixed: number;
  rejected: number;
  approved: number;
  wontFix: number;
  highPriority: number;
};

export type LinkedMeasurementItem = {
  id: string;
  engine: 'xeokit' | 'classic';
  kind: 'distance' | 'angle';
  createdAt: number;
  visible: boolean;
  summary: string;
  pathDisplayId?: string;
  measurement?: MeasurementRecord | XeokitMeasurementRecord;
};

type BuildAnnotationWorkspaceItemsOptions = {
  annotations: AnnotationRecord[];
  cloudAnnotations: CloudAnnotationRecord[];
  rectAnnotations: RectAnnotationRecord[];
  obbAnnotations: ObbAnnotationRecord[];
  getCommentCount?: (type: AnnotationType, id: string) => number;
};

function normalizeFormId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function resolveWorkspaceStatus(
  reviewState?: AnnotationReviewState,
): Pick<AnnotationWorkspaceItem, 'statusKey' | 'statusLabel' | 'statusTone'> {
  const normalized = normalizeAnnotationReviewState(reviewState);
  const display = getAnnotationReviewDisplay(normalized);

  if (normalized.decisionStatus === 'rejected') {
    return {
      statusKey: 'rejected',
      statusLabel: display.label,
      statusTone: display.color,
    };
  }

  if (normalized.decisionStatus === 'agreed') {
    return {
      statusKey: 'approved',
      statusLabel: display.label,
      statusTone: display.color,
    };
  }

  if (normalized.resolutionStatus === 'wont_fix') {
    return {
      statusKey: 'wont_fix',
      statusLabel: '不需解决',
      statusTone: 'bg-amber-100 text-amber-700 border-amber-200',
    };
  }

  if (normalized.resolutionStatus === 'fixed') {
    return {
      statusKey: 'fixed',
      statusLabel: '已修改',
      statusTone: 'bg-blue-100 text-blue-700 border-blue-200',
    };
  }

  return {
    statusKey: 'pending',
    statusLabel: '待处理',
    statusTone: 'bg-slate-100 text-slate-700 border-slate-200',
  };
}

export function getAnnotationWorkspacePriorityDisplay(
  severity?: AnnotationSeverity,
): { priority: AnnotationWorkspacePriority; label: string; tone: string } {
  const display = getAnnotationSeverityDisplay(severity);
  switch (severity) {
    case 'principle':
      return {
        priority: 'urgent',
        label: display.label,
        tone: display.color,
      };
    case 'general':
      return {
        priority: 'medium',
        label: display.label,
        tone: display.color,
      };
    case 'drawing':
      return {
        priority: 'low',
        label: display.label,
        tone: display.color,
      };
    default:
      return {
        priority: 'low',
        label: display.label,
        tone: display.color,
      };
  }
}

function createWorkspaceItem(
  type: AnnotationType,
  record: AnyAnnotationRecord,
  fallbackTitle: string,
  fallbackDescription: string,
  getCommentCount?: (type: AnnotationType, id: string) => number,
): AnnotationWorkspaceItem {
  const reviewState = normalizeAnnotationReviewState(record.reviewState);
  const status = resolveWorkspaceStatus(reviewState);
  const priorityDisplay = getAnnotationWorkspacePriorityDisplay(record.severity);
  const screenshot = resolveAnnotationScreenshot(record);

  return {
    id: record.id,
    type,
    title: record.title?.trim() || fallbackTitle,
    description: record.description?.trim() || fallbackDescription,
    createdAt: record.createdAt,
    activityAt: reviewState.updatedAt || record.createdAt,
    visible: record.visible,
    refnos: getAnnotationRefnos(record),
    formId: normalizeFormId((record as { formId?: string }).formId),
    commentCount: getCommentCount ? getCommentCount(type, record.id) : 0,
    reviewState,
    severity: record.severity,
    screenshot,
    thumbnailUrl: screenshot?.url,
    authorId: (record as { authorId?: string }).authorId,
    statusKey: status.statusKey,
    statusLabel: status.statusLabel,
    statusTone: status.statusTone,
    priority: priorityDisplay.priority,
    priorityLabel: priorityDisplay.label,
    priorityTone: priorityDisplay.tone,
  };
}

function resolveAnnotationScreenshot(record: AnyAnnotationRecord): AnnotationScreenshot | undefined {
  const legacy = record as { thumbnailUrl?: string; attachmentId?: string };
  return normalizeAnnotationScreenshot(record.screenshot)
    ?? normalizeAnnotationScreenshot({
      thumbnailUrl: legacy.thumbnailUrl,
      attachmentId: legacy.attachmentId,
    });
}

function compareStatusRank(a: AnnotationWorkspaceItem, b: AnnotationWorkspaceItem): number {
  const rank: Record<AnnotationWorkspaceItem['statusKey'], number> = {
    pending: 5,
    rejected: 4,
    fixed: 3,
    wont_fix: 2,
    approved: 1,
  };
  return rank[b.statusKey] - rank[a.statusKey];
}

export function buildAnnotationWorkspaceItems(
  options: BuildAnnotationWorkspaceItemsOptions,
): AnnotationWorkspaceItem[] {
  const items: AnnotationWorkspaceItem[] = [];
  const push = (
    type: AnnotationType,
    records: AnyAnnotationRecord[],
    fallbackTitle: string,
    fallbackDescription: string,
  ) => {
    for (const record of records) {
      items.push(createWorkspaceItem(type, record, fallbackTitle, fallbackDescription, options.getCommentCount));
    }
  };

  push('text', options.annotations, '未命名文字批注', '暂无批注描述');
  push('cloud', options.cloudAnnotations, '未命名云线批注', '暂无批注描述');
  push('rect', options.rectAnnotations, '未命名矩形批注', '暂无批注描述');
  push('obb', options.obbAnnotations, '未命名包围盒批注', '暂无批注描述');

  return items.sort((a, b) => {
    const statusRank = compareStatusRank(a, b);
    if (statusRank !== 0) return statusRank;
    const severityRank = compareAnnotationSeverity(a.severity, b.severity);
    if (severityRank !== 0) return severityRank;
    return b.activityAt - a.activityAt;
  });
}

export function filterAnnotationWorkspaceItems(
  items: AnnotationWorkspaceItem[],
  filter: AnnotationWorkspaceFilter,
): AnnotationWorkspaceItem[] {
  switch (filter) {
    case 'pending':
      return items.filter((item) => item.statusKey === 'pending');
    case 'fixed':
      return items.filter((item) => item.statusKey === 'fixed');
    case 'rejected':
      return items.filter((item) => item.statusKey === 'rejected');
    case 'high_priority':
      return items.filter((item) => item.priority === 'high' || item.priority === 'urgent');
    case 'all':
    default:
      return items;
  }
}

export function buildAnnotationWorkspaceSummary(
  items: AnnotationWorkspaceItem[],
): AnnotationWorkspaceSummary {
  return items.reduce<AnnotationWorkspaceSummary>((summary, item) => {
    summary.total += 1;
    if (item.statusKey === 'pending') summary.pending += 1;
    if (item.statusKey === 'fixed') summary.fixed += 1;
    if (item.statusKey === 'rejected') summary.rejected += 1;
    if (item.statusKey === 'approved') summary.approved += 1;
    if (item.statusKey === 'wont_fix') summary.wontFix += 1;
    if (item.priority === 'high' || item.priority === 'urgent') summary.highPriority += 1;
    return summary;
  }, {
    total: 0,
    pending: 0,
    fixed: 0,
    rejected: 0,
    approved: 0,
    wontFix: 0,
    highPriority: 0,
  });
}

export function scopeAnnotationWorkspaceItemsByFormId(
  items: AnnotationWorkspaceItem[],
  formId?: string | null,
): AnnotationWorkspaceItem[] {
  const normalized = normalizeFormId(formId);
  if (!normalized) return items;
  return items.filter((item) => item.formId === normalized || !item.formId);
}

export function buildLinkedMeasurementItems(
  annotation: AnnotationWorkspaceItem | null,
  measurements: MeasurementRecord[],
  xeokitMeasurements: XeokitMeasurementRecord[],
): LinkedMeasurementItem[] {
  if (!annotation) return [];

  const combined = new Map<string, LinkedMeasurementItem>();
  const append = (
    measurement: MeasurementRecord | XeokitMeasurementRecord,
    engine: 'xeokit' | 'classic',
  ) => {
    if (measurement.sourceAnnotationId !== annotation.id || measurement.sourceAnnotationType !== annotation.type) return;
    const summary = `${measurement.kind === 'angle' ? '角度' : '距离'} · ${formatMeasurementPath(measurement)}`;
    combined.set(`${engine}:${measurement.id}`, {
      id: measurement.id,
      engine,
      kind: measurement.kind,
      createdAt: measurement.createdAt,
      visible: measurement.visible,
      summary,
      pathDisplayId: `${engine}:${measurement.id}`,
      measurement,
    });
  };

  for (const measurement of xeokitMeasurements) {
    append(measurement, 'xeokit');
  }
  for (const measurement of measurements) {
    append(measurement, 'classic');
  }

  return [...combined.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getAnnotationWorkspaceTypeDisplay(type: AnnotationType): { label: string; tone: string } {
  switch (type) {
    case 'text':
      return { label: '文字', tone: 'bg-blue-100 text-blue-700 border-blue-200' };
    case 'cloud':
      return { label: '云线', tone: 'bg-violet-100 text-violet-700 border-violet-200' };
    case 'rect':
      return { label: '矩形', tone: 'bg-amber-100 text-amber-700 border-amber-200' };
    case 'obb':
      return { label: '包围盒（辅助证据）', tone: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200' };
  }
}

export const ANNOTATION_WORKSPACE_FILTER_OPTIONS: {
  value: AnnotationWorkspaceFilter;
  label: string;
}[] = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待处理' },
  { value: 'fixed', label: '已修改' },
  { value: 'rejected', label: '已驳回' },
  { value: 'high_priority', label: '原则错误' },
];

export const ANNOTATION_WORKSPACE_PRIORITY_OPTIONS: {
  value: AnnotationSeverity | undefined;
  label: string;
  tone: string;
}[] = [
  { value: undefined, label: '未设置', tone: getAnnotationSeverityDisplay(undefined).color },
  { value: 'drawing', label: '图面错误', tone: getAnnotationSeverityDisplay('drawing').color },
  { value: 'general', label: '一般错误', tone: getAnnotationSeverityDisplay('general').color },
  { value: 'principle', label: '原则错误', tone: getAnnotationSeverityDisplay('principle').color },
];
