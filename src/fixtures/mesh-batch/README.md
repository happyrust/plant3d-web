# 网格打包取的样本

## `sample-batch.bin` / `sample-batch.json`

`POST /api/v1/meshes/batch`（gen-model `docs/specs/web-service-api.md` §4.11.4）的一份真实响应体，勿手改。
请求是 `{ "keys": ["1", "no_such_mesh", "2", "3"] }`：三个有内容的帧（状态 0）和一个不存在的键（状态 1）。

- 来源：gen-model 后端 2026-11-10 在临时实例上录的，原件在
  `gen-model/output/model-load-20261110/a4-verify/`（那个目录被 git 忽略，所以拷一份进来）。
- `sample-batch.json` 记着每一帧的偏移、长度和内容的 sha256，`meshBatch.test.ts` 照它核对解码结果。
- 键 `1`、`3` 的内容与 `src/fixtures/meshes/1.mesh`、`3.mesh` 逐字节相同（规范：打包取到的内容与单个路由的响应体相同）。

格式变了（流头魔数的末位是格式版本）要重新录，不要改这两个文件。
