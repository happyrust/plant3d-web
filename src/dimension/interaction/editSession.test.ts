import { describe, expect, it, vi } from 'vitest';

import { linearRecord } from '../domain/testFixtures';

import {
  createAngularEditSession,
  createLinearEditSession,
  createPlacementEditSession,
  createProjectedEditSession,
  createRadialEditSession,
  createRebindEditSession,
} from './editSession';

import type {
  DimensionSnapPort,
  SnapCandidate,
} from '../ports/snapPort';

function point(
  id: string,
  snapshot: readonly [number, number, number],
  accuracy: 'exact' | 'approximate' = 'exact',
): SnapCandidate {
  return {
    id,
    capability: 'point',
    anchor: {
      snapshot,
      accuracy,
      semanticRef: {
        source: accuracy === 'exact' ? 'p-point' : 'model-surface',
        candidateId: id,
      },
    },
    label: id,
    distancePx: 1,
  };
}

function createSnapPort(
  resolve: (x: number, capabilities: readonly string[]) => SnapCandidate | null,
): DimensionSnapPort {
  return {
    query: input => {
      const candidate = resolve(input.screen.x, input.capabilities);
      return candidate ? [candidate] : [];
    },
  };
}

function createInput(snapPort: DimensionSnapPort) {
  return {
    snapPort,
    actor: { actorId: 'designer-1', actorRole: 'designer' },
    createDimensionId: () => 'dimension-new',
    createCommandId: vi.fn(() => 'command-new'),
    now: () => 100,
    onPreview: vi.fn(),
  };
}

