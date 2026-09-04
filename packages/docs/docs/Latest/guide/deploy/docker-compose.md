# Docker Compose 一键部署

使用 Docker Compose 时，我们提供了两种方式供你部署，你可以按需选用。

## 直接部署

这种方式适用于无需二开的场景，你不需要 clone 源码，直接使用官方镜像部署即可。

### 1. 准备工作目录

```bash
mkdir dify-app-hub && cd dify-app-hub
```

### 2. 下载配置文件

```bash
curl -O https://raw.githubusercontent.com/lexmin0412/dify-app-hub/main/docker-compose.yml
```

### 3. 修改配置

```bash
# 编辑配置文件, 需要配置 DATABASE_URL 为实际的数据库连接地址（MySql）
nano docker-compose.yml
```

如需启用邮箱找回密码功能，在 `environment` 中补充 SMTP 配置。`SMTP_PASSWORD` 请填写邮箱授权码或应用专用密码：

```yaml
environment:
  - DATABASE_URL=mysql://username:password@host:port/database_name
  - NEXTAUTH_SECRET=your-secret-key-here
  - SMTP_ENABLED=true
  - SMTP_SERVER=smtp.example.com
  - SMTP_PORT=465
  - SMTP_USERNAME=noreply@example.com
  - SMTP_PASSWORD=your-app-password
  - SMTP_USE_TLS=true
  - MAIL_DEFAULT_SEND_FROM=Dify App Hub <noreply@example.com>
  - APP_URL=https://your-domain.example.com
```

不配置 SMTP 时，系统仍可正常使用，但登录页不会提供可用的邮箱找回密码服务。

### 4. 启动容器

```bash
docker compose up -d
```

### 5. 访问应用

> serverip 是你的服务器 IP，如果是本机启动，直接使用 localhost 访问即可

- 应用入口：http://serverip:5300

## 二开后自行构建镜像

如果需要对 Dify App Hub 进行二开，你需要 clone 源码并自行构建镜像。

### 1. Clone 代码仓库

```bash
git clone git@github.com:lexmin0412/dify-app-hub.git
```

### 2. 配置环境变量

```bash
cp .env.template .env
```

注意：默认情况下，Dify App Hub 使用 MySQL 进行应用配置的持久化存储，如果你需要配置其他类型的数据库，请查看 [使用其他数据库](/guide/deploy/db-config#2-使用其他数据库)。

如果需要邮箱找回密码功能，请在 `.env` 中配置 SMTP。具体字段说明请参考[邮箱找回密码](/guide/features/password-reset)。

### 3. 修改源码

修改代码并自测。

### 4. 基于本地代码构建镜像并启动

对于二开场景，我们准备了一个专用的 docker compose 配置文件，你可以直接使用，它会读取项目下的 .env 文件作为环境变量启动容器。

```bash
docker compose -f docker-compose.dev.yml up -d
```
