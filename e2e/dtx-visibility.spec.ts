import { test, expect } from '@playwright/test';

/**
 * DTX 模型显示/隐藏 E2E 测试
 *
 * 使用 primitives demo 模式（不依赖后端），通过 window.__xeokitViewer / __dtxLayer
 * 验证 DTXLayer、DtxCompatScene 的可见性控制链路。
 */

const DEMO_OBJECTS = 50;
const DEMO_URL = `/?dtx_demo=primitives&dtx_demo_count=${DEMO_OBJECTS}`;

/** 等待 DTXLayer 编译完成并返回 stats */
async function waitForDtxReady(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => {
      const v = (window as any).__xeokitViewer;
      const layer = v && v.__dtxLayer;
      if (!layer || typeof layer.getStats !== 'function') return false;
      const stats = layer.getStats();
      return !!stats && stats.compiled === true && Number(stats.totalObjects) > 0;
    },
    null,
    { timeout: 60_000 },
  );
}

// ---------- 辅助：在浏览器内读取对象可见性 ----------

/** 读取 DTXLayer 内部对象的 visible 字段 */
function evalObjectVisible(page: import('@playwright/test').Page, objectId: string) {
  return page.evaluate((id) => {
    const v = (window as any).__xeokitViewer;
    const layer = v?.__dtxLayer;
    const obj = layer?.getObject?.(id);
    return obj ? obj.visible : null;
  }, objectId);
}

/** 批量读取多个对象的 visible */
function evalObjectsVisible(page: import('@playwright/test').Page, objectIds: string[]) {
  return page.evaluate((ids) => {
    const v = (window as any).__xeokitViewer;
    const layer = v?.__dtxLayer;
    if (!layer) return null;
    const result: Record<string, boolean> = {};
    for (const id of ids) {
      const obj = layer.getObject?.(id);
      if (obj) result[id] = obj.visible;
    }
    return result;
  }, objectIds);
}

/** 读取 colorsAndFlagsBuffer 中的可见性标志字节 */
function evalBufferVisibleFlag(page: import('@playwright/test').Page, objectId: string) {
  return page.evaluate((id) => {
    const v = (window as any).__xeokitViewer;
    const layer = v?.__dtxLayer;
    const obj = layer?.getObject?.(id);
    if (!obj || !layer._colorsAndFlagsBuffer) return null;
    const flagsOffset = obj.objectIndex * 16 + 2;
    return layer._colorsAndFlagsBuffer[flagsOffset];
  }, objectId);
}

// ================================================================
// 测试用例
// ================================================================

