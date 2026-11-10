# v3.7.0 定制功能逐项升级验收

本表由现有需求清单、定制补丁索引、功能矩阵及用户后续需求整理。每一项在完成源码核对、自动测试、隔离业务及群晖升级核对后填写证据。旧版已验收记录只作基线，不自动计为新版通过。

- 升级起点为custom/bookorbit-v3.5.0的6f053c6f，当前生产3.5.0-10041。
- 目标为官方v3.7.0，提交6f8f5f4818eb737dc4d78fc5b5294fc3adb26860。
- 升级分支为upgrade/upstream-v3.7.0。
- 原生PG独立项目继续按既有配置接入。用户此前要求不创建数据库备份，当前升级沿用该约束。
- 七猫正文、番茄会员正文、Android TXT原生阅读和手机实际性能等原有待办维持独立状态。

| 编号    | 功能                | 核对范围                                                  | 源码       | 自动测试           | 隔离业务                  | 群晖     | 证据                                                                                              |
| ------- | ------------------- | --------------------------------------------------------- | ---------- | ------------------ | ------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| BO-C01a | TXT上传与编码       | TXT上传、UTF-8/GBK/GB18030/UTF-16、权限                   | 已合并核对 | 通过               | 待验收                    | 待验收   | `server/src/modules/metadata/extractors/txt-format.extractor.test.ts`                             |
| BO-C01b | 扫描组织方式        | 每文件一本、每目录一本、既有组织配置及同书附件            | 已合并核对 | 通过               | 待验收                    | 待验收   | `client/src/features/scanner/composables/useLiveScanBooks.test.ts`                                |
| BO-C01c | 同书格式归属        | 转换后、文件监控、定向扫描及全量扫描均保持同一本书        | 已合并核对 | 通过               | 结构/数据通过，HTTP待验收 | 待验收   | `server/src/modules/scanner/lib/group-loose-txt-epub.test.ts`                                     |
| BO-C02a | TXT转EPUB           | 编码与章节选项、已有EPUB保护、原始文件和阅读记录          | 已合并核对 | 通过               | 结构/数据通过，HTTP待验收 | 待验收   | `client/src/features/book/components/__tests__/TxtConversionDialog.spec.ts`                       |
| BO-C02b | TXT网页阅读         | 直接阅读、章节、编码、位置、缓存与并发                    | 已合并核对 | 通过               | 待验收                    | 待验收   | `client/src/features/reader/shared/composables/__tests__/useReaderProgress.spec.ts`               |
| BO-C03a | 中文书籍元数据      | 豆瓣、百度、番茄、起点、七猫的搜索、匹配、来源及错误      | 已合并核对 | 通过               | 待验收                    | 待验收   | `server/src/modules/metadata-fetch/providers/chinese-catalog/baidu-page.test.ts`                  |
| BO-C03b | 自动元数据队列      | 全局与书库覆盖、导入触发、并发上限、失败与重试            | 已合并核对 | 通过               | 待验收                    | 待验收   | `client/src/features/settings/metadata-auto-fetch/__tests__/BookMetadataFetchSettings.spec.ts`    |
| BO-C03c | 封面                | 代理、来源请求头、失败回退、已显示封面空状态              | 已合并核对 | 通过               | 待验收                    | 待验收   | `client/src/features/book-source/SourceBookPreview.spec.ts`                                       |
| BO-C04a | 小说聚合搜索        | 部分关键词、多结果、封面作者简介分类和来源标记            | 已合并核对 | 通过               | 待验收                    | 待验收   | `client/src/features/book-source/composables/__tests__/useFanqieAcquisition.spec.ts`              |
| BO-C04b | 下载来源设置        | 滑动开关、提供商前提、独立下载开关及后端强制策略          | 已合并核对 | 通过               | 待验收                    | 待验收   | `client/src/features/settings/metadata-preferences/__tests__/ProviderConfigPanelControls.spec.ts` |
| BO-C04c | 公开章节引擎        | 番茄、起点免费卷、通用JSON/CSS规则、限流与取消            | 已合并核对 | 通过               | 待验收                    | 待验收   | `server/src/modules/book-source/chapter-download.service.test.ts`                                 |
| BO-C05a | 任务列表            | 分页、书名来源、状态时间、结果跳转与终态确认删除          | 已合并核对 | 通过               | 待验收                    | 待验收   | `client/src/features/book-source/composables/__tests__/useFanqieAcquisition.spec.ts`              |
| BO-C05b | 任务恢复            | 所有权、重复提交、租约、旧worker隔离和核对后重试          | 已合并核对 | 通过               | 待验收                    | 待验收   | `server/src/modules/book-source/book-source-job.repository.test.ts`                               |
| BO-C05c | 下载进度和超时      | 实际章节计数、无新增超时、持续进度继续、取消与进程退出    | 已合并核对 | 通过               | 待验收                    | 待验收   | `server/src/modules/book-source/book-source-progress.service.test.ts`                             |
| BO-C05d | 章节续传缓存        | 每本隔离、重试复用、完整性校验、活动保护和7天清理         | 已合并核对 | 通过               | 待验收                    | 待验收   | `server/src/modules/book-source/chapter-download.service.test.ts`                                 |
| BO-C06  | 直链安全续传        | Range、ETag、Last-Modified、416、进程中断及变更拒绝       | 已合并核对 | 通过               | 待验收                    | 待验收   | `server/src/modules/book-request/fulfillment/direct-download.service.test.ts`                     |
| BO-C07a | Gutenberg与漫画书源 | 插件检索、文件下载、命名、元数据封面与入库                | 已合并核对 | 插件14项通过       | 待验收                    | 待验收   | —                                                                                                 |
| BO-C07b | 现有文件格式        | EPUB/PDF/MOBI/AZW3/FB2/漫画/M4A读取与下载                 | 已合并核对 | 通过               | 待验收                    | 待验收   | `client/src/features/reader/audiobook/__tests__/AudiobookReaderView.spec.ts`                      |
| BO-C08a | 中文与动态标签      | 设置、任务、状态、图表、提示、国际化即时切换              | 已合并核对 | 通过               | 待验收                    | 待验收   | `client/scripts/locale-catalog-validation.spec.mjs`                                               |
| BO-C08b | 用户权限            | 接口/DTO/返回值、书库访问、配置和私有数据隔离             | 已合并核对 | 通过               | 待验收                    | 待验收   | `server/src/modules/book-source/book-source.http.test.ts`                                         |
| BO-C09a | 原生运行库          | 普通UID、Node/Sharp/媒体/Python/CMap、路径和私有环境      | 已合并核对 | 原生工具205项通过  | 待验收                    | 待验收   | 原生单测收据与控制器10项生命周期收据                                                              |
| BO-C09b | SPK升级生命周期     | 原生启动监督、延迟就绪、配置持久化、正常DSM升级           | 已合并核对 | 原生工具205项通过  | 控制器通过，应用待验收    | 待验收   | 原生单测收据与控制器10项生命周期收据                                                              |
| BO-C09c | 套件图标            | 网页Orbit标识、64/256 PNG、实际包与DSM显示                | 已合并核对 | 原生工具205项通过  | 待验收                    | 待验收   | 原生单测收据与控制器10项生命周期收据                                                              |
| BO-C10  | 原生共享PG18        | 连接池、非超级用户、已有迁移哈希、旧路径及生产配置        | 已合并核对 | 迁移单测与PG18通过 | 结构/数据通过，HTTP待验收 | 待验收   | 隔离PG18迁移131→133，旧账本及业务数据校验通过                                                     |
| BO-C11a | 国内作者提供商      | 百度/豆瓣/番茄/起点、搜索/链接/优先级/访问失败            | 已合并核对 | 通过               | 待验收                    | 待验收   | `server/src/modules/authors/author-enrichment-config.service.test.ts`                             |
| BO-C11b | 作者头像保存        | 编辑保存、异步图片落盘、详情/缓存作者列表即时一致         | 已合并核对 | 通过               | 待验收                    | 待验收   | `client/src/features/author/composables/useAuthorBooks.test.ts`                                   |
| BO-C12  | 中文阅读字体        | 5家族7文件、中文名、设置滑动开关、升级保留和字体服务      | 已合并核对 | 通过               | 待验收                    | 待验收   | `client/src/features/reader/epub/__tests__/publisher-font-size-transform.spec.ts`                 |
| BO-C13a | 可配置验重          | 全局与书库覆盖、来源/ISBN/SHA256/标题作者理由和媒体隔离   | 已合并核对 | 通过               | 结构/数据通过，HTTP待验收 | 待验收   | `server/src/modules/book-duplicates/book-duplicate-normalize.test.ts`                             |
| BO-C13b | 重复导入选择        | 上传、断点上传、小说、Book Dock的新建/追加/同格式替换     | 已合并核对 | 通过               | 结构/数据通过，HTTP待验收 | 待验收   | `client/src/features/import-review/ImportReviewDialog.spec.ts`                                    |
| BO-C13c | 替换一致性          | 保留bookId/fileId/元数据/阅读记录，文件版本校验和失败恢复 | 已合并核对 | 通过               | 结构/数据通过，HTTP待验收 | 待验收   | `server/src/modules/upload/import-file-commit.service.test.ts`                                    |
| BO-C14  | 已入库结果标记      | 来源标识、明确/可能重复、可见书库及跳转已有书目           | 已合并核对 | 通过               | 结构/数据通过，HTTP待验收 | 待验收   | `client/src/features/book-source/SourceBookPreview.spec.ts`                                       |
| BO-C15  | 大型文件列表        | 服务端分页、既有附件选择、有声轨及同路径TXT明确确认       | 已合并核对 | 通过               | 待验收                    | 待验收   | `client/src/features/import-review/ImportPolicySettings.spec.ts`                                  |
| BO-C16  | 共享评论            | 书评/章节/段落、回复、删除权限、幂等和分页                | 已合并核对 | 通过               | 结构/数据通过，HTTP待验收 | 待验收   | `client/src/features/book/composables/useBookComments.test.ts`                                    |
| BO-C17  | 最近阅读格式进度    | 辅助格式、向后阅读、音频时间优先及Android DTO             | 已合并核对 | 通过               | 结构/数据通过，HTTP待验收 | 待验收   | `client/src/features/book/lib/book-card-mapper.test.ts`                                           |
| BO-C18  | Android联动         | custom.7字体、CFI、时间、评论、认证及内容Range接口        | 后续适配   | 后续验证           | 后续验证                  | 后续验证 | 按用户要求，完成服务端后推进                                                                      |

