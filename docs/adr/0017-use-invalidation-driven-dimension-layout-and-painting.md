# 尺寸布局与绘制采用失效驱动

`DimensionViewport` 对文档、相机矩阵、视口尺寸与 DPR、主题及交互状态分别记录脏原因，并用 `requestAnimationFrame` 把同一帧内的变化合并为一次 layout → collision → paint；静止视图不执行尺寸布局或绘制工作。该选择增加失效管理与调度测试，但避免在 viewer 每帧无条件计算字形、碰撞和全部图元。
