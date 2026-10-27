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

## 2026-10-23 隔离验证记录

已在群晖 `x86_64` 主机上使用独立 Container Manager 网络、数据库数据目录、应用数据目录、测试书库目录和 `18184` 端口完成一次 v3.5.0 定制镜像验证。验证镜像为 `bookorbit-custom:v3.5.0-verify-20261023`，数据库为 PostgreSQL 18 pgvector。

验证结果：

- `bookorbit-db-verify`：healthy。
- `bookorbit-app-verify`：healthy，数据库迁移完成，应用成功启动。
- `GET /api/v1/health`：返回 `status=ok`，数据库状态为 `up`。
- `GET /api/v1/auth/setup-status`：返回新实例需要初始化，说明隔离数据库没有复用生产账户数据。

## 2026-10-23 生产切换记录

隔离验证通过后，生产应用已切换到 `bookorbit-custom:v3.5.0-verify-20261023`，继续使用生产 PostgreSQL 18、应用数据和 `/volume1/library` 书库挂载。生产入口为 `http://100.86.77.124:8184/`。

切换结果：

- 生产容器 `bookorbit-app`：healthy，端口映射 `8184 -> 3000`。
- `GET /api/v1/health`：HTTP 200，数据库状态为 `up`。
- 生产网页入口：HTTP 200。
- 旧生产容器保留为停止状态，旧镜像标签为 `bookorbit-rollback:pre-v3.5.0-20261023`，用于回滚。
- 切换前数据库、`.env`、Compose 文件和应用数据备份保存在群晖 `/volume1/docker/bookorbit/backups/cutover-20261023-v350`。

本次部署确认镜像启动、数据库迁移和健康检查通过。TXT 上传、扫描、手动转换、豆瓣/番茄真实网络响应和 Android 客户端仍需按功能清单逐项验收，不能仅用健康检查替代功能验收。

## 2026-10-23 封面代理修复

生产已切换到 `bookorbit-custom:v3.5.0-coverfix-20261023`。修复内容包括：

- 豆瓣图片代理请求增加 `https://book.douban.com/` Referer，避免图片服务返回 HTTP 418。
- 番茄旧版 `p*-tt.bytecdn.cn` 封面地址规范化到可用的 `p*-novel.byteimg.com`，并增加番茄来源 Referer，避免 HTTP 403。
- 元数据保存和封面预览共用同一套来源头及地址规范化逻辑。

本次生产切换后健康检查返回 HTTP 200，数据库状态为 `up`；修复镜像保留在群晖本地，旧 v3.5.0 镜像仍可用于回滚。

## 原生 SPK 目标

原生 SPK 尚未实现。目标流程是：在本地以锁定的正式 tag 和依赖构建 SPK，先做静态检查和包内文件检查，通过 DSM 套件中心安装隔离版本，自动启动并读取应用日志，完成健康检查与功能验收后才切换现有服务。需要为以下内容建立可维护方案：

- `INFO` 元数据、架构和 DSM 兼容范围。
- `preinst`、`postinst`、`start-stop-status`、卸载及升级脚本。
- 应用运行时和依赖的来源、版本、许可证与更新策略。
- 独立的持久化目录、用户权限、服务端口、日志位置和配置迁移。
- PostgreSQL 18 pgvector 的独立生命周期、备份、升级及回滚。
- DSM 套件中心安装、重启、升级、停止、卸载和异常启动的自动化验证。

SPK 的 `INFO`、日志路径和数据路径在确定实施前均视为待设计，不要据此直接创建生产目录或安装包。

## 2026-10-23 后台下载版部署准备

当前更新包含后台书源任务、豆瓣详情补全、中文提供商注册和新版前端。离线构建复用 `bookorbit-custom:v3.5.0-coverfix-20261023` 的运行环境；本地与该镜像构建目录中的 `server/package.json`、`pnpm-lock.yaml` SHA-256 完全一致，避免复用不匹配的依赖。更新包同时携带编译后的共享类型、完整 Drizzle 迁移及固定版本的番茄下载器和许可证。应用配置必须设置 `TOMATO_DOWNLOADER_PATH=/opt/bookorbit/tomato-downloader`。

首次隔离启动发现新增模块的导入顺序触发认证模块循环引用，报 `Cannot access 'AuthModule' before initialization`。已调整入口模块导入顺序；后续构建后增加以下检查：

```bash
node scripts/synology/verify-compiled-module.cjs
```

该检查只验证编译产物的模块加载，不会启动应用或连接真实数据库，不能替代目标机器启动检查。

隔离应用替换可使用 `scripts/synology/replace-container.py`。脚本从原容器提取环境、卷、网络、端口、安全选项等配置，保留旧容器；健康检查失败会恢复旧容器并保留失败容器供诊断。它不会自动恢复数据库，因此生产切换前仍必须备份数据库并确认迁移兼容性。不要在未核对挂载和配置的实例上运行。

真实 API 验收脚本为 `scripts/book-source/verify-nas-imports.mjs`。只允许以 `BOOKORBIT_VERIFY_ISOLATED=1` 在隔离容器内运行，会初始化专用测试账户、创建测试书库、上传和扫描 TXT、手动转换、提交番茄下载任务、查询中文提供商及验证豆瓣详情和封面。测试账户凭据保存在隔离应用数据目录的权限 0600 文件中，不写入仓库或输出日志。该脚本会创建测试数据，不要对生产实例运行。

