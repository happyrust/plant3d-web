# Pencil 导出快照（当前画布）

说明：当前 `pencil` MCP 在本环境中不会自动写入本地 `.pen` 文件，下面是从当前画布直接导出的节点快照（`readDepth=3`）。

```json
[{"children":[{"content":"Task Creation Panel / Shadcn Engineering Console","fill":"#111827","fontFamily":"Inter","fontSize":18,"fontWeight":"600","id":"ggFUC","name":"rootTitle","type":"text"},{"children":[{"children":[{"children":"...","clip":true,"gap":10,"height":"fill_container","id":"OWYsx","layout":"vertical","name":"Panel Body","padding":12,"type":"frame","width":"fill_container"},{"children":"...","fill":"#FAFAFA","gap":8,"id":"McuYA","layout":"vertical","name":"Sticky Footer","padding":12,"stroke":{"align":"inside","fill":"#E4E4E7","thickness":1},"type":"frame","width":"fill_container"}],"clip":true,"cornerRadius":10,"fill":"#FFFFFF","height":"fill_container","id":"yi6y5","justifyContent":"space_between","layout":"vertical","name":"Narrow 360","stroke":{"align":"inside","fill":"#E4E4E7","thickness":1},"type":"frame","width":360},{"children":[{"children":"...","clip":true,"gap":10,"height":"fill_container","id":"xEadA","layout":"vertical","name":"Panel Body","padding":12,"type":"frame","width":"fill_container"},{"children":"...","fill":"#FAFAFA","gap":8,"id":"prfjW","layout":"vertical","name":"Sticky Footer","padding":12,"stroke":{"align":"inside","fill":"#E4E4E7","thickness":1},"type":"frame","width":"fill_container"}],"clip":true,"cornerRadius":10,"fill":"#FFFFFF","height":"fill_container","id":"jWLin","justifyContent":"space_between","layout":"vertical","name":"Wide Adaptive","stroke":{"align":"inside","fill":"#E4E4E7","thickness":1},"type":"frame","width":"fill_container"}],"gap":16,"height":"fill_container","id":"NPoEp","name":"Adaptive States","type":"frame","width":"fill_container"}],"clip":true,"fill":"#F4F4F5","gap":16,"height":960,"id":"bi8Au","layout":"vertical","name":"TaskCreationPanel Shadcn","padding":16,"type":"frame","width":1200,"x":0,"y":0}]
```

## 关键节点

- 根画布：`bi8Au`
- 窄栏：`yi6y5`
- 宽栏：`jWLin`

