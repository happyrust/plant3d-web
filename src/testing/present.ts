/**
 * 从「可能为空」的容器里取值。测试里 `arr[0]`、`map.get(k)` 这类访问在
 * `noUncheckedIndexedAccess` 下都带 undefined，用非空断言 `!` 会把「真的取不到」
 * 也一起静音；这里改成取值即断言，缺了就当场抛错并带上位置说明。
 */
export function present<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${what} to be present`);
  }
  return value;
}
