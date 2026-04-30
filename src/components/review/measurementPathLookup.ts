import {
  formatMeasurementEntityId,
  normalizeMeasurementEntityId,
} from './measurementDisplay';

import {
  e3dGetAncestors,
  e3dGetNode,
  type AncestorsResponse,
  type NodeResponse,
  type TreeNodeDto,
} from '@/api/genModelE3dApi';

export type MeasurementPathLookupStatus = 'invalid' | 'fallback' | 'resolved' | 'error';

export type MeasurementPathNode = {
  refno: string;
  label: string;
  noun: string;
  owner: string | null;
};

export type MeasurementPathLookupResult = {
  rawEntityId: string;
  refno: string;
  fallbackLabel: string;
  displayName: string;
  displayPath: string;
  nodes: MeasurementPathNode[];
  status: MeasurementPathLookupStatus;
  errorMessage?: string;
};

export type MeasurementPathLookupDeps = {
  getAncestors?: (refno: string) => Promise<AncestorsResponse>;
  getNode?: (refno: string) => Promise<NodeResponse>;
};

const pathCache = new Map<string, Promise<MeasurementPathLookupResult>>();

function isPdmsRefno(refno: string): boolean {
  return /^\d+_\d+$/.test(refno);
}

function normalizePathRefno(value: unknown): string {
  return normalizeMeasurementEntityId(value);
}

function formatNodeLabel(node: TreeNodeDto): string {
  const name = String(node.name || '').trim();
  return name || formatMeasurementEntityId(node.refno);
}

function toPathNode(node: TreeNodeDto): MeasurementPathNode {
  return {
    refno: normalizePathRefno(node.refno),
    label: formatNodeLabel(node),
    noun: String(node.noun || '').trim(),
    owner: node.owner ? normalizePathRefno(node.owner) || null : null,
  };
}

function buildOrderedPath(targetRefno: string, nodesByRefno: Map<string, MeasurementPathNode>): MeasurementPathNode[] {
  const ordered: MeasurementPathNode[] = [];
  const visited = new Set<string>();
  let currentRefno = targetRefno;

  while (currentRefno && !visited.has(currentRefno)) {
    visited.add(currentRefno);
    const node = nodesByRefno.get(currentRefno);
    if (!node) break;
    ordered.push(node);
    if (!node.owner || !nodesByRefno.has(node.owner)) break;
    currentRefno = node.owner;
  }

  return ordered.reverse();
}

function createFallbackResult(
  rawEntityId: unknown,
  refno: string,
  status: MeasurementPathLookupStatus,
  errorMessage?: string,
): MeasurementPathLookupResult {
  const fallbackLabel = formatMeasurementEntityId(rawEntityId);
  return {
    rawEntityId: String(rawEntityId ?? ''),
    refno,
    fallbackLabel,
    displayName: fallbackLabel,
    displayPath: fallbackLabel,
    nodes: [],
    status,
    ...(errorMessage ? { errorMessage } : {}),
  };
}

async function resolveMeasurementEntityPathUncached(
  rawEntityId: unknown,
  deps: MeasurementPathLookupDeps,
): Promise<MeasurementPathLookupResult> {
  const refno = normalizePathRefno(rawEntityId);
  if (!refno || !isPdmsRefno(refno)) {
    return createFallbackResult(rawEntityId, refno, 'invalid');
  }

  const getAncestors = deps.getAncestors ?? e3dGetAncestors;
  const getNode = deps.getNode ?? e3dGetNode;

  try {
    const ancestorsResp = await getAncestors(refno);
    if (!ancestorsResp.success) {
      return createFallbackResult(rawEntityId, refno, 'error', ancestorsResp.error_message || 'ancestors lookup failed');
    }

    const refnos = Array.from(new Set([
      ...ancestorsResp.refnos.map(normalizePathRefno).filter(Boolean),
      refno,
    ]));

    const nodeResponses = await Promise.all(refnos.map(async (pathRefno) => {
      try {
        return await getNode(pathRefno);
      } catch {
        return null;
      }
    }));

    const nodesByRefno = new Map<string, MeasurementPathNode>();
    for (const response of nodeResponses) {
      if (!response?.success || !response.node) continue;
      const pathNode = toPathNode(response.node);
      if (pathNode.refno) nodesByRefno.set(pathNode.refno, pathNode);
    }

    const nodes = buildOrderedPath(refno, nodesByRefno);
    if (nodes.length === 0) {
      return createFallbackResult(rawEntityId, refno, 'fallback');
    }

    const displayName = nodes[nodes.length - 1]?.label || formatMeasurementEntityId(refno);
    return {
      rawEntityId: String(rawEntityId ?? ''),
      refno,
      fallbackLabel: formatMeasurementEntityId(refno),
      displayName,
      displayPath: nodes.map((node) => node.label).join(' / '),
      nodes,
      status: 'resolved',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createFallbackResult(rawEntityId, refno, 'error', message);
  }
}

export async function resolveMeasurementEntityPath(
  rawEntityId: unknown,
  deps: MeasurementPathLookupDeps = {},
): Promise<MeasurementPathLookupResult> {
  const refno = normalizePathRefno(rawEntityId);
  const cacheKey = refno || String(rawEntityId ?? '');
  if (!cacheKey || deps.getAncestors || deps.getNode) {
    return await resolveMeasurementEntityPathUncached(rawEntityId, deps);
  }

  let task = pathCache.get(cacheKey);
  if (!task) {
    task = resolveMeasurementEntityPathUncached(rawEntityId, deps);
    pathCache.set(cacheKey, task);
  }
  return await task;
}

export function clearMeasurementPathLookupCache(): void {
  pathCache.clear();
}
