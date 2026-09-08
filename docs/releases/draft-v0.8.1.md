# v0.8.1

> 发布时间：2026-09-08

v0.8.1 是一个小版本升级，核心变化：新增基于 SMTP 的邮箱密码重置功能，并集中修复了一批数据库字段与依赖安全问题。

---

## 从 v0.8.0 升级

> ⚠️ 升级前请**备份数据库**。本次包含 3 个数据库迁移（新表 + 字段变更），Docker 镜像启动时自动执行，源码用户需手动执行迁移。

### 新增环境变量（可选）

密码重置功能依赖 SMTP，未配置时功能不启用，不影响其他功能：

```bash
# 是否启用 SMTP，true-是，false-否
SMTP_ENABLED=false
# SMTP 服务器地址
SMTP_SERVER=smtp.example.com
# 465-隐式 TLS，587-STARTTLS
SMTP_PORT=465
# 邮箱
SMTP_USERNAME=noreply@example.com
# 邮箱设置中的授权码
SMTP_PASSWORD=your-app-password
# 是否使用 TLS 加密
SMTP_USE_TLS=true
# Display Name + Email
MAIL_DEFAULT_SEND_FROM="Dify App Hub <noreply@example.com>"
# 页面部署 Host
APP_URL=https://your-domain.example.com
```

### Docker 用户

```bash
docker pull lexmin0412/dify-app-hub:v0.8.1
# 更新 docker-compose.yml 中的镜像版本并按需追加 SMTP 配置
docker compose up -d
# 数据库迁移自动执行
```

### 源码用户

```bash
git checkout main && git pull
pnpm install
# 执行数据库迁移
pnpm --filter dify-app-hub db:migrate
# 构建并启动
pnpm build:app && pnpm start
```

---

## 🌟 新功能

- **邮箱密码重置**：登录页支持"忘记密码"，通过 SMTP 发送一次性重置链接完成密码找回。Closes #473
  - 仅存储 token 哈希，带过期时间与请求频率限制
  - 响应信息通用化，防止邮箱枚举攻击
  - 重置成功后自动使已有 JWT 会话失效（`users.session_version`）

---

## 🐛 问题修复

- 修复 `users.updated_at` 列缺默认值导致插入失败。Close #471（感谢 @potofo）
- 扩展 `dify_apps` / `users` 表字段类型（`id`、`name`、`email`、`api_key` 等），避免超长内容写入截断
- 加固密码重置流程

---

## 🔒 安全 & 依赖

- 修复 Dependabot 安全告警（1 critical + 27 high）。Close #477
- 固定 browserslist 至 4.28.9

---

## 📝 文档 & 其他

- 文档：新增密码重置配置说明；README 更新 banner 与描述；明确 CII 评估流程
- 移除过时的 `create-admin` 脚本
- 新增贡献者 @potofo

---

## 数据库迁移清单

| 迁移 | 内容 |
| --- | --- |
| `20260815233649_fix-users-updated-at-default` | `users.updated_at` 补充默认值 |
| `20260903034602_expand-field-types` | `dify_apps` / `users` 字段类型扩展 |
| `20260904062910_concerned_tattoo` | 新建 `password_reset_tokens` 表，`users` 新增 `session_version` 列 |

---

**Full Changelog**: https://github.com/lexmin0412/dify-app-hub/compare/v0.8.0...v0.8.1