## 数据库迁移专项

两条账本的共同前缀为前125项。官方后续125至140与本分支125至130具有同序号不同内容。保留已部署迁移文件、时间及哈希，以合并后的schema和现有已部署snapshot通过Drizzle生成升级差异。逐项检查官方数据迁移、默认权限和删除结构。先在独立PG18验证旧链、升级链、数据与所有权，再允许正常SPK升级执行。

## 完成条件

所有已实现定制项均有新版证据。新增上游功能与定制验重、附件归属和元数据规则的重叠均须处理。界面、后台任务与数据库验证分别记录，原有待办继续列明。正式包绑定本次源码、迁移、载荷及真实验收收据。

## 本轮进展

- 生产仍为3.5.0-10041。用户要求先完成群晖服务端升级与定制功能验收，再继续Android。
- 33处合并冲突已逐项处理，保留国内书籍与作者提供商、TXT、下载任务、验重和共享评论。完整服务端测试19347项通过，23项跳过。完整前端测试8934项通过。两端正常type-check及lint通过。真实数据库E2E尚待执行，这些测试数量不作为真实数据库验收。
- 历史131项迁移账本及262个既有迁移文件保持一致。Drizzle分两步生成0131和0132结构迁移，先新增字段，再调整包含新字段的主键。用户明确授权在其前后原样复用v3.7.0官方的编辑权限恢复、章节来源与章节锁定回填、合并权限初始化，共4条DML。来源摘要保存在本机验收目录的data-backfill-provenance.json。
- 只读生产预检时，两座书库均为books，12张将移除的播客表均为空。升级入口另加运行时检查，如出现播客数据或播客书库即拒绝升级。
- 原生普通账号生命周期10项检查通过，含35秒延迟就绪、崩溃恢复、孤儿进程处理与端口占用保护。该收据仅证明控制器生命周期，完整3.7载荷仍需群晖验收。
- 3.7新增英文资源最初有1794个键缺少中文。已复用140项既有中文并补齐其余1654个键，新增批量操作10项国际化。885个Vue模板静态审计无非预期英文，中文缺失键为0，全部13241项英文资源的占位符校验通过。动态脚本候选须结合调用方区分内部错误、品牌名称与实际界面内容。
- Android旧进度、智能书架和两个阅读统计调用与3.7接口有兼容差异。新版通用接口适配已开始，首轮本机HTTP及阅读器测试通过。按用户最新要求暂停客户端后续工作，服务端独立推进，客户端正式适配与发布单列后续。
- 当前Tailscale访问地址为100.86.77.124，SSH重试已连通。

