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
- 未宣称Android实机、七猫正文、原生SPK公开正式发行及整机重启验收已完成，具体边界见剩余清单。
- 缓存、凭据、用户书籍及数据库文件不入Git。运行报告位于忽略的local/目录，文档保留摘要和复现方式。

2026-10-27补充：BO-C10包含迁移准备与显式切换工具、8项配置/回退边界测试、最新167表一致恢复及真实隔离应用验收。详见SYNOLOGY_PG_MIGRATION.md。上游合并需复核Compose配置格式、数据库环境变量、应用20连接池、鉴权会话字段及文件Range接口；不要覆盖NAS已生成的原生数据库部署profile。生产切换仍待单独确认。

Production migration is now complete, not pending: r21 uses the shared native PG. For BO-C10, future upstream synchronization must preserve the native compose profile, use native PG backups, retain connection-pool limits and avoid accidentally recreating the retired postgres service. The8 migration boundary tests and live NAS acceptance passed.

2026-10-27 BO-C09补充：原生应用材料准备与构建输入契约位于scripts/synology/native/stage-application-payload.py、payload-contract.py，合计20项测试。上游升级须更新runtime-source-lock.json、冻结应用来源和可执行文件哈希，复验Sharp平台依赖、媒体与Python集成，不从新镜像直接覆盖已验证的原生输入。组件来源、许可证及需要的对应源代码必须覆盖整个文件清单。

BO-C09正式入口补充：source-build.py、Source.Dockerfile和finalize-source-build.mjs从Git提交及pnpm锁文件构建程序，构建环境固定为Linux x86_64。原容器导出工具仅作兼容性对照。上游升级须复核pnpm版本、deploy行为、前后端构建命令、迁移文件、Kepubify及KOReader资源路径。

2026-10-28源码链路已实际通过：正式构建禁用legacy deploy，必须保留共享锁冻结部署、依赖层稳定归档和共享模块内部加载检查。stage-application-payload.py的--source-build路径承接编译产物，不再从线上容器导出或覆盖旧Sharp探针。打包回归合计38项；完整SPK验收仍未完成。

2026-10-28 BO-C09生产原生迁移已完成：native-service.py、spk/scripts、build-acceptance-spk.py、cutover-native-app.py及probe-installed-native.py纳入上游同步回归。10002生产在专用UID217211运行，8184及公网8926可用；12项生产API在服务重启前后通过。迁移执行器是一次性从旧bookorbit容器/数据库转入新bookorbit_prod_spk副本的工具，不是日常升级入口；后续上传SPK升级保留现有私有service.json及新库。不要再次启用保留的旧Docker应用、覆盖新库为旧bookorbit，或用只改版本号的包跳过迁移指纹保护。公开组件审计和正式发行仍待完成。

2026-10-29 BO-C08补充：统计配置元信息使用labelKey，元数据字段共用metadata-field-label.ts，表格列在useTableColumns组合层翻译而不改持久ID；动态提示、来源、星期、引导、画像和错误兜底统一国际化。审计入口scripts/audit-ui-localization.cjs扩展TypeScript脚本UI候选检查，候选并非均为漏译。合并上游时保留这层适配和en/zh资源，复验统计热力图与表格切换语言而不重建页面、用户自定义列不变。全前端741文件8336项测试通过；具体上线版本须另查部署记录，不能把本机通过当作现网已更新。

BO-C08上线确认：2026-10-29由原生10004交付，应用源码77afa4e5；115类固定通知/错误、31类HTTP提示及13类实体错误均用国际化资源。浏览器回归脚本verify-localization-browser.cjs已纳入仓库。上游合并时运行语言资源校验、全前端测试、静态及脚本UI候选审计，并核对统计和表格的即时语言切换；不要以构建成功代替实机前端资源与API验收。

区域元数据来源展示补充：五个国内来源使用client/public/assets/provider-icons中的官网图标，通过provider-icons.ts统一映射，来源及SHA256保存在regional-sources.json；不依赖浏览器访问官网图标地址。七个区域来源说明通过en/zh资源维护，描述元数据补充用途，不把下载能力说明混入元数据开关。后续同步上游须保留映射、静态素材和对应语言键。

区域来源展示回归：整页19个来源说明统一使用en/zh hints，保留各自的密钥要求。verify-provider-branding-browser.cjs在合成接口上下文校验19条中文说明和5个图标解码，不读取生产凭据；真实生产接口由NAS探针单独验收。

BO-C09启动回归补充：保留native-service.py的600秒有界就绪等待、临时进程记录无fsync策略及可信子进程身份检查。verify-native-lifecycle.py新增--readiness-delay参数，候选打包须绑定修改后控制器的真实普通账号收据。不要通过延长测试外层超时来掩盖控制器仍停留180秒，也不要去除配置/数据库备份的持久化同步。

