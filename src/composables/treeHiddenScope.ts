/**
 * 重载（取最新、行上 / 状态栏的「重载」）定新增的构件显不显示时，装载流程向模型树问的一句话：
 * 「这个节点下面，树上藏着的那几个节点名下现在有哪些构件」。
 *
 * 为什么要问：场景的状态表记的是「哪些构件被藏了」，记不住「哪个树节点被藏了」。节点只藏了一部分（藏了它下面的
 * 一根管线）时，那根管线下面新增的构件在状态表里没有记录——除非那一层在树里取进来过（树按父节点的勾选态先记了一笔）。
 * 树知道哪些节点藏着，按祖先查得到它们名下现在的构件。
 *
 * 模型树面板挂上时登记，卸载时撤。没有树（没登记）、节点没有藏着的部分、问的过程出了错、问到一半被叫停，都回 `null`：
 * 装载流程照原来的规则走。单独一个模块：装载流程和模型树互不引用，各自只引这里。
 */
export type TreeHiddenScope = {
  /** 藏着的节点名下现在的构件（含藏着的节点自己），`a_b` */
  refnos: ReadonlySet<string>;
  /** 没查到的藏着的节点（请求失败）：它们名下新增的构件定不了 */
  failed: readonly string[];
};

export type TreeHiddenScopeProvider = (root: string, signal?: AbortSignal) => Promise<TreeHiddenScope | null>;

let provider: TreeHiddenScopeProvider | null = null;

/** 模型树登记自己；回的函数在面板卸载时调。后登记的顶掉先登记的（同时只有一棵 PDMS 树）。 */
export function provideTreeHiddenScope(next: TreeHiddenScopeProvider): () => void {
  provider = next;
  return () => {
    if (provider === next) provider = null;
  };
}

/**
 * 问一次。`signal` 是装载会话的叫停信号：叫停时当场回 `null`，不等树那边在途的查询（它们的结果不要了）。
 * 不会抛错。
 */
export function queryTreeHiddenScope(root: string, signal?: AbortSignal): Promise<TreeHiddenScope | null> {
  const current = provider;
  if (!current || signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const onAbort = (): void => resolve(null);
    signal?.addEventListener('abort', onAbort, { once: true });
    Promise.resolve()
      .then(() => current(root, signal))
      .catch((error: unknown) => {
        console.warn('[tree-hidden-scope] 没问到树上藏着的部分，新增的构件照原来的规则显示:', error);
        return null;
      })
      .then((scope) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(scope);
      });
  });
}
