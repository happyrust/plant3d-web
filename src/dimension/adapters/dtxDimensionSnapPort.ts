
import type {
  DimensionAccuracy,
  SemanticAnchorRef,
  Vec2,
  Vec3,
} from '../domain/types';
import type {
  DimensionSnapPort,
  SnapCandidate,
  SnapQuery,
} from '../ports/snapPort';

import {
  DEFAULT_MEASUREMENT_PICK_SOURCE_SETTINGS,
  MEASUREMENT_PICK_SOURCE_LABELS,
  type MeasurementPickSourceId,
} from '@/composables/useMeasurementPickSources';

export type ViewerSnapCandidate = Readonly<{
  id: string;
  source: MeasurementPickSourceId;
  sceneWorld: Vec3;
  refno?: string;
  label?: string;
  distancePx: number;
  direction?: Vec3;
  circle?: Readonly<{ center: Vec3; rim: Vec3; normal: Vec3 }>;
  arc?: Readonly<{ center: Vec3; rim: Vec3; normal: Vec3 }>;
}>;

type RankedCandidate = Readonly<{
  candidate: SnapCandidate;
  priority: number;
}>;

const SOURCE_SEMANTICS: Readonly<Record<
  MeasurementPickSourceId,
  Readonly<{ source: SemanticAnchorRef['source']; accuracy: DimensionAccuracy }>
>> = {
  ptset: { source: 'p-point', accuracy: 'exact' },
  position: { source: 'instance-origin', accuracy: 'exact' },
  primitive_key_point: { source: 'primitive-key-point', accuracy: 'exact' },
  mesh_pick_point: { source: 'model-surface', accuracy: 'approximate' },
};

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class DtxDimensionSnapPort implements DimensionSnapPort {
  private readonly queryMeasurementCandidates: (
    screen: Vec2,
  ) => readonly ViewerSnapCandidate[];
  private readonly sceneWorldToDesignMetres: (point: Vec3) => Vec3;

  constructor(input: Readonly<{
    queryMeasurementCandidates: (
      screen: Vec2,
    ) => readonly ViewerSnapCandidate[];
    sceneWorldToDesignMetres: (point: Vec3) => Vec3;
  }>) {
    this.queryMeasurementCandidates = input.queryMeasurementCandidates;
    this.sceneWorldToDesignMetres = input.sceneWorldToDesignMetres;
  }

  query(input: SnapQuery): readonly SnapCandidate[] {
    const requested = new Set(input.capabilities);
    const thresholdPx = Math.max(0, input.thresholdPx);
    const ranked: RankedCandidate[] = [];

    for (const viewerCandidate of this.queryMeasurementCandidates(input.screen)) {
      if (
        !Number.isFinite(viewerCandidate.distancePx)
        || viewerCandidate.distancePx > thresholdPx
      ) {
        continue;
      }
      const source = SOURCE_SEMANTICS[viewerCandidate.source];
      const priority =
        DEFAULT_MEASUREMENT_PICK_SOURCE_SETTINGS[viewerCandidate.source].priority;
      const label = viewerCandidate.label
        ?? MEASUREMENT_PICK_SOURCE_LABELS[viewerCandidate.source];
      const semanticRef = (
        semanticSource: SemanticAnchorRef['source'],
      ): SemanticAnchorRef => ({
        source: semanticSource,
        ...(viewerCandidate.refno ? { refno: viewerCandidate.refno } : {}),
        candidateId: viewerCandidate.id,
      });

      if (requested.has('point')) {
        ranked.push({
          priority,
          candidate: {
            id: viewerCandidate.id,
            capability: 'point',
            anchor: {
              snapshot: this.sceneWorldToDesignMetres(viewerCandidate.sceneWorld),
              accuracy: source.accuracy,
              semanticRef: semanticRef(source.source),
            },
            label,
            distancePx: viewerCandidate.distancePx,
          },
        });
      }

      if (requested.has('direction') && viewerCandidate.direction) {
        const origin = this.sceneWorldToDesignMetres([0, 0, 0]);
        const endpoint = this.sceneWorldToDesignMetres(viewerCandidate.direction);
        ranked.push({
          priority,
          candidate: {
            id: `${viewerCandidate.id}:direction`,
            capability: 'direction',
            anchor: {
              snapshot: this.sceneWorldToDesignMetres(viewerCandidate.sceneWorld),
              accuracy: source.accuracy,
              semanticRef: semanticRef('direction'),
            },
            direction: subtract(endpoint, origin),
            label,
            distancePx: viewerCandidate.distancePx,
          },
        });
      }

      if (requested.has('circle') && viewerCandidate.circle) {
        const center = this.sceneWorldToDesignMetres(viewerCandidate.circle.center);
        const rim = this.sceneWorldToDesignMetres(viewerCandidate.circle.rim);
        const origin = this.sceneWorldToDesignMetres([0, 0, 0]);
        const normalEndpoint = this.sceneWorldToDesignMetres(
          viewerCandidate.circle.normal,
        );
        ranked.push({
          priority,
          candidate: {
            id: `${viewerCandidate.id}:circle`,
            capability: 'circle',
            anchor: {
              snapshot: center,
              accuracy: 'exact',
              semanticRef: semanticRef('circle'),
            },
            direction: subtract(rim, center),
            normal: subtract(normalEndpoint, origin),
            label,
            distancePx: viewerCandidate.distancePx,
          },
        });
      }

      if (requested.has('arc') && viewerCandidate.arc) {
        const center = this.sceneWorldToDesignMetres(viewerCandidate.arc.center);
        const rim = this.sceneWorldToDesignMetres(viewerCandidate.arc.rim);
        const origin = this.sceneWorldToDesignMetres([0, 0, 0]);
        const normalEndpoint = this.sceneWorldToDesignMetres(
          viewerCandidate.arc.normal,
        );
        ranked.push({
          priority,
          candidate: {
            id: `${viewerCandidate.id}:arc`,
            capability: 'arc',
            anchor: {
              snapshot: center,
              accuracy: 'exact',
              semanticRef: semanticRef('arc'),
            },
            direction: subtract(rim, center),
            normal: subtract(normalEndpoint, origin),
            label,
            distancePx: viewerCandidate.distancePx,
          },
        });
      }
    }

    ranked.sort((a, b) =>
      a.priority - b.priority
      || a.candidate.distancePx - b.candidate.distancePx
      || compareText(a.candidate.id, b.candidate.id));
    return ranked.map(entry => entry.candidate);
  }
}