### 最终隔离验收结果

隔离镜像 `bookorbit-custom:v3.5.0-jobs-r4-20261023` 已通过真实 API 验收，使用独立 PostgreSQL 18.6 和独立书库：

- TXT 上传保留原格式，没有自动生成 EPUB；正文以“第一章”开头时使用文件名作为书名，不再误取章节标题。
- 手动指定 UTF-8 和中文章节规则转换，TXT 与 EPUB 保留在同一个 `bookId` 下。
- 文件系统扫描发现真实 TXT，扫描本身不转换。
- 番茄接口立即建立队列任务，后台约 30 秒完成下载与 EPUB 入库。再次提交同一书源书籍返回原已完成任务，未重复导入。
- 五个中文提供商已注册到配置接口；豆瓣《余罪》的作者、简介、封面 URL 和实际图片代理请求通过。
- 实际 M4A 上传、音频清单、HTTP 206 范围读取通过；保存到 3000 毫秒后，第二次登录读取到相同位置。手机端实际扬声器播放仍需另验。
- Gutenberg 插件文件已安装到隔离应用的 `plugins/indexers/gutenberg/index.mjs`，重启后加载成功；本轮尚未完成插件在 NAS 上通过请求队列下载入库的测试。

验收脚本会等待异步元数据提取完成，书库列表分页从 `page: 0` 开始。真实测试还发现后台任务完成与心跳查询并发时会访问已清空的运行任务，已改为持有本次任务引用，并增加并发回归用例。新增 TXT 和工作线程回归共 12 项通过，编译、类型检查、lint 与编译模块加载检查通过。

生产切换前的新备份位于 `/volume1/docker/bookorbit/backups/jobs-20261023/`，包括 PostgreSQL 自定义格式备份、`pg_restore --list` 结果、应用数据、容器检查信息、Compose 和环境文件；文件权限已收紧。凭据不应复制到本文或提交到仓库。

### 生产切换完成

2026-10-23 生产容器 `bookorbit-app` 已切换为 `bookorbit-custom:v3.5.0-jobs-r4-20261023`，运行版本标识为 `3.5.0-custom-jobs-r4-20261023`。保留原生产卷及只读书库挂载、可写 ebook 子目录、端口、用户、安全选项和日志配置。

- 生产与隔离实例均为 healthy；生产健康接口数据库为 `up`，外部网页返回 HTTP 200。
- 生产 PostgreSQL 已创建后台任务表；启动日志无应用失败，Gutenberg 插件加载 `loaded=1 failed=0`。
- 生产环境文件的 `APP_IMAGE` 已同步为新镜像，避免下次 Compose 重建回到 v3.4.0；环境文件权限为 0600。
- 原生产容器 `bookorbit-app-pre-jobs-20261023` 保留为停止状态，未删除；新备份路径见上文。
- 正文下载入口：`/requests?tab=sources`，中文界面为“请求”中的“小说书源”；需要上传权限和自行获取资源权限。
- 隔离环境真实 API 验收完成，没有向生产书库添加验收样本。浏览器扩展绑定已登录页面连续超时，因此没有将人工页面巡检列为通过。

百度百科、七猫目前仍受来源访问验证限制；来源在设置中存在不等于实际请求可用。起点公开移动搜索曾在本机通过，NAS 本轮只确认配置注册。漫画书源、Gutenberg 在 NAS 通过实际请求队列入库，以及手机端实际播放仍属于待验收或未完成项，详见功能矩阵。

# 2026-10-23 r6 部署记录

生产镜像 `bookorbit-custom:v3.5.0-jobs-r6-20261023`，版本 `3.5.0-custom-jobs-r6-20261023`，端口 8184。隔离实例同版本，端口 18184。生产健康、数据库正常，Web HTTP 200。生产 `.env` 中 APP_IMAGE 已同步更新。

切换前数据库 dump、可读检查清单、原环境文件保存于 `/volume1/docker/bookorbit/backups/catalogs-r6-20261023/`，目录权限 700、文件 600。旧生产容器 `bookorbit-app-pre-r6-20261023` 停止保留。本次没有新增数据库迁移。

隔离验证结果：百度百科《余罪》、七猫、起点真实搜索及图片代理通过；TXT 上传和扫描不自动转换，手动转换维持同一 bookId；番茄持久任务返回已有完成结果；M4A 上传、HTTP 206、第二会话恢复 3000 ms 续听通过。Gutenberg 完整请求、搜索六个候选、下载、匹配校验、EPUB 入库通过，requestId=1、bookId=17。自动上传刮削《余罪》取得简介和封面，bookId=18，测试结束恢复隔离原配置。

生产已启用百度百科、七猫、起点及导入自动刮削，保留其他来源和既有条件设置。已配置现有 Gutenberg 插件来源。配置由授权的 NAS 运维会话调整，备份先于调整完成，生产书库未写入验收书籍。