### 真实隔离验证与构建状态

群晖原生PG18的131→133迁移已通过，包含旧账本与SQL逐项一致、书籍/文件/阅读进度/评论/来源数据摘要不变、官方章节来源与章节锁定回填、编辑权限恢复、原本刻意设置的只读权限保留、合并权限初始化及重复执行。一次性数据库和角色已删除。此记录仅证明数据库结构和数据迁移，完整载荷HTTP与页面尚待验收。

Mac端通过SSH转发运行应用E2E时，群晖SSH服务拒绝端口转发，测试连接未建立。改为在群晖直接运行原生隔离载荷后验证应用，不调整SSH安全设置。

原生工具22套205项测试通过。Mac空间不足时，仅清理12个已核对为旧提交、未被Git跟踪的生成stage，释放约13.1GiB，恢复约16.4GiB可用空间。源码、验收文本与当前10041基线仍可供构建对照。Linux源码构建及DSM升级验收尚未完成。

### 原生载荷与网络等待

本次应用源码提交为dd3dd310fa7da355c9930b70965e492f061bbefd。Linux x86_64构建完成，固定Node26.11.1、pnpm11.28.9，前端、服务端、共享模块与Sharp原生读写核验通过。完整装配包含41588项文件，原生载荷清单SHA256为fde832ebe1df077d3dc92fde38bec229060be1ac6d2326f4343cf78247758643，迁移SHA256为ec62df59ecbbcd04e4d3b8704dcb57cf78c5b84a8572029283fa0e3f5e20881b。尚未生成或安装3.7 SPK。

