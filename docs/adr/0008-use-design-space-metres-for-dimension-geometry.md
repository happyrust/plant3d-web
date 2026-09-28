# 尺寸几何统一使用 Design Space 米制坐标

所有规范化尺寸语义、锚点快照和持久化位置统一使用以米为单位且未应用 viewer recenter 的 Design Space。各来源适配器负责把 source-local 坐标、毫米单位和来源矩阵转换到 Design Space；呈现内核显式接收 `designToWorld` 与相机完成视图布局，场景 world、相机和重心平移不得写回领域记录。该约束牺牲适配器的局部便利，以消除旧实现中 local、world、design 及单位混用导致的漂移和恢复错误。
