# MBD 数据只经冻结的 V2 契约形状进入适配层

MBD 外部图元适配层只接受 `MbdV2PipeData` 契约形状：实时通道按 refno 调用 plant-web-server API；离线 parquet 通道保留，但装载后先转换成同一契约形状再进入适配层，自定义的 `MbdDimensionDto` 形状逐步退役。契约测试 fixture 直接采用 rs-mbd 导出的 JSON，使上游契约漂移第一时间在前端测试中暴露。代价是 parquet 导出侧需要按契约补齐非线性图元列，短期内 parquet 通道仅覆盖线性尺寸。被否决的替代：为 parquet 与 API 维护两套适配入口（双份映射与测试）、废弃 parquet 只留 API（丢失离线批量场景）。

依据：`rs-mbd/crates/rs-mbd/src/contract.rs`（冻结契约）、ADR 0041。
