# 群晖部署记录与目标方案

本文分开记录现有仓库配置、历史约定和未来原生 SPK 目标。没有在群晖目标机重新检查的项目明确标为“待复核”。不要把地址、密码或密钥写入 Git。

## 当前仓库中的 Docker 部署

仓库的 `docker-compose.yml` 定义了 BookOrbit 应用和 PostgreSQL。应用容器监听 `3000`，PostgreSQL 使用 `pgvector/pgvector:pg18`。应用镜像需要指定精确版本 tag；正式验证不使用会漂移的 `latest`。

历史部署约定可作为核对起点，不能视为当前群晖配置已验证：

- DSM 用户访问端口曾使用 `8184` 映射到应用容器 `3000`。
- 书库根目录约定为 `/volume1/library`。
- 电子书期望路径为 `/volume1/library/ebook/<书名>/`。
- 应用数据和 PostgreSQL 数据应使用持久化目录，不能放在容器可写层。

实际挂载由 `BOOKS_HOST_PATH` 控制，Compose 将该目录挂载到容器 `/books`。例如：

```dotenv
APP_IMAGE=ghcr.io/bookorbit/bookorbit:3.5.0
APP_PORT=8184
PORT=3000
TZ=Asia/Shanghai
BOOKS_HOST_PATH=/volume1/library
POSTGRES_USER=替换为本地生成的用户名
POSTGRES_PASSWORD=替换为强随机口令
POSTGRES_DB=bookorbit
JWT_SECRET=替换为强随机密钥
SETUP_BOOTSTRAP_TOKEN=替换为强随机令牌
APP_URL=https://你的服务域名
```

以上只展示变量形态。实际部署时还要按当前 `docker-compose.yml` 补齐 `.env` 要求的值，并保护 `.env` 文件。不要将真实配置提交到仓库。

如需在 DSM 上创建书库、导入或整理文件，先确认 `/volume1/library` 的共享文件夹权限和应用容器 UID/GID。不要仅因为目录可读就认定写入、重命名或转换权限正确。`/volume1/library/ebook/<书名>/` 是用户希望的目录约定，尚不能据此断言当前下载插件已经支持该路径。

Compose 还将应用数据写入部署目录下 `data/app`，PostgreSQL 数据写入 `data/postgres`。部署目录应位于稳定的共享卷，例如 `/volume1/docker/bookorbit/`；确认 Compose 文件与 `.env` 位于同一部署目录。

## 运行时与数据库

- 官方 Dockerfile 当前以 Node 26 镜像构建运行环境，并在镜像内安装 Python、FFmpeg、Poppler、DjVuLibre 等组件。Docker 部署时这些依赖位于容器内，DSM 上已安装同名程序不能替代容器依赖。
- Compose 当前使用 PostgreSQL 18 的 pgvector 镜像。PostgreSQL 17 没有在当前项目配置中验证，不要直接把 18 的数据目录挂给 17。
- 如果采用原生 SPK，必须明确应用实际会调用的 Node、Python、FFmpeg 路径和兼容版本。DSM 上有同名套件并不保证 PATH、动态库、权限和版本满足 BookOrbit。
- 将 PostgreSQL 18 单独打成 SPK 是独立工作项。它目前没有在本仓库形成已验证的安装包或升级流程。

## 日志和健康检查

Docker 部署可使用：

```bash
docker compose ps
docker compose logs --tail=200 app
docker compose logs --tail=200 postgres
```

检查 BookOrbit 健康端点：

```bash
curl -fsS http://127.0.0.1:8184/api/v1/health
```

如果映射端口不同，替换为实际 `APP_PORT`。Compose 日志是容器标准输出；DSM 的套件操作日志只记录 SPK 安装和生命周期脚本，不应当作应用服务日志。

## 备份、隔离验证和切换

1. 切换前记录当前镜像 tag、容器状态、DSM 包状态和书库路径。
2. 备份 PostgreSQL，并验证备份文件非空且可读取；同时备份用户配置和必要的应用数据目录。
3. 书库中的用户原始文件要单独备份或使用 Synology 快照，数据库备份不能替代文件备份。
4. 在隔离环境使用独立应用名、端口、数据库和数据目录验证新版本，不能挂载生产数据库目录做测试。
5. 验证登录、TXT 上传/扫描/转换、元数据流程、封面、下载、M4A 导入、客户端访问、日志和重启恢复。
6. 全部通过后再切换生产服务。保留上一版镜像或 SPK，以及对应数据库备份和恢复步骤。
7. 若新版本已经迁移数据库，回滚前确认旧版本兼容性；必要时恢复数据库备份，不要只降级应用。

## 原生 SPK 目标

原生 SPK 尚未实现。目标流程是：在本地以锁定的正式 tag 和依赖构建 SPK，先做静态检查和包内文件检查，通过 DSM 套件中心安装隔离版本，自动启动并读取应用日志，完成健康检查与功能验收后才切换现有服务。需要为以下内容建立可维护方案：

- `INFO` 元数据、架构和 DSM 兼容范围。
- `preinst`、`postinst`、`start-stop-status`、卸载及升级脚本。
- 应用运行时和依赖的来源、版本、许可证与更新策略。
- 独立的持久化目录、用户权限、服务端口、日志位置和配置迁移。
- PostgreSQL 18 pgvector 的独立生命周期、备份、升级及回滚。
- DSM 套件中心安装、重启、升级、停止、卸载和异常启动的自动化验证。

SPK 的 `INFO`、日志路径和数据路径在确定实施前均视为待设计，不要据此直接创建生产目录或安装包。