describe('dimension edit sessions', () => {
  it('updates linear preview repeatedly but materializes one command on commit', () => {
    const snapPort = createSnapPort(x =>
      x < 2 ? point('a', [0, 0, 0]) : point('b', [1, 0, 0], 'approximate'),
    );
    const input = createInput(snapPort);
    const session = createLinearEditSession(input);
    session.pointerDown({ x: 1, y: 0 });

    for (let index = 0; index < 100; index += 1) {
      session.pointerMove({ x: 2, y: index });
    }

    expect(input.onPreview).toHaveBeenCalledTimes(101);
    expect(input.createCommandId).not.toHaveBeenCalled();
    session.pointerDown({ x: 2, y: 0 });
    expect(session.phase).toBe('ready');

    const command = session.commit();

    expect(command).toMatchObject({
      commandId: 'command-new',
      type: 'create',
      record: {
        id: 'dimension-new',
        kind: 'linear',
        a: { snapshot: [0, 0, 0], accuracy: 'exact' },
        b: { snapshot: [1, 0, 0], accuracy: 'approximate' },
      },
    });
    expect(session.commit()).toBeNull();
    expect(input.createCommandId).toHaveBeenCalledTimes(1);
  });

  it('stores a projected semantic axis rather than a screen direction', () => {
    const snapPort = createSnapPort((x, capabilities) => {
      if (capabilities.includes('direction')) {
        return {
          id: 'axis',
          capability: 'direction',
          anchor: {
            snapshot: [0, 0, 0],
            accuracy: 'exact',
            semanticRef: { source: 'direction', candidateId: 'axis' },
          },
          direction: [0, 1, 0],
          label: 'Axis',
          distancePx: 1,
        };
      }
      return x < 2 ? point('a', [0, 0, 0]) : point('b', [1, 1, 0]);
    });
    const session = createProjectedEditSession(createInput(snapPort));

    session.pointerDown({ x: 1, y: 0 });
    session.pointerDown({ x: 2, y: 0 });
    session.pointerDown({ x: 3, y: 0 });

    expect(session.commit()).toMatchObject({
      record: {
        kind: 'projected',
        axis: {
          kind: 'semantic-direction',
          snapshot: [0, 1, 0],
          semanticRef: { source: 'direction', candidateId: 'axis' },
        },
      },
    });
  });

  it('locks three angular points and supports flipping the chosen arc', () => {
    const snapPort = createSnapPort(x => (
      x < 2
        ? point('vertex', [0, 0, 0])
        : x < 3
          ? point('ray-a', [1, 0, 0])
          : point('ray-b', [0, 1, 0])
    ));
    const session = createAngularEditSession(createInput(snapPort));

    session.pointerDown({ x: 1, y: 0 });
    session.pointerDown({ x: 2, y: 0 });
    session.pointerDown({ x: 3, y: 0 });
    session.flip();

    expect(session.commit()).toMatchObject({
      record: {
        kind: 'angular',
        placement: { arcChoice: 'major' },
      },
    });
  });

  it('creates a radial record from one exact circle candidate', () => {
    const circle: SnapCandidate = {
      id: 'circle',
      capability: 'circle',
      anchor: {
        snapshot: [2, 3, 4],
        accuracy: 'exact',
        semanticRef: { source: 'circle', candidateId: 'circle' },
      },
      direction: [0.5, 0, 0],
      normal: [0, 0, 1],
      label: 'Circle',
      distancePx: 1,
    };
    const session = createRadialEditSession(createInput(
      createSnapPort(() => circle),
    ));

    session.pointerDown({ x: 1, y: 0 });

    expect(session.phase).toBe('ready');
    expect(session.commit()).toMatchObject({
      record: {
        kind: 'radial',
        center: { snapshot: [2, 3, 4] },
        rim: { snapshot: [2.5, 3, 4] },
        normal: {
          kind: 'semantic-direction',
          snapshot: [0, 0, 1],
        },
      },
    });
  });

  it('supports manual radial center, rim, and Design-axis fallback', () => {
    const snapPort = createSnapPort(x =>
      x < 2 ? point('center', [0, 0, 0]) : point('rim', [0, 2, 0]),
    );
    const session = createRadialEditSession(createInput(snapPort));

    session.pointerDown({ x: 1, y: 0 });
    session.pointerDown({ x: 2, y: 0 });
    session.selectDesignAxis('z');

    expect(session.commit()).toMatchObject({
      record: {
        kind: 'radial',
        center: { snapshot: [0, 0, 0] },
        rim: { snapshot: [0, 2, 0] },
        normal: { kind: 'design-axis', axis: 'z' },
      },
    });
  });

  it('cancels without materializing a command', () => {
    const input = createInput(createSnapPort(() => point('a', [0, 0, 0])));
    const session = createLinearEditSession(input);

    session.pointerDown({ x: 1, y: 0 });
    session.cancel();

    expect(session.phase).toBe('cancelled');
    expect(session.commit()).toBeNull();
    expect(input.createCommandId).not.toHaveBeenCalled();
    expect(input.onPreview).toHaveBeenLastCalledWith(null);
  });

  it('previews placement movement and commits one replace-placement command', () => {
    const record = linearRecord({ id: 'linear-edit' });
    const onPreview = vi.fn();
    const session = createPlacementEditSession({
      record,
      actor: { actorId: 'designer-1', actorRole: 'designer' },
      createCommandId: () => 'replace-placement-1',
      now: () => 200,
      onPreview,
      placementAt: screen => ({
        offsetM: screen.y,
        labelT: screen.x,
        side: 1,
      }),
    });

    session.pointerMove({ x: 0.75, y: 0.4 });
    const command = session.commit();

    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'linear',
      placement: { offsetM: 0.4, labelT: 0.75, side: 1 },
    }));
    expect(command).toEqual({
      type: 'replace-placement',
      commandId: 'replace-placement-1',
      actorId: 'designer-1',
      actorRole: 'designer',
      at: 200,
      dimensionId: 'linear-edit',
      placement: { offsetM: 0.4, labelT: 0.75, side: 1 },
    });
  });

  it('rebinds one selected anchor slot through the snap port', () => {
    const record = linearRecord({ id: 'linear-rebind' });
    const onPreview = vi.fn();
    const session = createRebindEditSession({
      record,
      anchorSlot: 'b',
      snapPort: createSnapPort(() => point('replacement', [5, 0, 0])),
      actor: { actorId: 'designer-1', actorRole: 'designer' },
      createCommandId: () => 'rebind-1',
      now: () => 300,
      onPreview,
    });
    expect(session).not.toBeNull();

    session?.pointerMove({ x: 1, y: 1 });
    session?.pointerDown({ x: 1, y: 1 });

    expect(session?.commit()).toMatchObject({
      type: 'rebind-anchor',
      commandId: 'rebind-1',
      dimensionId: 'linear-rebind',
      anchorSlot: 'b',
      anchor: { snapshot: [5, 0, 0] },
    });
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({
      b: [5, 0, 0],
    }));
  });
});
