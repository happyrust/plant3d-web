# 尺寸标注系统采用文档/视口分离的意图级 API

新尺寸标注系统分为 `DimensionDocument` 与 `DimensionViewport`：文档通过注入的 repository 管理用户尺寸、draft、共享选择、命令历史和异步恢复日志，视口管理相机相关布局、局部悬停、命中索引与 Canvas 画家资源。调用方使用分阶段的尺寸意图与编辑会话，核心以纯 command/event reducer 作为统一状态转换和测试 seam；来源适配器声明强类型 capability，通用 UI 只能执行系统返回的 bound actions，避免绕过来源所有权。

该选择接受较大的类型表面和一层 facade 成本，换取不完整 draft 在编译期不可提交、核心与 Vue/DOM/Three.js 解耦、多视口共享同一尺寸文档，以及用户尺寸、外部/MBD 尺寸在同一呈现系统中仍保持不同生命周期。原始指针事件由可选 `DimensionPointerController` 适配，预期业务失败使用可判别 `Result`，而不是静默忽略或把常见交互失败当异常。
