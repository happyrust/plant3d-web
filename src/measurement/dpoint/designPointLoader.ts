/**
 * Loads E3D design points (`DPSE` → `DPCA` / `DPCY`) for the elements under the cursor through
 * the model-source ports, so the measurement pick layer can offer them as `DPOINT` candidates
 * (kernel: `designPoints.ts`).
 *
 * E3D shows a design element's design points with its P-points; the picked `item` is the
 * **host** element (the `DPSE` owner — EQUI / SUBE / STRU / FRMW / TMPL …), not the primitive
 * under the cursor. The Web's hover gives the leaf element with geometry, so the host chain is
 * the leaf plus its owners up to (excluding) the first administrative level (ZONE / SITE …),
 * each queried once: `tree.children(host)` → `DPSE` nodes → `tree.children(dpse)` →
 * `DPCA` / `DPCY` nodes → `attributes.uiAttr(point)` (`NUMB` / `POS` / `ORI`) → World via the
 * host's `world_transform` (`keypoints.ptset(host).world_transform`, gen-model `element/ptset`;
 * present even when the host has no catalogue P-points).
 *
 * Every step is best-effort: a failing call yields no points for that host (and a reason),
 * never an exception — a hover must not break because a template world is unreachable.
 */
import {
  DESIGN_POINT_NOUNS,
  DESIGN_POINT_SET_NOUN,
  designPointToWorld,
  isDesignPointHostStop,
  parseDesignPointAttributes,
  type DesignPointVec3,
} from './designPoints';

import type { TreeNodeDto } from '@/api/genModelE3dTypes';
import type { AttributeSource, KeypointSource, TreeSource } from '@/model-source/ports';

export type DesignPointHost = Readonly<{ refno: string; noun: string | null }>;

export type LoadedDesignPoint = Readonly<{
  hostRefno: string;
  hostNoun: string | null;
  setRefno: string;
  pointRefno: string;
  /** `DPCA` / `DPCY` */
  pointNoun: string;
  /** `NUMB` */
  number: number;
  /** `DPPS[n]` — World mm. */
  worldMm: DesignPointVec3;
  /** `DPDI[n]` — unit World direction, `null` when degenerate. */
  direction: DesignPointVec3 | null;
  /** `PURP` when set (E3D shows it in the design point form). */
  purpose: string | null;
}>;

export type DesignPointLoadResult = Readonly<{
  points: readonly LoadedDesignPoint[];
  /** Why some or all points are missing (per failing call); empty when everything resolved. */
  errors: readonly string[];
}>;

export type DesignPointLoaderDeps = Readonly<{
  tree: Pick<TreeSource, 'node' | 'children' | 'ancestors'>;
  attributes: Pick<AttributeSource, 'uiAttr'>;
  keypoints: Pick<KeypointSource, 'ptset'>;
  /** legacy parquet bucket key for `keypoints.ptset`; gen-model-v1 ignores it. Default 0. */
  dbno?: number;
}>;

function nounOf(node: TreeNodeDto | null | undefined): string | null {
  const noun = String(node?.noun ?? '').trim().toUpperCase();
  return noun || null;
}