日志位于 `/volume1/docker/bookorbit/release-20261023-r5/` 的 `chinese-verification.log`、`import-verification.log`，以及 r6 目录的 `request-verification.log`、`auto-verification.log`、`production-cutover.log`。

Internet Archive 漫画本机下载 114,663,880 字节 CBZ 及提取封面通过，群晖访问来源和电脑现有代理均超时，尚未完成群晖下载验收。七猫、起点目前仅提供元数据，正文下载尚未实现。浏览器全面巡检及原生 SPK 仍在待办中，不能宣称全部完成。

## 2026-10-25 独立数据库 SPK 方向确认与现场基线

用户再次确认目标为数据库独立的原生 SPK，BookOrbit 连接独立数据库，应用原生 SPK 后续推进。目前尚无 PostgreSQL SPK 构建或安装结果，生产仍使用 Docker，不将目标写成已完成。

本次只读查询确认 bookorbit-db 镜像 pgvector/pgvector:pg18 运行中，NAS x86_64；数据库 PostgreSQL 18.6，vector 0.8.7、pg_trgm 1.6、unaccent 1.1、uuid-ossp 1.1、plpgsql 1.0，BookOrbit 数据库约29MB。源码初始化依赖上述四个扩展，vector(256)及HNSW索引需要保留，不能用缺少pgvector的普通PostgreSQL替代。

实施顺序：独立维护数据库SPK构建材料和生命周期；在独立端口/数据目录安装验证；生产逻辑备份恢复到隔离数据库并验证扩展、迁移、权限、索引和功能；验证应用使用外部数据库的启动顺序及故障重连；完成后再安排生产连接切换，保留原库。原Docker数据库文件不能直接当作原生SPK数据目录使用，也不降低PostgreSQL主版本。数据库不与BookOrbit套件卸载绑定。数据库服务账号、监听范围、认证、数据权限、备份及升级恢复需独立设计，禁止借用DSM内部数据库。

本轮未修改生产数据库、连接地址、服务状态或数据。

## 2026-10-25 r8生产切换验收

用户确认先备份后切换。生产镜像为`bookorbit-custom:v3.5.0-chapters-r8-20261025`，应用版本`3.5.0-custom-chapters-r8-20261025`。生产健康检查数据库up，公网8926入口HTTP200，新增来源状态和规则接口未登录返回401。生产.env的APP_IMAGE已原子同步，重启策略unless-stopped。旧容器`bookorbit-app-pre-r8-20261025`停止保留。

独立备份`/volume1/docker/bookorbit/backups/chapters-r8-20261025/`包含1453220字节数据库dump、完整应用数据、原.env、compose和容器配置。dump通过pg_restore目录可读检查，目录0700、敏感配置0600。本次无数据库schema变更，不向生产写入验收书籍。

群晖隔离验证：起点公开卷130章完整下载入库，EPUB714111字节、导航130章，简介明确排除1288章；浏览器搜索、提交及重复任务返回通过。JSON规则导入/保存/来源列表、不可变来源标识409、错误编码拒绝后重试、同书TXT/EPUB关联和不覆盖检查通过。388像素内容宽度检查无横向溢出，未代替实体手机全面验收。七猫正文仍未接入，规则格式非完整Legado兼容。

切换日志`/volume1/docker/bookorbit/release-20261025-r8/production-cutover.log`记录Replacement healthy。qBittorrent PID17223仍运行，MoviePilot进程运行，未停止两者或重启NAS，未修改Mihomo代理。最终r8增量构建归档SHA256：613dab4e67712c91ac9fb6ee42447b1d79692140f71177d86f6cafe60b664606。原生SPK和独立数据库SPK仍按用户要求后置，不列为本次完成项。

## 2026-10-25 r9生产部署及验收

经用户确认从r8切换生产。镜像`bookorbit-custom:v3.5.0-chapters-r9-20261025`，镜像ID`sha256:b008e526e680db412b73efa692f2b96db47adf4659f55edf4dabb9a2d5b75766`，版本`3.5.0-custom-chapters-r9-20261025`。只更新前端，无数据库结构变化。任务并发刷新、失效来源重试及规则加载失败保护修正通过隔离验收后部署。

备份`/volume1/docker/bookorbit/backups/chapters-r9-20261025/`含1453466字节数据库dump、完整app数据、原.env、compose及容器配置，dump目录可读检查通过，备份目录0700，敏感文件0600。切换前活跃书源任务为0，旧r8容器`bookorbit-app-pre-r9-20261025`停止保留。生产.env APP_IMAGE已同步，重启策略unless-stopped。

生产及数据库健康，公网8926首页与健康接口HTTP200，新增来源接口未登录401。公网index-WGPnDbd0.js及BookRequestsPage-DQYFOUsk.js逐文件SHA256与本机构建一致。qBittorrent PID17223和MoviePilot PID20406保持运行；未重启两者、Mihomo或NAS。临时导出的隔离账号凭据已在两端删除。

前端定向回归：来源/TXT/详情48项、规则导入与字节边界3项、元数据操作83项、差异字段10项通过，类型检查、相关Lint和构建通过。真实Chromium验证规则读取失败重试、并发翻页/取消不需刷新、失效来源禁用重试、390像素无横向溢出、真实TXT转换及元数据保存失败后重试和刷新复读。并发使用网络夹具，另核验真实隔离任务列表；非实体Android验收。隔离API验证样本23/24和已完成起点任务去重/入库结果通过，本轮未再次批量下载起点130章。

