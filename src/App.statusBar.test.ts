/**
 * 底部状态栏不被全局提示条压住（源码钉）。
 *
 * 提示条的位置是样式定的，单测环境里没有排版，量不出「压没压住」——那由浏览器回放去量
 * （`docs/verification/model-getwork-2026-11-12/`：提示条与状态栏的矩形不相交，「重载」「忽略」「取最新」正中那一点上
 * 最上面的元素是按钮自己）。这里钉住的是两件对得上的事：状态栏有多高、提示条被抬了多高。改了一边忘了另一边，这里会红。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, 'App.vue'), 'utf8');
const template = source.slice(source.indexOf('<template>'), source.lastIndexOf('</template>'));
const style = source.slice(source.lastIndexOf('<style>'));

/** Tailwind 的 `h-N` 是 N × 0.25rem */
function remOfTailwindHeight(classes: string): number | null {
  const match = classes.match(/(?:^|\s)h-(\d+(?:\.\d+)?)(?:\s|$)/);
  return match ? Number(match[1]) * 0.25 : null;
}

describe('底部状态栏与全局提示条（源码钉）', () => {
  const bar = template.match(/<div class="([^"]*)"\s+data-testid="app-status-bar">/);

  it('状态栏在：一条固定高度的横条，里面是连接徽标（带「数据已更新」的提示）和钉在最右端的「取最新」', () => {
    expect(bar).not.toBeNull();
    expect(remOfTailwindHeight(bar![1]!)).toBe(1.75);
    const inside = template.slice(template.indexOf('data-testid="app-status-bar"'));
    expect(inside.indexOf('<GenModelV1HealthBadge />')).toBeGreaterThan(-1);
    expect(inside.indexOf('<ModelGetWorkButton class="ml-auto pl-2" />')).toBeGreaterThan(inside.indexOf('<GenModelV1HealthBadge />'));
  });

  it('画在底部的提示条抬到状态栏上面：下边距不小于状态栏的高度', () => {
    const rule = style.match(/\.v-snackbar:not\(\.v-snackbar--top\):not\(\.v-snackbar--center\)\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const lift = rule![1]!.match(/margin-bottom:\s*calc\((\d+(?:\.\d+)?)rem \+ (\d+)px\);/);
    expect(lift).not.toBeNull();
    expect(Number(lift![1])).toBeGreaterThanOrEqual(remOfTailwindHeight(bar![1]!)!);
    // 状态栏和提示条之间留着缝（Vuetify 原有的那 8px），不贴着
    expect(Number(lift![2])).toBeGreaterThanOrEqual(8);
  });

  it('这条规则是全局的（不带 scoped）：提示条是挂到页面最外层去画的，带 scoped 的样式够不着它', () => {
    expect(source).not.toMatch(/<style[^>]*\bscoped\b/);
  });
});
