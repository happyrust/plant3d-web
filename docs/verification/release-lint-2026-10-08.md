# 前端发布规范检查清理（开发阶段）

本轮清理全仓 ESLint 的 27 项既有错误：调整导入顺序、为截图样例刻意空实现注明原因、移除模板字符串无效转义、辅助 CJS 脚本改用动态导入，并记录浏览器画布探测失败。没有修改检查规则或放宽类型基线。

验证命令：

```text
npm exec eslint -- . --ext .vue,.js,.jsx,.cjs,.mjs,.ts,.tsx,.cts,.mts
npm run type-check
npm test
node --check output/lactation-notes/render.cjs
node --check outputs/plant3d_plan_20260713/build_plan.mjs
node --check harness/review-annot.shots.mjs
node --check verify-bran-live.mjs
```

- ESLint：清理前 27 错误 / 18 警告；清理后 0 错误 / 16 警告。剩余警告为截图 harness 同文件多组件。
- 类型检查：503 条既有错误 / 136 文件，相对 539 条基线新增 0，门禁通过；并非全部类型错误已消除。
- 全量回归：338 文件 / 3119 项通过，与清理前相同。
- 四个辅助脚本语法检查通过；未运行脚本生成无关产物或触发真实业务操作。

这只是开发发布检查进展。CI 干净构建、产物来源与线上版本核对、真实 PMS、专业样例、回退恢复、19 项最终验收及签字仍待完成。