test.describe('DTX 可见性控制', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
    await waitForDtxReady(page);
  });

  test('初始状态：所有对象默认可见', async ({ page }) => {
    const ids = Array.from({ length: 5 }, (_, i) => `demo:${i}`);
    const visMap = await evalObjectsVisible(page, ids);

    expect(visMap).not.toBeNull();
    for (const id of ids) {
      expect(visMap![id]).toBe(true);
    }
  });

  test('DTXLayer.setObjectVisible：隐藏单个对象', async ({ page }) => {
    const targetId = 'demo:0';

    // 隐藏
    await page.evaluate((id) => {
      const layer = (window as any).__xeokitViewer?.__dtxLayer;
      layer?.setObjectVisible(id, false);
    }, targetId);

    // 验证内部状态
    expect(await evalObjectVisible(page, targetId)).toBe(false);
    // 验证 GPU 缓冲区标志
    expect(await evalBufferVisibleFlag(page, targetId)).toBe(0);

    // 相邻对象不受影响
    expect(await evalObjectVisible(page, 'demo:1')).toBe(true);
  });

  test('DTXLayer.setObjectVisible：隐藏后再显示', async ({ page }) => {
    const targetId = 'demo:3';

    // 隐藏
    await page.evaluate((id) => {
      const layer = (window as any).__xeokitViewer?.__dtxLayer;
      layer?.setObjectVisible(id, false);
    }, targetId);
    expect(await evalObjectVisible(page, targetId)).toBe(false);
    expect(await evalBufferVisibleFlag(page, targetId)).toBe(0);

    // 再显示
    await page.evaluate((id) => {
      const layer = (window as any).__xeokitViewer?.__dtxLayer;
      layer?.setObjectVisible(id, true);
    }, targetId);
    expect(await evalObjectVisible(page, targetId)).toBe(true);
    expect(await evalBufferVisibleFlag(page, targetId)).toBe(1);
  });

  test('DTXLayer.setObjectsVisible：批量隐藏', async ({ page }) => {
    const targets = ['demo:0', 'demo:1', 'demo:2'];
    const others = ['demo:3', 'demo:4'];

    await page.evaluate((ids) => {
      const layer = (window as any).__xeokitViewer?.__dtxLayer;
      layer?.setObjectsVisible(ids, false);
    }, targets);

    const allIds = [...targets, ...others];
    const visMap = await evalObjectsVisible(page, allIds);
    expect(visMap).not.toBeNull();

    for (const id of targets) {
      expect(visMap![id]).toBe(false);
    }
    for (const id of others) {
      expect(visMap![id]).toBe(true);
    }
  });

  test('DTXLayer.setAllVisible(false)：全部隐藏', async ({ page }) => {
    await page.evaluate(() => {
      const layer = (window as any).__xeokitViewer?.__dtxLayer;
      layer?.setAllVisible(false);
    });

    // 抽样检查
    const sampleIds = Array.from({ length: 10 }, (_, i) => `demo:${i}`);
    const visMap = await evalObjectsVisible(page, sampleIds);
    expect(visMap).not.toBeNull();
    for (const id of sampleIds) {
      expect(visMap![id]).toBe(false);
    }
  });

  test('DTXLayer.setAllVisible：全部隐藏后全部恢复', async ({ page }) => {
    // 全部隐藏
    await page.evaluate(() => {
      const layer = (window as any).__xeokitViewer?.__dtxLayer;
      layer?.setAllVisible(false);
    });

    // 全部恢复
    await page.evaluate(() => {
      const layer = (window as any).__xeokitViewer?.__dtxLayer;
      layer?.setAllVisible(true);
    });

    const sampleIds = Array.from({ length: 10 }, (_, i) => `demo:${i}`);
    const visMap = await evalObjectsVisible(page, sampleIds);
    expect(visMap).not.toBeNull();
    for (const id of sampleIds) {
      expect(visMap![id]).toBe(true);
    }
  });

  test('GPU 缓冲区与对象状态一致性', async ({ page }) => {
    // 隐藏偶数对象
    const evenIds = Array.from({ length: 5 }, (_, i) => `demo:${i * 2}`);
    await page.evaluate((ids) => {
      const layer = (window as any).__xeokitViewer?.__dtxLayer;
      layer?.setObjectsVisible(ids, false);
    }, evenIds);

    // 逐个验证 buffer 与 object 状态一致
    const result = await page.evaluate((ids) => {
      const layer = (window as any).__xeokitViewer?.__dtxLayer;
      if (!layer) return null;
      const checks: { id: string; objVisible: boolean; bufferFlag: number }[] = [];
      for (const id of ids) {
        const obj = layer.getObject(id);
        if (!obj) continue;
        const flagsOffset = obj.objectIndex * 16 + 2;
        checks.push({
          id,
          objVisible: obj.visible,
          bufferFlag: layer._colorsAndFlagsBuffer[flagsOffset],
        });
      }
      return checks;
    }, evenIds);

    expect(result).not.toBeNull();
    for (const check of result!) {
      expect(check.objVisible).toBe(false);
      expect(check.bufferFlag).toBe(0);
    }
  });
});