真实百度抽样已返回出版社、页数和出版日期，未返回字段不补造，版本不混合。本轮文件归档SHA256`e4f0024ef2fcabf9aa465cbaa7a5591e603e6bf552d2ca3f8853f9f3c50ee4ff`。日志位于`/volume1/docker/bookorbit/release-20261025-r9/`。生产未写入任何验收图书。

## 2026-10-25 TXT直接阅读r12隔离验收（生产待确认）

生产保持r9，r10/r11/r12仅替换隔离容器。r10验证无效格式入口保护；用户明确要求直接读取TXT及多种主流格式后，r11接入临时阅读投影，r12修正缓存命中mtime变化导致的解析缓存失效。

r11归档SHA256`027afc5582fb62c33e93bc10712a2fe3afa13cdc65f0d58324949508b849a690`（1172306字节）；r12性能增量SHA256`0548391cd9ab3a45857fe39837e74147a90721f6c9700f1a2c841479690c77c9`（6307字节）。r12镜像`bookorbit-custom:v3.5.0-reader-r12-20261025`，镜像ID`sha256:e761d70d4877222d6d7442effff56db351e7d0c6ac3d7540962a1cdb0c51dace`，APP_VERSION`3.5.0-custom-reader-r12-20261025`。无数据库结构变化。

本地服务端缓存、EPUB资源与转换56项、前端阅读入口及流式加载78项通过，模块注册另验通过；构建、类型检查和相关Lint通过。r12真实Chromium创建隔离样本31/33/34/35：UTF-8、GB18030、带BOM UTF-16 LE正文目录通过，无目录长文本被分成三段；31阅读进度刷新恢复通过。四个源文件SHA256保持一致，book_files未添加EPUB。原TXT与显式转换的EPUB是两种不同操作。缓存目录0700、文件0600；四个缓存9787字节；再次获取info后mtime不变。r11已有Gutenberg完成请求、真实EPUB章节渲染及M4A播放/暂停通过。r12三页合成PDF样本32显示渲染图片（非canvas）。实体Android、MOBI/AZW3/FB2真实文件逐项验证仍未完成。

生产备份`/volume1/docker/bookorbit/backups/reader-r12-20261025/`含1453535字节数据库dump、原.env、compose、容器配置和完整app数据，dump目录可读检查通过，0700/0600保护。临时阅读缓存位于容器/tmp，不纳入配置备份。等待用户确认生产切换，不能将隔离结果写成生产已部署。浏览器验收临时凭据在测试结束后删除两端临时副本，保留原隔离账号私有配置。

## 2026-10-25 r12生产切换完成

用户确认后，生产从r9切换至`bookorbit-custom:v3.5.0-reader-r12-20261025`，健康检查数据库up，公网8926健康与首页HTTP200。生产.env APP_IMAGE已原子同步，重启策略unless-stopped。旧r9容器`bookorbit-app-pre-r12-20261025`停止保留，备份仍为reader-r12-20261025（数据库dump1453535字节，可读检查通过）。启动会运行原有迁移检查，本版没有新增迁移或数据库结构变化。

公网index-CpaUXSTM.js、BookDetailView-INq3CJVm.js、ReaderView-D99Ht7Qe.js逐文件SHA256与本机构建一致；生产TXT缓存服务JS哈希与r12已验载荷一致。来源状态及EPUB/TXT资源info未登录均401。qBittorrent PID17223、MoviePilot PID20406持续运行，未重启二者、Mihomo或NAS。生产没有创建验收账号或验收书籍。隔离浏览器测试临时凭据已删除两端副本。

已上线TXT直接网页阅读与有界临时缓存；原TXT、书库文件列表和显式转EPUB逻辑保持分离。浏览器实测编码、目录、长文本切分、刷新恢复和源文件保护结果见上述r12隔离条目。保留原有EPUB/PDF/MOBI/AZW3/FB2等入口，其中本轮真实样本覆盖TXT、EPUB、PDF以及M4A播放/暂停，未把其他格式或实体Android列为实测完成。r10/r11为隔离候选，没有切换生产。

## 2026-10-25 主流格式续验及r13隔离候选

隔离r12使用Gutenberg官方Alice’s Adventures in Wonderland公共领域样本，经典MOBI241000字节和KF8/AZW3 255506字节，关联同一bookId36。默认打开主格式MOBI，显式选择AZW3后验证格式路由、正文和导航；下载原文件SHA256保持一致。自建FB2样本815字节，bookId37，正文/导航和原文件校验通过。样本均未写入生产。可复用脚本scripts/book-source/verify-browser-mainstream-formats.cjs限定18184端口与隔离验收书库，读取显式样本目录和格式到bookId映射，复验时不重复上传。

发现阅读状态使用硬编码英文，已复用现有book.readStatus语言键，以响应式getter保留原STATUS_OPTIONS接口。详情、卡片、表格、批量操作、阅读日志共用标签；状态值不变。181项相关测试、类型检查、Lint和构建通过。r13隔离真实页面确认八个中文菜单项、中英切换无需刷新且不改变图书状态。