BO-C09公开发行材料回归：verify-sharp-sources.py读取sharp-source-evidence-lock.json，将官方强摘要、Git文件身份与Google对象MD5弱对照分别记录。修改Sharp版本或配方须重新核对28项来源及补丁，不按旧锁自动放行；来源完整、对应构建依赖与公开批准仍是不同状态，不能直接将upstreamIdentityVerified计数当作公开发行通过。

BO-C09自用正式入口：build-private-stable-spk.py、private-stable-policy.py及对应测试应随上游同步保留。已有候选默认仍是Beta，正式入口要求与生产验收一致的源码/清单/控制器/迁移；改变应用或运行库后不能复用旧收据。private-stable metadata不等于publicRedistributionApproved，DSM描述和Beta标记须检查实际打包INFO与安装界面。

2026-10-29 TXT 组织与标题修复：上游 v3.5.0 的 walk.ts 未改，子文件夹合书来自原 book_per_folder 配置。txt-format.extractor.ts 增加标题文字/装饰线/网址校验（提交164dc3ed，12项提取器用例）。split-ebook-library.py 为有边界的一次性数据修复，13项保护测试；probe-txt-library-split.py 验证重复扫描、10个TXT阅读、文件哈希和阅读历史。probe-installed-native.py 支持显式 expected-books，避免数据增长后仍固定11本。上游合并时保留提取器回归，勿将迁移工具当常规启动迁移执行。

2026-10-29 豆瓣搜索回退（7524e3f9）：subject_suggest对龙岭迷窟、精绝古城返回空数组，但公开www.douban.com/search?cat=1001有图书结果。DoubanProvider在非ISBN建议检索均为空时请求一次公开图书搜索；douban-page解析限制30行/10个唯一候选，只接受HTTPS book.douban.com/subject/数字/，安全解码豆瓣link2，不跟随任意链接。保留作者、出版社、年份、简介、封面，最多3个详情请求，沿用匹配管线与14秒总期限；验证页或结构变化报错而非假空结果。135项相关回归、生产类型检查和ESLint通过；真实龙岭迷窟HTML解析10个候选。上游合并须保留安全URL、空建议回退及ISBN不扩搜测试。

2026-10-29 作者来源扩展3172b72e：shared AuthorMetadataProviderKey/字段能力、AuthorsModule注册、国内作者页面解析及查询、前端来源标签/安全链接、中英文提示、默认字段优先级同时维护。百度百科只接受作家职业词条；豆瓣仅从明确单一作者的图书页作者简介区取传记，人物主页验证页不绕过；番茄无authorId的出版署名不伪装平台主页，字体私用区简介暂不入库；起点由精确作者署名定位主页。现有保存的字段优先级保留，不自动覆盖用户规则。作者模块与扫描合计611项、前端作者188项通过，前端类型检查需兼容TS6的ignoreDeprecations=6.0。

转换扫描修复103a44e2：handleScanBookPerFile必须先查已注册文件归属，加载原书目全部附件再处理，防止监视器将已附加EPUB另建书目并迁移文件。回归覆盖TXT/EPUB任一事件不新建书、不删除另一格式，不能仅测试转换接口返回成功。历史已拆分条目须另行保留阅读记录修复，正常全扫有意保留不同已有书目，不能假称会自动合回。

2026-10-30 历史转换关联修复de681e7d：repair-converted-edition.ts及显式转换弹窗操作纳入同步检查，路由同时要求LibraryUpload/LibraryDeleteBooks且验证库editor权限。只支持同目录同名同标题且唯一的TXT/EPUB，事务锁定及真实外键检查，保留fileId/会话/尝试/进度，拒绝冲突状态和未支持的源关联。helper删除书目必须调用带SQL范围的deleteBooksWithHashInvalidation，不能直接删除文件或清空阅读历史；未来新增FK必须默认拒绝非空未知关联。447项上传与6项弹窗回归通过，现网历史修复已通过页面实操：余罪10保留6460/6474两个文件，移除重复书目25，六项摘要核验及页面重扫通过，阅读会话/尝试/状态/进度均保留。自用正式10016经DSM部署及12项生产API验收通过，详见SYNOLOGY_NATIVE.md的2026-10-30完成记录。

2026-10-30 作者头像补充：百科正常302曾被redirect:error误报fetch failed，readBaidu改为最多两次同HTTPS源、同姓名、数字词条ID的手动跳转；固定身份查询禁止换ID，404词条返回无匹配，跨站/登录/异名页不抓取。parseBaiduAuthor合并职业和词条人物描述，支持职业为公务员的作家以及明确有声书播讲者，不接受泛网络主播或植物等同名页。全部作者模块431项通过；上游同步须保留跳转、固定ID和有声书身份回归，不应放宽为任意重定向。