/** `24381/177298` and `24381_177298` name the same element (tree ports answer in either spelling). */
function sameRefno(a: string, b: string): boolean {
  return a.replace(/\//g, '_').trim() === b.replace(/\//g, '_').trim();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Nouns already looked up (`refno` → noun or `null` when unreadable); shared across hovers by the caller. */
export type DesignPointNounCache = Map<string, string | null>;

async function nounOfRefno(
  refno: string,
  tree: Pick<TreeSource, 'node'>,
  cache: DesignPointNounCache | undefined,
): Promise<string | null> {
  const key = refno.replace(/\//g, '_');
  if (cache?.has(key)) return cache.get(key) ?? null;
  let noun: string | null = null;
  try {
    const node = await tree.node(refno);
    noun = nounOf(node.node);
  } catch {
    noun = null;
  }
  cache?.set(key, noun);
  return noun;
}

/**
 * The leaf element plus its owners, nearest first, stopping before the first administrative
 * level (`isDesignPointHostStop`). The leaf itself is always included (E3D hosts can be leaves,
 * e.g. an EQUI drawn as one element). Ancestors whose noun cannot be read still count as hosts
 * (their `children` call decides). Pass a `nounCache` to avoid re-reading the same owners for
 * every leaf hovered under them (gen-model-v1 `tree.node` costs two requests).
 */
export async function designPointHostChain(
  refno: string,
  tree: Pick<TreeSource, 'node' | 'ancestors'>,
  nounCache?: DesignPointNounCache,
): Promise<DesignPointHost[]> {
  const hosts: DesignPointHost[] = [];
  const leafNoun = await nounOfRefno(refno, tree, nounCache);
  if (isDesignPointHostStop(leafNoun)) return [];
  hosts.push({ refno, noun: leafNoun });

  let ancestors: string[] = [];
  try {
    const resp = await tree.ancestors(refno);
    ancestors = resp.success ? resp.refnos.filter((entry) => entry && !sameRefno(entry, refno)) : [];
  } catch {
    ancestors = [];
  }
  for (const ancestor of ancestors) {
    const noun = await nounOfRefno(ancestor, tree, nounCache);
    if (isDesignPointHostStop(noun)) break;
    hosts.push({ refno: ancestor, noun });
  }
  return hosts;
}

/** Design points of one host element (`DPPS` / `DPDI` of that element). */
export async function loadDesignPointsOfHost(
  host: DesignPointHost,
  deps: DesignPointLoaderDeps,
): Promise<DesignPointLoadResult> {
  const errors: string[] = [];
  let sets: TreeNodeDto[] = [];
  try {
    const children = await deps.tree.children(host.refno);
    if (!children.success) {
      errors.push(children.error_message || `读取 ${host.refno} 的成员失败`);
      return { points: [], errors };
    }
    sets = children.children.filter((node) => nounOf(node) === DESIGN_POINT_SET_NOUN);
  } catch (error) {
    errors.push(errorText(error));
    return { points: [], errors };
  }
  if (sets.length === 0) return { points: [], errors };

  let worldTransform: unknown = null;
  try {
    const ptset = await deps.keypoints.ptset(deps.dbno ?? 0, host.refno);
    worldTransform = ptset.world_transform ?? null;
    if (!worldTransform) errors.push(`${host.refno} 没有 world_transform，设计点按 World 原样`);
  } catch (error) {
    errors.push(`${host.refno} 的 world_transform 读取失败：${errorText(error)}`);
  }

  const points: LoadedDesignPoint[] = [];
  for (const set of sets) {
    let members: TreeNodeDto[] = [];
    try {
      const children = await deps.tree.children(set.refno);
      if (!children.success) {
        errors.push(children.error_message || `读取 ${set.refno} 的设计点失败`);
        continue;
      }
      members = children.children.filter((node) => DESIGN_POINT_NOUNS.includes(nounOf(node) ?? ''));
    } catch (error) {
      errors.push(errorText(error));
      continue;
    }
    for (const member of members) {
      try {
        const attrs = await deps.attributes.uiAttr(member.refno);
        if (!attrs.success) {
          errors.push(attrs.error_message || `读取 ${member.refno} 的属性失败`);
          continue;
        }
        const parsed = parseDesignPointAttributes(attrs.attrs);
        if (!parsed) {
          errors.push(`${member.refno} 缺 NUMB / POS`);
          continue;
        }
        const world = designPointToWorld(parsed, worldTransform);
        const purpose = String(attrs.attrs.PURP ?? '').trim();
        points.push({
          hostRefno: host.refno,
          hostNoun: host.noun,
          setRefno: set.refno,
          pointRefno: member.refno,
          pointNoun: nounOf(member) ?? 'DPCA',
          number: world.number,
          worldMm: world.positionMm,
          direction: world.direction,
          purpose: purpose || null,
        });
      } catch (error) {
        errors.push(errorText(error));
      }
    }
  }
  points.sort((a, b) => a.number - b.number || a.pointRefno.localeCompare(b.pointRefno));
  return { points, errors };
}