候选镜像bookorbit-custom:v3.5.0-ui-r13-20261025，ID sha256:a0c7da2bea3df65a74a36c1070ee272a0a7b6aaca92c8c9feab5932cc0d67371。归档1126183字节，SHA256 c61da8bd14973083a36a3685c9146fdff3aeb38d9a36a925db3b15e16bcb7b50。仅前端变更，无数据库结构变化。生产切换前备份/volume1/docker/bookorbit/backups/ui-r13-20261025，数据库dump1453566字节并通过目录可读检查，另含完整app、原.env/compose及容器配置；0700/0600保护。生产仍为r12，r13等待用户确认。

## 2026-10-25 r13生产验收及r14隔离补充修复

用户明确确认后，生产已切换r13，APP_IMAGE持久化，旧r12容器停止保留。数据库健康、公网首页200、未认证书源接口401，以及公网前端文件SHA256一致性验收通过。未操作qBittorrent、MoviePilot、Mihomo或NAS重启。

隔离真实番茄搜索与封面代理通过，封面返回607604字节图像。真实页面进一步复现初始化状态延迟返回会清空用户已选书库的问题。r14改为保留仍有效的选择，仅无效选择才回退默认书库；修复前回归失败，修复后书源18项测试、Lint、类型检查和构建通过。r14隔离真实浏览器通过延迟初始化保留选择、搜索已有书、提交返回既有任务、刷新恢复入库bookId7及任务数量不增加。测试仅允许原有完成任务，不新增正文下载。

r14归档SHA256为5fbe969a3dbb547dcfa5c8e92a9672e664c4479b97c85d58adeaa3d0970fd204，生产仍为r13，r14尚未获得生产切换确认。

## 2026-10-25 r14生产切换完成

用户明确确认后，生产升级为bookorbit-custom:v3.5.0-source-r14-20261025，APP_VERSION=3.5.0-custom-source-r14-20261025。容器healthy，数据库up，重启策略unless-stopped；.env的APP_IMAGE已原子持久化。旧r13容器bookorbit-app-pre-r14-20261025停止保留。

切换前备份位于/volume1/docker/bookorbit/backups/source-r14-20261025，包含完整app数据、原.env/compose、容器配置，数据库dump1453589字节并通过pg_restore目录可读检查。公网首页200、未认证书源接口401；index-BpLD369X.js与BookRequestsPage-BKLFcE2U.js的SHA256与本地r14构建一致。初始化选择保留及真实番茄去重、刷新恢复的交互在相同镜像隔离环境通过，生产不创建测试书籍或验收账号。

qBittorrent原PID17223和MoviePilot原PID20406持续存在；未重启两者、Mihomo或NAS。此前临时隔离账号凭据的本机与NAS副本均已删除。

## 2026-10-25 r14真实下载取消与重试续验

隔离独立书库“下载取消隔离验收-r14”（libraryId4，目录/books/cancellation-r14）提交此前验证过的番茄样本7632840875923491865，任务id3。真实浏览器点击取消后，后台状态cancelled、resultBookId=null；刷新恢复取消状态。再点击重试，后端实际进入downloading，attempts=2；再次点击取消并刷新，仍为cancelled且resultBookId=null。容器内核对目标目录为空，未产生误入库文件。未对任务接口做浏览器模拟响应。生产r14及其他服务未改动。

通过的一次性脚本随后整理为scripts/book-source/verify-browser-live-cancellation.cjs，限制隔离端口18184、专用书库前缀和空闲队列，只选既有完成的番茄样本。整理后做语法与格式校验，尚未重复触发下载。临时隔离账号凭据本机和NAS副本均已删除，原私有隔离账号配置保留。

漫画在线复验：隔离r14编译后的插件加载器加载internet-archive-comics成功（loaded=1 failed=0），实际搜索失败。隔离容器分别请求archive.org首页与advancedsearch均为UND_ERR_CONNECT_TIMEOUT，连接archive.org:443超时；不是完整在线下载通过。沿用现有直连网络，未修改Mihomo或系统代理。日志release-20261025-r14/comic-online-verification.log。

## 2026-10-25 真实文件扫描归并验收

隔离专用书库libraryId5，/books/scan-editions-1792931247400，生成7个真实TXT/EPUB文件。新建书库自动触发首次扫描，紧接着手动请求409表示已有扫描运行，不是扫描失败。首次扫描完成得到6本书：book38为唯一TXT/EPUB配对；book39/40/41为同名且TXT大小写双版本导致的三份歧义候选；book42/43为跨目录同名文件，不归并。随后再次扫描完成，六个bookId保持一致，七个原文件SHA256在重复扫描前后相同。最终恢复验收脚本退出0，日志release-20261025-r14/scan-editions-resume.log。

可复用脚本scripts/book-source/verify-nas-scan-editions.cjs生成独立测试数据，处理首次自动扫描409并等待完成，不读取生产书库；整理版尚未再次执行完整扫描，仅做语法与格式校验。此次不是用户实际藏书的人工归并审核。

## 2026-10-26 r16生产与界面验收完成

