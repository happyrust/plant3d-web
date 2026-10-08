/** 校审/本机快照仅包含 JSON 数据，脱离响应对象和 Vue 响应式对象。 */
export function cloneResultSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
