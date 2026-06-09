# 联调会话报告: webapp

> 生成时间: 2026/6/9 09:15:16

## 会话信息

| 项目 | 内容 |
|------|------|
| 会话名称 | webapp |
| 开始时间 | 2026/6/9 08:54:09 |
| 结束时间 | 进行中 |
| 持续时间 | 21分6秒 |
| 操作记录 | 10 条 |
| 接口请求 | 0 条 |
| Base URL | /api |

## 操作历史

| 时间 | 类型 | 命令 | 详情 |
|------|------|------|------|
| 08:54:27 | route add | `C:\Program Files\nodejs\node.exe D:\code\TraeProjects\1044\dist\index.js route add GET /api/test --description 测试路径规范化` | {"method":"GET","path":"/test","fullPath":"/api/te... |
| 08:58:31 | case update | `C:\Program Files\nodejs\node.exe D:\code\TraeProjects\1044\dist\index.js case add GET /test high_page --body {page:high,code:0} --query-condition page>5 -f` | {"method":"GET","path":"/test","fullPath":"/api/te... |
| 08:58:45 | debug | `C:\Program Files\nodejs\node.exe D:\code\TraeProjects\1044\dist\index.js debug GET /test -q page=10` | {"method":"GET","path":"/test","fullPath":"/api/te... |
| 08:58:55 | debug | `C:\Program Files\nodejs\node.exe D:\code\TraeProjects\1044\dist\index.js debug GET /test -q page=3` | {"method":"GET","path":"/test","fullPath":"/api/te... |
| 09:13:10 | case add | `C:\Program Files\nodejs\node.exe D:\code\TraeProjects\1044\dist\index.js case add GET /test no_params --body {status:no_params} -f` | {"method":"GET","path":"/test","fullPath":"/api/te... |
| 09:13:38 | debug | `C:\Program Files\nodejs\node.exe D:\code\TraeProjects\1044\dist\index.js debug GET /test` | {"method":"GET","path":"/test","fullPath":"/api/te... |
| 09:13:48 | debug | `C:\Program Files\nodejs\node.exe D:\code\TraeProjects\1044\dist\index.js debug GET /test -q page=1` | {"method":"GET","path":"/test","fullPath":"/api/te... |
| 09:14:36 | record list | `C:\Program Files\nodejs\node.exe D:\code\TraeProjects\1044\dist\index.js record list` | {"count":2,"total":2} |
| 09:14:47 | record show | `C:\Program Files\nodejs\node.exe D:\code\TraeProjects\1044\dist\index.js record show rec_test_001` | {"recordId":"rec_test_001","method":"GET","path":"... |
| 09:15:04 | record export | `C:\Program Files\nodejs\node.exe D:\code\TraeProjects\1044\dist\index.js record export -f markdown -o test_records.md` | {"count":2,"format":"markdown","output":"D:\\code\... |

## 场景匹配详细分析

### GET /api/test

> **时间**: 2026/6/9 09:13:38

| 场景 | 命中 | 原因 | 详细条件 |
|------|------|------|----------|
| default | ❌ | 无匹配条件，跳过条件匹配 | - |
| high_page | ❌ | 条件不匹配: query | query: page 参数不存在 |
| no_params | ✅ | 条件对象为空，且请求无 query、无 body，匹配成功 | - |

> **最终命中**: no_params - 条件匹配成功，使用场景: no_params

### GET /api/test

> **时间**: 2026/6/9 09:13:48
> **Query**: `{"page":1}`

| 场景 | 命中 | 原因 | 详细条件 |
|------|------|------|----------|
| default | ❌ | 无匹配条件，跳过条件匹配 | - |
| high_page | ❌ | 条件不匹配: query | query: page 值不大于: 1 <= 5 |
| no_params | ❌ | 条件对象为空，但请求有参数: query 不为空，不匹配 | - |

> **最终命中**: default - 使用当前激活场景: default

---

> 报告由 Mock API CLI 自动生成