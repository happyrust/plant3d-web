# 用户尺寸随校审记录持久化

用户尺寸的权威状态随 review/workflow snapshot 保存到后端，并参与确认、恢复、导出和回放的完整往返；浏览器 local storage 或 IndexedDB 只缓存未提交 draft 与 command log，用于故障恢复。MBD 等外部尺寸始终从其来源重新加载，保持只读且不复制进用户尺寸文档。该选择避免尺寸再次成为校审记录之外的本地孤岛，同时不引入独立尺寸 REST 资源。