书源任务、规则JSON错误及19个组件122处静态英文已接入中英资源，覆盖详情、EPUB指南、PDF密码/设置、Readwise、StoryGraph、统计和暂存区。动态错误、计数和相对时间同时处理，ICU复数及语言切换通过115项相关测试。一次worker退出超时提示，对应文件单独复查3项通过；类型检查、构建、Lint、25套语言资源校验通过。scripts/audit-ui-localization.cjs检查840个Vue模板，白名单外静态英文为0，11794个英文资源键均有中文对应。静态检查不等于所有动态错误或外部集成的实测。

隔离真实浏览器通过：书源取消状态中英切换且不导航、无效规则JSON中文提示且没有PUT、StoryGraph/Readwise中英切换及390px布局；PDF book32/file43缩放、滚动、双页和旋转中文控制项通过。初次PDF脚本遗漏format=pdf参数，修正后通过，不是应用PDF故障。

用户确认后生产升级bookorbit-custom:v3.5.0-ui-r16-20261025，healthy、database up、unless-stopped，APP_IMAGE持久化。旧r14停止保留bookorbit-app-pre-r16-20261026。备份backups/ui-r16-20261026，数据库dump1453870字节且pg_restore目录可读，完整app、原.env/compose、容器配置保留。归档2097898字节，SHA256 318447533fd4b1f49c28adb7d8bff609068a80321f1cc6d37de12c8f31c933b5。公网主入口、BookRequestsPage、ReaderView、StorygraphSettings、ReadwiseSettings哈希与本地一致；HTTP200、书源未登录401。切换期短暂502随后恢复正常。qBittorrent原PID17223及MoviePilot原PID20406保持运行；未操作Mihomo或NAS重启。r15仅为隔离候选，未部署生产。

生产5份TXT只读抽样（book1、book3两份、book4两份）均能提取标题并识别中文，一份有作者；无作者标签时不补造，数据库和文件无修改。隔离豆瓣真实搜索余罪、字段对比与封面渲染通过，实际2个图像加载，book25标题不变且没有PUT/PATCH/DELETE。来源实际返回作者、出版社、日期、页数、ISBN和系列。初次脚本等待折叠的弱匹配结果行超时，按已选预览检查后通过。

发现额外封面提示问题：已选封面存在但备选条带为空时仍显示“此结果中没有封面”。回归修复前失败，修复后49项测试通过，r17候选构建中，生产r16尚不包含。Android实机按用户“暂时没有设备，先完成其他项目”的回复后置。

2026-10-26漫画出网续验：用户明确允许临时开启Mihomo、用后关闭。先检查uid2内核及UID DIRECT规则，设置独立8分钟关闭保护，再开启系统代理。实际qBittorrent120条样本全部Uid DIRECT后才开始下载。隔离编译插件加载、真实Archive搜索2条、CBZ解析114663880字节、实际DirectDownloadService下载、ZIP结构和封面提取全部通过（comic_online_exit=0），日志/volume1/docker/bookorbit/comic-online-20261026.log。该轮是编译服务层真实下载，不等于完整请求API入库链路。关闭请求未返回可确认状态，后续受限socket检查时enabled/desired/owned已全false，再次disable及status均false，mh-nas0不存在，确认关闭后取消本轮独立保护。未改节点、Mihomo配置、套件或qBittorrent。完整请求链路验收脚本verify-nas-comic-request.mjs已准备，待隔离重启完成后执行。

### 2026-10-26：漫画请求完整链路与r18本机候选

- 隔离请求2从Archive下载114663880字节CBZ，因系列名与具体卷名不一致进入人工审核，保留匹配保护。经正常审核接口入库为book44/file57，封面与28页漫画图片读取通过。重复抓取同一待审核文件返回409，避免重复下载。
- 实际入库发现无内嵌书名的文件将暂存`request-2-`前缀带入书名。修复仅在直接下载完成核验并允许入库后传递来源文件名；显式选择、抓取到的元数据、多文件单元和真实文件标题保持原逻辑。176项相关后端测试及前后端构建通过。
- r18同时包含r17封面空状态修复和PDF缩放选项中文标签修复；增量包`bookorbit-r18-20261026.tgz`，1210915字节，SHA256 `f19d562705db830998cbdb7754eb3a9325db2e95fc4aad7fc5d58ed644ad09af`。基于隔离r17镜像，无数据库迁移或依赖变更。
- 本轮传输时NAS内网SSH1022和HTTP18184均超时，未部署r18，生产仍r16，隔离最后确认r17。Mihomo最后确认关闭，未重启其他服务。等待网络恢复后继续隔离验收，不将候选描述为生产已修复。

### 2026-10-26：r18现场遗漏与r19修正候选

Tailscale100.86.77.124恢复可达。r18隔离healthy，60个静态路由实际Vue渲染巡检无页面异常、API5xx、原始翻译键或失败路由；PDF中文控件、豆瓣搜索字段对比与两个真实封面通过，无元数据写入。

