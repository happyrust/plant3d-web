import { describe, expect, it } from 'vitest';

import { clusterPins, type PinClusterItem } from './cluster';

const OPTS = { joinRadiusPx: 28, stayRadiusPx: 40, minSize: 2 };

function item(id: string, x: number, y: number): PinClusterItem {
  return { id, x, y };
}

describe('clusterPins', () => {
  it('相距超过 joinRadius 的图钉各自独立：没有聚合、seedOf 为空', () => {
    const r = clusterPins([item('a', 0, 0), item('b', 100, 0), item('c', 0, 100)], null, OPTS);
    expect(r.clusters).toEqual([]);
    expect(r.seedOf.size).toBe(0);
  });

  it('够近的合成一簇：种子 = id 最小者，成员按 id 排序，徽标在质心；非有限坐标被忽略', () => {
    const r = clusterPins([item('c', 20, 0), item('a', 0, 0), item('b', 10, 10), item('nan', Number.NaN, 0)], null, OPTS);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]).toEqual({ seedId: 'a', x: 10, y: 10 / 3, memberIds: ['a', 'b', 'c'] });
    expect([...r.seedOf.entries()]).toEqual([['a', 'a'], ['b', 'a'], ['c', 'a']]);
  });

  it('按种子半径归簇、不传递：a–b 20、b–c 20 但 a–c 40 → {a,b} 一簇，c 单独', () => {
    const r = clusterPins([item('a', 0, 0), item('b', 20, 0), item('c', 40, 0)], null, OPTS);
    expect(r.clusters.map((c) => c.memberIds)).toEqual([['a', 'b']]);
    expect(r.seedOf.has('c')).toBe(false);
  });

  it('滞回：上一帧已在簇里的成员离种子 ≤ stayRadius 就留下；同样距离的新成员不加入', () => {
    const prev = new Map([['a', 'a'], ['b', 'a']]);
    // b 漂到 35 px（> join 28、≤ stay 40）；c 是新来的，也在 35 px
    const r = clusterPins([item('a', 0, 0), item('b', 35, 0), item('c', 0, 35)], prev, OPTS);
    expect(r.clusters.map((c) => c.memberIds)).toEqual([['a', 'b']]);
    expect(r.seedOf.get('c')).toBeUndefined();

    // 漂出 stayRadius 才散
    const gone = clusterPins([item('a', 0, 0), item('b', 41, 0)], prev, OPTS);
    expect(gone.clusters).toEqual([]);
  });

  it('上一帧的种子优先立起来：即便 id 更小的成员先到，簇身份（seedId）与徽标位置都不换', () => {
    // 上一帧 b 是种子（a 那时还不在场）
    const prev = new Map([['b', 'b'], ['c', 'b']]);
    const r = clusterPins([item('a', 5, 0), item('b', 0, 0), item('c', 20, 0)], prev, OPTS);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]!.seedId).toBe('b');
    expect(r.clusters[0]!.memberIds).toEqual(['a', 'b', 'c']);
  });

  it('minSize：不足的不成簇；上一帧的种子如今孤身一人也只是普通图钉', () => {
    const prev = new Map([['a', 'a'], ['b', 'a']]);
    const r = clusterPins([item('a', 0, 0), item('b', 200, 0)], prev, { ...OPTS, minSize: 2 });
    expect(r.clusters).toEqual([]);
    const three = clusterPins([item('a', 0, 0), item('b', 5, 0)], null, { ...OPTS, minSize: 3 });
    expect(three.clusters).toEqual([]);
  });

  it('确定性：输入顺序打乱结果一致', () => {
    const items = [item('d', 300, 300), item('a', 0, 0), item('c', 12, 0), item('b', 6, 0), item('e', 310, 300)];
    const r1 = clusterPins(items, null, OPTS);
    const r2 = clusterPins([...items].reverse(), null, OPTS);
    expect(r2).toEqual(r1);
    expect(r1.clusters.map((c) => c.seedId)).toEqual(['a', 'd']);
  });
});