插件专项补查14项通过。本机3.7编译运行时实际加载Gutenberg插件、搜索到4个资源，经直链下载器下载107350字节公开EPUB并验证容器结构，测试暂存文件自动清理。这只证明本机该样本的运行时兼容，群晖完整请求、人工审核和入库尚待复验。漫画本轮只有解析及来源限制测试，外网下载仍单列。

Mac空间再次不足时，又清理18个已核对的旧生成stage，释放约19.69GiB。两轮共清理30个未跟踪的历史stage目录，均为应用、支持库或辅助组件生成物，具体路径见本机build-space-cleanup.json和build-space-cleanup-second.json。没有删除源码、生产数据或既有配置，没有创建数据库备份。

上传372MiB原生载荷时连接中断。随后只读确认Mac的Tailscale为Stopped，100.86.77.124与192.168.50.235的SSH均超时，已请求用户恢复连接。群晖隔离HTTP、浏览器验收与DSM安装需网络恢复后继续，不能标记为通过。连接中断前实际确认生产仍为3.5.0-10041。

### 原生语言目录回归

完整群晖隔离HTTP已通过，包含普通账号、TXT导入/直接阅读/转换同书及原进度、共享评论双账号回复与权限、验重设置与文件分页、拒绝不接收EPUB的目标库等16项。首次独立脚本的360秒窗口遇冷启动超时，改用正式控制器已有的600秒窗口后通过，随后样本启动分别为165.9秒和43.4秒。路径校验与书库目录重叠拒绝曾拦截测试目录，已改为允许根下的独立平级样本库。生产尚未升级。

真实浏览器发现每月挑战仍为英文。3.7服务端的serverText从运行时locales目录读取原始语言资源，原生Source.Dockerfile遗漏了官方Dockerfile新增的该目录。现补齐完整语言目录，并在Linux构建末尾实际调用serverText核对英文与中文，再将结果写入构建收据；缺少此运行时校验的构建被拒绝。原有客户端中文资源及前端编译正常不等于服务端动态文本已本地化。修正后的完整载荷须重新构建及群晖验收。

### 同迁移版本升级守卫回归

10042已通过DSM升级及生产只读验收。由相同应用载荷生成的10043在postupgrade被拒绝，实际拒绝发生在运行迁移之前。原因是验收收据只列出3.5旧迁移指纹，运行时把已等于目标的3.7指纹也当作跨schema前置版本检查。此前单元测试默认把目标指纹放入允许列表，未覆盖正式收据只有旧指纹的场景。

守卫现接受与包内目标完全相同的前置迁移指纹，同时继续核对收据、来源、载荷、策略及实际迁移文件摘要。未知前置指纹和被改写的迁移仍拒绝。新增回归移除目标允许列表项，验证同schema接受及改写SQL拒绝。22套207项原生测试通过，正式安装流程需由下一修订包重新验证。应用源码与载荷保持7d867edd，不重新编译已通过的应用。