r18真实请求4下载并自动入库book45时，书名仍含`request-4-`，因此r18未部署生产。原始文件名为`Foxy Grandpa Shows The BoysUp-To-Date Sports (MSU).cbz`，解析器会剥离来源后缀，之前只比较原始文件名造成遗漏。补充真实失败样例后先确认测试失败，再将原文件名解析器提升为公共工具，原模块保留重导出入口，修复复用同一规则，198项相关测试、lint及服务端构建通过。保留用户选择和真实内嵌标题、匹配分数和人工审核保护。

r19增量包59495字节，SHA256 `df2da5188da8b8646d9fd324371b4d622c148df33d43d50d3983f69d98ee8957`，基于r18，无新增依赖或数据库迁移。隔离镜像`bookorbit-custom:v3.5.0-r19-20261026`，ID前缀4793036c1481，healthy。生产仍r16。

新生产备份`/volume1/docker/bookorbit/backups/custom-r19-20261026`含1454118字节数据库dump、原.env/compose、容器配置和完整app归档；pg_restore目录可读，dump SHA256 `d9c8283e243503ebece27450b476532ed69a9e606cec52f18103d8d9a5619552`，目录0700、文件0600。

r19实机复验：外网请求5下载速度变慢，300秒约23068423字节后验收超时取消，未以此宣称通过。59条qB真实连接全部Uid DIRECT，最终Mihomo enabled/desired/owned均false、原Selector保持、mh-nas0消失。

在Mihomo关闭状态，用已完整下载的114663880字节公版CBZ回放正常请求链路。私网直连URL首次被安全检查拒绝，保留该保护；改用隔离专用回环测试代理，公共测试URL并未访问外部源站。请求7正常下载入库为book46/file59，标题`Foxy Grandpa Shows The BoysUp-To-Date Sports`无暂存前缀，源/目标文件哈希一致，封面和28页图片通过，真实浏览器实际漫画图片加载通过。临时插件、配置来源及19286回环监听已清理。此回放验证修复，不扩大为r19本轮外网下载成功。生产仍r16，r19待单独切换确认。

### 2026-10-26：r19生产切换

用户明确确认后，生产已切换`bookorbit-custom:v3.5.0-r19-20261026`，APP_VERSION为`3.5.0-custom-r19-20261026`；容器healthy、重启策略unless-stopped、生产.env APP_IMAGE已原子持久化。旧r16停止保留`bookorbit-app-pre-r19-20261026`，数据库结构未变，没有新增生产验收书籍或账号。

公网首页200、health数据库up、未登录书源状态401，`index-Cek4CNel.js`、`PdfSettings-DP6EAxuA.js`、`MetadataMatchWorkspace-BHFI09lE.js`哈希与本机候选构建一致。源与回放漫画文件非空哈希实测一致，为`972da5c1f67b0242ebbab325c67cb669`，大小114663880字节。

最终核验：生产finalizer、请求核验、公共文件名解析器及兼容重导出四个后端编译文件SHA256均与本机一致；Mihomo仍关闭，临时隔离账号两端副本已删除，原隔离账号私有配置保留。qBittorrent、MoviePilot未执行停止或重启，NAS未重启。

### 2026-10-26：r20下载故障恢复候选

本轮实际网络故障模拟发现：206响应即使ETag已变更，旧下载器仍可能接受续传。新增4项回归覆盖强ETag变更、强转弱ETag、Last-Modified变更及416变更，修复前4项失败；修复后52项下载器/书源worker测试通过，服务端构建与lint通过。拒绝响应时主动取消响应体，避免继续接收无效文件。

r20增量仅含下载器编译JS及source map，无数据库迁移或依赖变更；26273字节，SHA256 `634084ebbd9b4397ea95abcd718885b742c295c0e3825c5a71634c60805f81e9`，镜像`bookorbit-custom:v3.5.0-r20-20261026`，ID前缀0fe14d6a3cd0。隔离已healthy，生产仍r19。

独立临时PostgreSQL数据库验收通过8项：并发去重、全局唯一claim、下载租约过期恢复、旧worker写入隔离、下载中断手动重试、入库中断禁止重试、重复入库保护和用户隔离；临时库已删除。

生产新备份`backups/custom-r20-20261026`包含1454158字节dump及完整app/原.env/compose/容器配置，pg_restore目录可读，dump SHA256 `e038ec5ee2c230bc97a91b54950739eaf0fe655fa35604d8815cecdaf324e239`。备份时生产为r19，无生产切换。

r20群晖隔离最终实测五项全部通过：socket reset后精确Range重试、SIGKILL后新进程续传并SHA256一致、不同ETag拒绝并清理、错误Range拒绝并清理、无校验器部分文件拒绝恢复。验收脚本在暂停传输并确认字节落盘后才强制中断，异步失败清理有界等待，不依赖NAS固定毫秒时序。结果保存在`/volume1/docker/bookorbit/recovery-r20-20261026.log`。

用户确认后生产已切换`bookorbit-custom:v3.5.0-r20-20261026`，healthy，生产.env APP_IMAGE已同步，旧r19停止保留`bookorbit-app-pre-r20-20261026`，无数据库迁移。公网首页200、health数据库up、书源未登录401及原有前端资源哈希通过。

