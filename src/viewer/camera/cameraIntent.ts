/**
 * 相机取景意图的收口。
 *
 * 取景在 plant3d-web 里全是异步的：定位等模型装进场景、房间聚焦等成员清单、空间查询等批量加载、
 * 房间视图等房间体落地。这些路径互不相识，晚落地的那一笔会把相机从用户最新那一下上拽走
 * （plant-ui `fix(focus)` 系列 `e9ef12c99` 修的就是同一件事）。
 *
 * 做法：每次「用户发起了一次取景」就 `beginCameraIntent()` 拿一个戳，**在途的旧意图立刻作废**；
 * 异步路径在 `await` 之前取戳、落地后 `isCameraIntentCurrent(stamp)` 问一次，不current 就只改场景不动相机。
 *
 * 与任务回执守卫（`draftSession.isTransientReceiptCurrent`）不是一回事，两者要同时留着：
 * 那个管「这条任务回执还该不该生效」（高亮 / 选中 / 相机一起），这个只管「相机还该不该动」。
 */

let cameraIntentSeq = 0;

/** 登记一次新的取景意图，返回戳。所有更早的意图随即作废。 */
export function beginCameraIntent(): number {
  cameraIntentSeq += 1;
  return cameraIntentSeq;
}

/** 当前意图戳，不登记。异步路径在 `await` 之前用它盖戳。 */
export function currentCameraIntent(): number {
  return cameraIntentSeq;
}

/** 落地时问一次：期间用户有没有发起过更新的意图。 */
export function isCameraIntentCurrent(stamp: number): boolean {
  return stamp === cameraIntentSeq;
}

/**
 * 作废所有在途意图，自己不登记。
 * 用于「用户直接动了相机」这类不该被任何在途取景覆盖的场合：视图适应、Home、手动 orbit。
 */
export function supersedeCameraIntents(): void {
  cameraIntentSeq += 1;
}

/** 仅供测试：把序号复位，免得用例之间互相干扰。 */
export function __resetCameraIntentForTests(): void {
  cameraIntentSeq = 0;
}
