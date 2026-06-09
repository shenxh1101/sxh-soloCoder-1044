# 联调会话报告: webapp

> 生成时间: 2026/6/9 08:59:27

## 会话信息

| 项目 | 内容 |
|------|------|
| 会话名称 | webapp |
| 开始时间 | 2026/6/9 08:54:09 |
| 结束时间 | 进行中 |
| 持续时间 | 5分17秒 |
| 操作记录 | 4 条 |
| 接口请求 | 0 条 |
| Base URL | /api |

## 操作历史

| 时间 | 类型 | 命令 | 详情 |
|------|------|------|------|
| 08:54:27 | route add | `C:\Program Files\nodejs\node.exe D:\code\TraeProjects\1044\dist\index.js route add GET /api/test --description 测试路径规范化` | {"method":"GET","path":"/test","fullPath":"/api/te... |
| 08:58:31 | case update | `C:\Program Files\nodejs\node.exe D:\code\TraeProjects\1044\dist\index.js case add GET /test high_page --body {page:high,code:0} --query-condition page>5 -f` | {"method":"GET","path":"/test","fullPath":"/api/te... |
| 08:58:45 | debug | `C:\Program Files\nodejs\node.exe D:\code\TraeProjects\1044\dist\index.js debug GET /test -q page=10` | {"method":"GET","path":"/test","fullPath":"/api/te... |
| 08:58:55 | debug | `C:\Program Files\nodejs\node.exe D:\code\TraeProjects\1044\dist\index.js debug GET /test -q page=3` | {"method":"GET","path":"/test","fullPath":"/api/te... |

---

> 报告由 Mock API CLI 自动生成