百度出版字段只读补查：三体3个候选、基地2个、银河帝国1个、哈利·波特与魔法石2个；候选词条独立，包含不同出版日期、出版社或页数。4个候选有有效出版年份，但这批无丛书字段，不能宣称丛书真实样本已验。日志`series-fields-r20-20261026.log`，未写入书籍元数据。

### 2026-10-26：r21书源动态错误候选

补查发现标准503/403等服务端英文默认message会直接进入书源规则及任务提示。真实浏览器确认断网已经由API统一NetworkError本地化，本轮保留该行为，并对原始TypeError提供防御性回退；默认HTTP错误使用中英文提示，401/403/429分别给出登录、权限、限流说明，具体服务端校验原因保持。

22项书源测试、前端构建、lint及25语言目录校验通过（11799个英文键）。前端候选255个差异文件、2090700字节，SHA256 `327ad3cf2bcd60b8629ae391f47aab29f614b05c0d69f23fd64ec1060af17fe7`；镜像`bookorbit-custom:v3.5.0-r21-20261026`，ID前缀45a14dca6227，隔离healthy。

真实浏览器注入断网、503和403，确认中文与英文提示、失败加载时禁用保存、恢复后同页重试成功，零规则PUT、零页面异常。仅在隔离浏览器拦截网络，不改变真实服务权限或服务器规则。生产仍r20。

r21生产切换前备份`backups/custom-r21-20261026`，数据库dump1454150字节，pg_restore目录可读，dump SHA256 `173db1a331ed2eb9b3efad35872446f9b0efbac8ccd32c27b9cba3d0d7096fed`，完整app/原.env/compose/容器配置均保留。真实浏览器验收后两端临时隔离凭据已删除。用户已确认生产r21切换，待最终核验。

r21用户确认后生产切换完成：`bookorbit-custom:v3.5.0-r21-20261026`，APP_VERSION `3.5.0-custom-r21-20261026`，healthy、unless-stopped，生产.env APP_IMAGE已持久化。旧r20停止保留`bookorbit-app-pre-r21-20261026`；两端临时隔离账号副本已删除。

公网首页200、health数据库up、未登录书源接口401；`index-DiD5wssa.js`、`BookRequestsPage-KV4SQPx5.js`、`PdfSettings-H37_FE8f.js`、`MetadataMatchWorkspace-4RJGRAVu.js`哈希与本机构建一致。无数据库迁移，不在生产创建测试书籍或修改规则。

### 2026-10-26：原生SPK运行时与图片依赖预验

生产仍r21。对DSM宿主普通账号完成官方Node26.11.1及私有Debian libatomic运行验证，execPath、子进程和fork IPC通过；glibc为2.36，内核4.4.302+。Sharp0.35.5的glibc平台包与libvips8.18.7通过合成PNG、JPEG缩放、WebP旋转，全部运行在Docker外。原始musl显式加载器方案虽可启动，但execPath指向加载器，未采用为包入口。/tmp为noexec，测试改在卷内私有临时目录，未修改挂载选项。来源哈希、可复现工具和未完成项见SYNOLOGY_NATIVE.md。无SPK构建安装、无数据库迁移、无生产更新。

## 2026-10-27 production database cutover completed

User confirmed final backup and cutover. BookOrbit remains r21 with exact image ID45a14dca6227860dd71028da67856f11fc34f8f335ad1181193d71c85bdd30d7. It now connects to native PostgreSQL at172.19.0.1:5433, database/rolebookorbit. Role is non-superuser, cannot create roles/databases or replicate, and has24 connection allowance. Both local8184 and public8926 health returned200/ok; live native DB connections were confirmed.

Final source snapshot and application archive: /volume1/database/pg/backups/bookorbit-cutover-20261027T121458Z. All167 restored table counts matched before application startup. Application-data archive235520 bytes, SHA256b5126027664ab803f2714040e27af9fad5f9aa773dc0404c7a3b10419ee5ec74; archive readable and database backup hashes verified. Original environment, compose, full container metadata and commitment receipt stay private in /volume1/database/pg/state/bookorbit-cutover-20261027T121458Z. No credentials were exported to the Mac.

JWT, exact image and app/book mount sources/modes were preserved. Persistent .env and compose now target native PG and omit the postgres service/dependency. New app has the correct Compose project labels and unless-stopped policy. Old application bookorbit-app-pre-nativepg-20261027t121458z and old database bookorbit-db are stopped with autostart disabled. Both bind and anonymous PostgreSQL volumes were retained without deletion.

Do not run the old container-only backup helper against stoppedbookorbit-db for future application releases. Use the native package-account pg_admin.py backup/verify-backup flow and protect its private globals/configuration files, plus the application/environment/compose backup. Preserve the native deployment profile during upstream merges. After commitment, reversing migration requires preserving new native DB writes; simply starting the old database is not a valid rollback.

## 2026-10-27 native PG formal installation completed

DSM installed PostgreSQL18.6-10020 and independent pgvector0.8.7-10007, both beta=no.14 final native identity/data/role/configuration/extension checks passed; BookOrbit remained healthy locally and publicly on r21 with the native DB. The original Docker DB/application and every data volume remain stopped and retained. Full evidence and formal artifact hashes are in the separate postgresql-spk project. No additional NAS reboot was performed for these metadata-only formal upgrades.
