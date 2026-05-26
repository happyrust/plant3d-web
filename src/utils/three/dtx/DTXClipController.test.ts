import { describe, expect, it } from 'vitest';

import { buildRoomClipUniformPayload, type RoomClipPayload } from './DTXClipController';

describe('buildRoomClipUniformPayload', () => {
  it('expands one AABB room into six clipping planes', () => {
    const rooms: RoomClipPayload[] = [
      {
        mode: 'aabb',
        room_refno: 'room-a',
        aabb_min: [1, 2, 3],
        aabb_max: [4, 5, 6],
      },
    ];

    const payload = buildRoomClipUniformPayload(rooms);

    expect(payload.enabled).toBe(true);
    expect(payload.roomCount).toBe(1);
    expect(payload.shapeCount).toBe(1);
    expect(payload.planeCount).toBe(6);
    expect(payload.shapePlaneStarts[0]).toBe(0);
    expect(payload.shapePlaneCounts[0]).toBe(6);
    expect(payload.planes.slice(0, 6)).toEqual([
      [1, 0, 0, 4],
      [-1, 0, 0, -1],
      [0, 1, 0, 5],
      [0, -1, 0, -2],
      [0, 0, 1, 6],
      [0, 0, -1, -3],
    ]);
  });

  it('keeps convex hull planes as independent clipping shapes', () => {
    const rooms: RoomClipPayload[] = [
      {
        mode: 'convex_hulls',
        room_refno: 'room-l',
        aabb_min: [0, 0, 0],
        aabb_max: [10, 10, 5],
        hulls: [
          {
            aabb_min: [0, 0, 0],
            aabb_max: [5, 10, 5],
            planes: [[1, 0, 0, 5]],
          },
          {
            aabb_min: [5, 0, 0],
            aabb_max: [10, 5, 5],
            planes: [[-1, 0, 0, -5]],
          },
        ],
      },
    ];

    const payload = buildRoomClipUniformPayload(rooms);

    expect(payload.shapeCount).toBe(2);
    expect(payload.planeCount).toBe(2);
    expect(payload.shapePlaneStarts.slice(0, 2)).toEqual([0, 1]);
    expect(payload.shapePlaneCounts.slice(0, 2)).toEqual([1, 1]);
    expect(payload.planes.slice(0, 2)).toEqual([
      [1, 0, 0, 5],
      [-1, 0, 0, -5],
    ]);
  });

  it('uses SDF rooms as AABB fallback for the visual MVP', () => {
    const payload = buildRoomClipUniformPayload([
      {
        mode: 'sdf',
        room_refno: 'room-sdf',
        aabb_min: [-1, -2, -3],
        aabb_max: [1, 2, 3],
        resolution: [64, 64, 64],
        sdf_url: '/sdf/room-sdf.bin',
      },
    ]);

    expect(payload.shapeCount).toBe(1);
    expect(payload.planeCount).toBe(6);
    expect(payload.shapeAabbMins[0]).toEqual([-1, -2, -3]);
    expect(payload.shapeAabbMaxs[0]).toEqual([1, 2, 3]);
  });
});