test.describe('DtxCompatScene 可见性控制', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
    await waitForDtxReady(page);
  });

  test('scene.setObjectsXRayed：隔离模式隐藏对象', async ({ page }) => {
    // 获取所有 objectIds
    const allIds = await page.evaluate(() => {
      const v = (window as any).__xeokitViewer;
      return v?.scene?.objectIds ?? [];
    });

    // 如果 compat scene 没有注册对象（primitives demo 不走 compat），跳过
    if (!allIds || allIds.length === 0) {
      // primitives demo 的 objectId 格式是 demo:N，不是 refno，
      // compat scene 不会自动注册它们。
      // 手动 ensureRefnos 后测试 xray 逻辑
      await page.evaluate(() => {
        const v = (window as any).__xeokitViewer;
        if (!v?.scene) return;
        // 注册几个 demo objectId 到 compat scene（模拟 refno 注册）
        v.scene.ensureRefnos(['demo:0', 'demo:1', 'demo:2'], { computeAabb: false });
      });

      // xray demo:0 和 demo:1
      await page.evaluate(() => {
        const v = (window as any).__xeokitViewer;
        v?.scene?.setObjectsXRayed(['demo:0', 'demo:1'], true);
      });

      // 验证 compat state
      const states = await page.evaluate(() => {
        const v = (window as any).__xeokitViewer;
        const objs = v?.scene?.objects;
        if (!objs) return null;
        return {
          demo0: { visible: objs['demo:0']?.visible, xrayed: objs['demo:0']?.xrayed },
          demo1: { visible: objs['demo:1']?.visible, xrayed: objs['demo:1']?.xrayed },
          demo2: { visible: objs['demo:2']?.visible, xrayed: objs['demo:2']?.xrayed },
        };
      });

      expect(states).not.toBeNull();
      // xrayed=true 的对象 visible 应为 false
      expect(states!.demo0.xrayed).toBe(true);
      expect(states!.demo0.visible).toBe(false);
      expect(states!.demo1.xrayed).toBe(true);
      expect(states!.demo1.visible).toBe(false);
      // 未 xray 的对象保持原状
      expect(states!.demo2.xrayed).toBe(false);
    }
  });

  test('scene.setObjectsXRayed：取消隔离恢复可见', async ({ page }) => {
    await page.evaluate(() => {
      const v = (window as any).__xeokitViewer;
      if (!v?.scene) return;
      v.scene.ensureRefnos(['demo:5', 'demo:6'], { computeAabb: false });
      // 先 xray
      v.scene.setObjectsXRayed(['demo:5', 'demo:6'], true);
    });

    // 取消 xray
    await page.evaluate(() => {
      const v = (window as any).__xeokitViewer;
      v?.scene?.setObjectsXRayed(['demo:5', 'demo:6'], false);
    });

    const states = await page.evaluate(() => {
      const v = (window as any).__xeokitViewer;
      const objs = v?.scene?.objects;
      if (!objs) return null;
      return {
        demo5: { visible: objs['demo:5']?.visible, xrayed: objs['demo:5']?.xrayed },
        demo6: { visible: objs['demo:6']?.visible, xrayed: objs['demo:6']?.xrayed },
      };
    });

    expect(states).not.toBeNull();
    expect(states!.demo5.xrayed).toBe(false);
    expect(states!.demo5.visible).toBe(true);
    expect(states!.demo6.xrayed).toBe(false);
    expect(states!.demo6.visible).toBe(true);
  });
});

test.describe('隐藏对象不可拾取', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
    await waitForDtxReady(page);
  });

  test('隐藏全部后 GPU picking 不命中', async ({ page }) => {
    // 先全部隐藏
    await page.evaluate(() => {
      const layer = (window as any).__xeokitViewer?.__dtxLayer;
      layer?.setAllVisible(false);
    });

    // 尝试在屏幕中心拾取
    const pickResult = await page.evaluate(() => {
      const v = (window as any).__xeokitViewer;
      const sel = v?.__dtxSelection;
      const canvas = document.querySelector('canvas.viewer') as HTMLCanvasElement;
      if (!sel || !canvas) return { ok: false, error: 'missing selection/canvas' };

      const rect = canvas.getBoundingClientRect();
      const x = rect.width * 0.5;
      const y = rect.height * 0.5;
      const res = sel.pick?.({ x, y });
      return { ok: true, hit: res?.objectId ?? null };
    });

    // 隐藏后不应命中任何对象
    if (pickResult.ok) {
      expect(pickResult.hit).toBeNull();
    }
  });
});
