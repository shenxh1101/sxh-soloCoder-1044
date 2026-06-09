# mock-api-project

## 快速开始

```bash
# 新增路由（路径相对于 baseUrl: /api）
mock route add GET /users
# 完整访问路径: /api/users

# 新增响应场景
mock case add GET /users success --body '{"code":0,"data":[]}'

# 启动服务
mock serve
```
