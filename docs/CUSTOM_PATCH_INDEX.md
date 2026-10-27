# 定制补丁与上游升级索引

2026-10-26：正式基线v3.5.0（c59dd011），分支custom/bookorbit-v3.5.0。生产r21。需求由CUSTOMIZATION_REQUIREMENTS.md定义，状态和限制见CUSTOM_FEATURE_MATRIX.md及CUSTOMIZATION_REMAINING.md。

定制功能提交58af332d，历史迁入提交efab6262。同步新官方tag时检查从正式基线到定制分支的全部差异，不只检查最后一次提交。不要重新fork后丢弃本分支历史；保留origin为用户fork、upstream为官方，按CUSTOM_BRANCH_WORKFLOW.md在升级分支合并正式tag。

| 编号    | 定制范围                       | 关键代码                                                                                                                             | 升级回归                                                                 |
| ------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| BO-C01  | TXT上传、扫描、同书多格式归并  | upload、scanner、metadata/extractors/txt-format、group-loose-txt-epub                                                                | TXT/EPUB不重复建书、编码和权限                                           |
| BO-C02  | TXT主动转EPUB和直接网页阅读    | metadata/lib/txt-to-epub、reader/epub/txt-reader-cache、client/features/reader                                                       | 原文件保护、章节和进度、并发缓存                                         |
| BO-C03  | 中文元数据与封面               | metadata-fetch/providers/douban、fanqie、chinese-catalog、remote-image-headers                                                       | 同名候选、字段来源、真实封面、失败不清空已有值                           |
| BO-C04  | 番茄、起点公开免费章及通用书源 | server/modules/book-source、client/features/book-source、packages/types/book-source                                                  | API/DTO一致、来源限制、规则失败保护、取消和超时                          |
| BO-C05  | 异步任务与恢复                 | book-source-job.*、book-source-worker、db/schema/book-source-jobs                                                                    | 用户隔离、去重、租约、旧worker隔离、入库不自动重下                       |
| BO-C06  | 直链安全续传                   | book-request/fulfillment/direct-download.service、scripts/book-source/verify-direct-recovery                                         | Range、ETag和Last-Modified改变、进程中断恢复                             |
| BO-C07  | Gutenberg与漫画插件            | plugins/gutenberg、plugins/internet-archive-comics、book-filename.utils                                                              | 检索、实际下载、命名、审核入库、封面和漫画页                             |
| BO-C08  | 中文及状态反馈                 | client/locales、reader、settings、book/status、source-errors                                                                         | 语言切换、默认HTTP提示、阅读状态及前端权限                               |
| BO-C09  | 群晖构建及原生验证             | Dockerfile、scripts/synology、docs/SYNOLOGY_NATIVE.md                                                                                | 镜像依赖、普通用户、Node/Sharp/媒体、实际服务启动                        |
| BO-C10  | 原生共享PG迁移辅助             | scripts/synology/native/backup-container-db.py、stage-native-pg-app.py、prepare-native-pg-migration.py、apply-native-pg-migration.py | 一致快照、逐表核对、非超级用户、连接池额度、只读书籍、隔离网络与私有凭据 |
| PG-独立 | 共享数据库和扩展套件           | ../postgresql-spk                                                                                                                    | 独立项目维护，不作为BookOrbit上游补丁混入                                |

路径以server/src/modules或client/src/features为前缀的缩写；实际测试与部署证据见SYNOLOGY_DEPLOYMENT.md。

## 数据库迁移冲突

0125与0126是本分支已部署迁移。合并上游时检查迁移内容、snapshot及journal，不按序号覆盖或简单重命名已执行历史。必须在生产备份的独立恢复库验证升级，不让旧迁移重新执行。已有migration-ledger兼容规则也需要复核。

## 本轮提交验证

- 服务端45个相关测试文件：44通过、1跳过；1260项通过、7项专用数据库测试本机未执行。原群晖隔离数据库验收记录另存。
- 前端14个文件133项通过。
- 服务端与共享包生产构建通过，前端类型检查通过，25个语言目录11799英文键校验通过。
- 正常提交钩子执行ESLint与Prettier，通过后提交；没有跳过钩子。
- 未宣称Android实机、七猫正文、原生SPK完整迁移已完成，具体边界见剩余清单。
- 缓存、凭据、用户书籍及数据库文件不入Git。运行报告位于忽略的local/目录，文档保留摘要和复现方式。

2026-10-27补充：BO-C10包含迁移准备与显式切换工具、8项配置/回退边界测试、最新167表一致恢复及真实隔离应用验收。详见SYNOLOGY_PG_MIGRATION.md。上游合并需复核Compose配置格式、数据库环境变量、应用20连接池、鉴权会话字段及文件Range接口；不要覆盖NAS已生成的原生数据库部署profile。生产切换仍待单独确认。

Production migration is now complete, not pending: r21 uses the shared native PG. For BO-C10, future upstream synchronization must preserve the native compose profile, use native PG backups, retain connection-pool limits and avoid accidentally recreating the retired postgres service. The8 migration boundary tests and live NAS acceptance passed.
