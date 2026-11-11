# 定制补丁与上游升级索引

当前部署基线为2026-11-12验收的3.8.0-10046自用正式版，逐项结果见[3.8验收表](UPGRADE_V3_8_0_ACCEPTANCE.md)。下方按日期保留历史记录。

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

作者编辑保存语义补充：用户确认使用“编辑作者→保存”，原流程只提交文字字段，详情显示的远程预览头像没有入请求。编辑表单现预填缺失简介并展示待保存预览头像，默认勾选随本次保存持久化，可取消；已保存头像不受影响。UpdateAuthorDto接受经过嵌套校验的previewImage来源身份，不接收任意图片URL；服务端先查库编辑权限、回查来源及相同作者姓名，再下载头像，失败不保存文字字段且不返回成功。不调用applyMatch，不清空手动字段或绑定整套匹配。前端保持失败表单并拒绝无imageUrl的假成功响应。作者后端441项、前端191项通过，需从真实编辑保存页面验收后再记上线完成。未来同步上游需保留DTO与前端载荷的一致性。

真实页面验收再现了列表缓存缺陷：编辑保存返回200且头像已落盘，但KeepAlive缓存的AuthorsView仅onMounted加载，返回列表仍无头像。列表恢复时现按保留的筛选/排序重新请求一页，首访不重复加载；不依赖用户手动刷新，也不在客户端对整库重新排序。KeepAlive往返行为回归与保存流程均需纳入上游同步。此前10018候选已装，10019打包但未安装，不能将其视为包含列表修复的最终交付。

入口缓存保护：真实浏览器在10021仍加载旧index-D0MmTEsJ.js，NAS本地和公网实际入口已为index-C8vMfclO.js。原生归档mtime=0，同长度index的弱ETag恒为W/"4bb9-0"，导致错误304并保留旧脚本。staticAssetCacheOptions禁止尺寸/mtime验证器，对非指纹入口HTML、sw.js、更新脚本使用no-store，保留assets中指纹资源长期immutable缓存；不修改文件Range接口。HTTP集成用例先复现原策略304，再验证同大小/零mtime的新入口、SPA和SW均返回200及新内容，另验证指纹缓存和路径保护，共6项通过。升级验收必须比对浏览器入口脚本与NAS已装public/index.html，不能只读套件版本即宣称前端生效。

2026-10-30 TXT转换并发窗口补充：10023现场再次拆书，书目1/27与16/28分别共享主文件6479/6480。真实日志显示定向扫描分别早于addFileToBook完成2.156秒、3.321秒，文件已发布但归属尚未提交；此前103a44e2只保护已登记附件。UploadModule现显式共享SelfWriteRegistryModule；addFileToBook在发布文件前begin，覆盖媒体检查和整个事务提交，成功或失败finally释放引用计数。文件监视器既有等待机制因此持续到归属提交，额外为定向、目录、全量扫描保留正在自写的书及其全部已登记文件，目录扫描也使用与全扫相同的附件归属分组。不能用增加固定debounce替代事务边界保护。回归先复现原代码发布时无保护的失败，再以真实FileWatcherService结合20秒提交延迟验证期间不处理、提交后只处理一次；全扫覆盖未枚举到正在写入的另一格式时不误删附件。上传/扫描1056项通过，静态和生产类型检查通过。实际大书副本转换、重扫和历史两对书目的页面修复仍须实机验收后才记完成。

TXT 转换并发修复实机完成：a316516b 经 10024 验收后交付自用正式 10025。15 MB 与 465 KB TXT 副本分别转换后保持原书双格式，两次页面重扫无新增或缺失；现有 1/27 与 16/28 两组从页面重新关联，原文件、元数据及阅读记录摘要不变，生产重扫仍正确。正式版 12 项 API、10 项缓存保护和三份修复模块哈希均通过。后续上游合并必须保留上传模块共享注册表注入、发布前到事务完成的保护边界以及全扫保留所有关联文件的回归，不能只保留已登记附件分组。完整证据见 SYNOLOGY_NATIVE.md 的同日记录。

2026-10-31 小说书源下载页补充：部分标题浏览显式请求 resultsPerProvider=20；仅在显式浏览番茄/起点时让标题包含关键词的候选通过最低相关性门槛，保留单书匹配与其他提供商原语义。真实番茄接口对“我在”返回多本含完整标题、简介和封面，原页面的单书相关性过滤丢掉了大部分结果，且从未渲染封面。结果卡片复用既有封面代理显示，支持简介展开/收起、损坏图片占位、作者分类；结果区提前，书库选择靠近搜索，增加加载、空结果和排队反馈，后续聚合版移除手动来源选择。所有新提示使用 en/zh 国际化键。上游合并须保留显式浏览与单书匹配边界，不应全局放宽元数据自动匹配。该补丁随后与聚合来源需求一起由 10028 完成实机交付，验收记录见下文。

同日补充聚合下载需求：下载页取消单来源下拉框，统一请求设置中已启用的番茄/起点来源；每条结果保留来源标记并按对应来源下载。提供商配置新增各自独立 downloadEnabled，兼容旧配置，禁用下载不关闭元数据；仍需先启用提供商。开关由已有配置权限、DTO布尔校验和持久化事务管理，无数据库结构变更。后端在任务提交、重试及后台下载开始处均检查 DownloadSourcePolicy，不仅依赖前端隐藏。10026仅构建，未安装，不能当作含聚合来源设置的最终版本。

10028 上线确认：baeeb577 与 a507f70f 合并交付自用正式包。真实“我在”搜索返回 11 条、两个来源、全部封面加载；独立开关保存后排除起点但保留其元数据，最终已恢复开启。正式版 13 项 API、10 项缓存检查和 8 份模块/页面哈希通过。所有新提示国际化；后续上游同步需保留显式小说浏览语义、来源 provenance、配置嵌套 DTO、DownloadSourcePolicy 及对应权限和任务校验。

2026-10-31 番茄原生下载启动漏检修复：10028 搜索与来源设置通过，但真实任务在 285/537 ms 退出；套件账号以相同最小环境执行 Node 返回 127，缺少 libatomic.so.1。TomatoRuntimeService 启动 Node guard 时剥离了原生服务的 LD_LIBRARY_PATH。环境构造现仅透传必需运行库路径，设置隔离 HOME 与固定 PATH，不向子进程传递数据库、JWT 或 LD_PRELOAD。真实相同 guard 路径在修复环境下启动与目标书预览通过。verify-tomato-runtime.py 新增 --guarded，检查原生 Node guard、下载器子进程监听、认证与退出；不能以二进制直启探针替代服务端实际下载链路验收。后续已由 10030 完成实际重试下载与入库，并合并交付 10034；详见 SYNOLOGY_NATIVE.md。

同日真实正文下载进一步暴露新书上传并发窗口：10029 已修复原生 guard 启动，目标书 219.896 秒下载 8,711,977 字节并通过 EPUB 校验；普通 storeUpload 发布文件后未登记自写保护，监视器先建空书目 31，上传事务随后插入冲突，旧错误清理删除已发布文件。保护现覆盖新书上传发布至登记提交，并仅清理临时数据，不删除已发布文件。增加真实 FileWatcherService 的 20 秒延迟登记回归。入库失败不自动重下，页面新增明确核对未入库后的确认重试；严格 DTO 仅接受 true，所有权、图书库编辑权限、来源开关、失败状态、结果未关联及事务内重复任务检查仍强制执行。运行中/已完成状态不能借此重试。用户界面不再暴露原始 SQL，完成任务可直接查看书籍。原书库数据不通过 SQL 修复；空书目可由正常上传复用。10030 已经从页面重试原任务并复用空书目成功入库，最终 10034 合并交付；保留上述故障复现记录。

任务列表与进度补丁：9649d070、243153c5。上游同步须一起保留 DELETE 路由、当前用户与终态谓词、同用户重试锁和删除确认；只删除任务记录，不能级联删除书籍。共享 BookSourceJobProgress、worker 回调、来源服务参数、Tomato 任务计数验证、通用章节写入计数、单活动用户隔离快照及前端 progress 必须配套合并。未知总数不伪造百分比；只对完成任务显示完成状态。完成任务删除、取消测试下载、31→32→35% 的真实进度和手机布局已在 10033 页面验证；原书 33 的文件、元数据和阅读摘要不变。详见 SYNOLOGY_NATIVE.md。

10034 最终上线确认：列表与进度候选实机通过后，同源码/载荷构建自用正式并经 DSM 安装；无 Beta，12 项生产 API、10 项缓存和 8 份模块/页面哈希通过。旧包与自动配置副本已按用户既有要求清理；配置、业务数据库和书籍文件保留。正式收据及清理记录见 SYNOLOGY_NATIVE.md。应用源码提交 243153c5，列表提交 9649d070，原生启动和上传保护分别为 d98cd8ed、9238a1e6。

## 2026-10-31 统一重复导入确认（构建前记录）

新增共享 imports 模块：全局默认与书库覆盖、完整 SHA-256/来源编号/有效 ISBN/书名作者规则，跨库受访问权限约束。小说搜索标记已入库或可能已入库；已完成任务记录不再阻止明确的新下载，来源身份另表持久保存。上传、断点上传、小说任务与 Book Dock 批量入库使用明确的新建、追加、替换同格式文件选择；等待选择保留私人暂存或原 Book Dock 单元。书名作者只作可能匹配，不自动合并。

替换保留 bookId、fileId、书目元数据与阅读记录，先验证当前完整文件版本，发布与登记失败可恢复原字节。多文件单元替换只针对界面所示的主文件，其余内容文件追加；界面须明确说明。追加和替换只更新必要的文件技术信息，有声轨先测时长，不覆盖书籍简介或封面。Book Dock 正常发布也使用共享自写登记，避免扫描抢先归属。

本机相关后端 892 项、前端 127 项回归通过；独立 PostgreSQL 16 的迁移/并发 9 项、独立 PostgreSQL 18 完整迁移链及两种组织方式、单文件和分组的真实 HTTP 确认验证已通过。多文件故障允许逐文件重试，整批文件并非一个文件系统原子事务；断电恢复、外部任意程序同时改写等全部组合没有穷举。此条为构建前证据，生产仍是 10034，不能据此宣称新功能已部署。

安装前现场规模检查发现现有有声书包含 2614 个 M4A 音轨，不能沿用一次取全部附件再按总数拒绝的候选读取。现按书籍使用窗口序号取最多 50 个内容文件，完整哈希的候选单独限量读取；文件选择继续按 ID 游标每页 50 项。已证实同一本书的内容相同后不再重复哈希其余副本。合成 2614 音轨的 PostgreSQL 18 API 场景须纳入回归，原候选尚未安装。

补充同路径 TXT：缺少作者或 ISBN 且内容变化时，物理目标路径已存在也应提供明确替换/新建选择。服务端核实目标书籍并在私人待确认行保存其 FK，读取和提交均重新校验当前权限，不接受客户端路径。此匹配只标记“待确认”，不当作内容相同。替换沿用文件哈希历史与 KOReader 修订失效机制，保留书目及文件 ID。追加迁移 0129；PG18 真实 multipart、确认和 2614 音轨场景合计 7 项通过，相关后端 892 项仍通过。

## 2026-11-01 功能清单及交付状态同步

本轮功能均纳入需求跟踪：下载来源统一滑动开关；常用阅读字体；搜索结果“已入库/可能已入库”标记；全局默认与书库覆盖的可配置验重；重复下载/上传/断点上传/Book Dock 入库时选择新建、追加或替换选定同格式文件；保留书目、文件 ID、元数据与阅读记录；大型有声书文件分页；同路径 TXT 内容变化的明确确认。

验重依据包括来源编号、有效 ISBN、完整 SHA-256、书名作者等，区分明确标识与可能匹配，并检查媒体类型、跨库范围及访问权限。对应提交：字体/开关 b648a700，统一验重 2b64688c，大型文件列表 47a34bc8，同路径 TXT 8b376641。

字体已通过页面导入并验证加载：Noto Serif CJK SC、Noto Sans CJK SC 各常规/粗体，以及霞鹜文楷常规，共 3 家族 5 文件，来源、哈希及许可留存。其余上述功能源码与相关隔离测试已完成，最终部署后的真实页面验收尚未完成。

此前“生产仍是 10034”属于历史记录：DSM 实际安装 10035 的源码为 47a34bc8，旧升级守卫拒绝结构变更，导致安装失败。用户明确授权后，已通过 SSH 执行套件原生迁移 0127/0128 并恢复服务，没有创建数据库备份。健康接口 200、数据库 up；原 23 本书、6482 文件、元数据、作者关系及阅读记录的数量与完整行摘要均一致。

待完成：修复 DSM 套件升级流程与套件状态；部署最终 8b376641 及 0129；验证页面上的开关、标记、规则、新建/追加/替换、待确认任务刷新恢复与字体持久化；清理临时验收库；完成自用正式包安装及收据。不得将源码测试或当前服务恢复描述为正式包已全部验收。

2026-11-01 作者头像复查：真实列表和详情 API 均显示刘慈欣（23）的 imageUrl/description 为 null，详情显示百度百科临时预览；通过页面编辑作者并保存，PATCH 200，列表及刷新后均出现头像。发现编辑框先打开、预览后到达时，旧逻辑只在打开瞬间记录头像，可能漏存；源码已监听迟到预览，保留已输入文本和头像勾选选择，19 项相关测试通过，格式与 ESLint 通过。本次源码修复尚未构建部署，不能标为所有头像故障彻底解决。

字体已通过 BookOrbit 服务端字体页面扩充至 5 家族 7 文件：宋体 Noto Serif、黑体 Noto Sans、霞鹜文楷、霞鹜臻楷 v0.827、朱雀仿宋 v0.212。使用中文分类加原字体名，避免当前 CSS 家族名对纯中文名称折叠的冲突。字体属于各自作者的开放许可作品，上传至 BookOrbit 字体数据目录供阅读器使用，不是安装群晖系统字体，也非 BookOrbit 自有版权。新增许可与摘要留存在服务端字体目录，原始发布链接及 SHA-256 补入 reading-fonts-manifest.json。

## 2026-11-01 自用正式 10037 交付完成

本条更新前述 10034/10035/待部署记录：10036 候选与 10037 自用正式包均通过 DSM 上传安装，源码 c53026122d2b77edd72daac822027e5ea89d54cd，打包提交 ddc2900b。10037 的 releaseChannel=stable、INFO 无 beta 字段、DSM 状态 running/status_code=0。正式包 SHA-256：e153bdcc92de923c59ed2ccdb1dd33d691ebfb47c8990c8607e329499a807d88。保留最终安装包 local/synology-native/spk/private-stable-10037/bookorbit-native_x86_64_3.5.0-10037.spk。

升级流程已改为核对源码、载荷、迁移、已审阅前置版本及策略摘要，再以套件普通账号运行包内迁移。PG18 隔离数据库由 127 条迁移增量升到 130 条且哨兵数据保留；生产 10036 正常应用剩余 0129，10037 同 schema 升级正常完成。没有数据库备份。旧故障记录保留用于回归，不代表当前套件仍损坏。

页面验收：先打开作者编辑框、再放行延迟的元数据请求，头像保存勾选会出现且默认开启；未提交该作者修改。刘慈欣已通过页面保存，正式包作者列表及刷新后头像加载成功。源码针对性 19 项测试、格式和 ESLint 通过。字体 5 家族 7 文件在正式包页面全部 FontFace.load 成功，中文分类并保留唯一原字体名；开放许可和摘要留存在字体数据目录。

小说下载来源已使用圆形 role=switch；保留用户原状态（番茄开、起点关），未擅自开启来源。猎罪神探真实搜索展示“✓ 已入库”和“? 可能已入库”及正确书目链接。临时书库从页面创建为 book_per_file，验证 TXT 首次上传、同路径不同内容确认、替换后不增书、明确新建后两本、完整哈希命中、刷新后待确认恢复、独立规则保存和恢复全局继承。其目录最初继承只读 ACL 导致验收上传 500，补充该临时目录的套件写权限后通过；未改原库 ACL。

临时书库和样书已从页面删除，其两个 TXT 所在独立目录随后清理。本机两个专用测试数据库容器已移除。正式包 12 项生产 API、10 项静态缓存、8 份关键前后端文件摘要均通过。原 23 本书、6482 文件、元数据、16 位作者、26 条作者关系、9 条阅读状态、5 条阅读进度的完整行摘要与升级前全部一致。

证据：local/synology-native/lifecycle-check/private-stable-10037-acceptance.json、private-stable-10037-data-check.json、private-stable-readiness-10036.json、schema-upgrade-c5302612.json；页面与隔离验收材料见 local/synology-native/reports/stable-10037/。5 个本机历史 SPK 已删除，保留最终正式包；服务器升级自动配置副本按既有清理授权移除，当前配置、字体和业务数据库保留。源码与文档仅本地提交，不推送。

能力边界：上传/断点上传/小说/Book Dock 及追加、替换的跨媒体组合由本机相关回归与 PG18 七项真实 HTTP 测试覆盖，不能把本次临时 TXT 页面验收写成所有媒体、全部故障组合实机穷举通过。Android 实机、公开发行材料及未执行的整机重启验收等原有后置事项不因本次交付自动完成。

## 共享评论与最近阅读格式进度

`packages/types/src/book-comments.ts`定义共同接口。服务端`book-comment`模块、`book_comments`表和Drizzle生成的0130迁移承载公共评论；每次服务调用通过BookService核对访问，管理删除路由另有ManageUsers权限。列表以id游标和限定条数查询，根线程与回复分别建立索引。

网页`useBookComments`和`CommentsTab`负责评论草稿、幂等重试、回复、分页与删除确认。所有用户文本使用Vue文本插值。Android对应BA-C25。书架卡片在`BookRepository.enrichBookIds`按当前用户和当前页书籍批量读取各文件最后阅读时间，并选择最近一次的进度，回归覆盖辅助格式和较低新进度。

## 3.7原生升级补丁

- dd3dd310合并官方v3.7.0及既有定制，附加Drizzle升级迁移、旧播客空库保护和逐项需求映射。
- 7d867edd在Source.Dockerfile复制服务端动态语言目录，finalize-source-build.mjs实际调用serverText校验中英文，source-build.py拒绝缺少该收据的构建。
- 0f5e138d修正schema-upgrade-policy.py同schema更新误拒，新增没有目标允许列表项的回归，保留来源、载荷、策略和实际迁移防篡改校验。

3.7.0-10044已通过DSM部署，应用仍为同一已验收7d867edd载荷。账户两项认证时间差异与原完整摘要重建已核对，隔离测试环境已清理，逐项验收范围见UPGRADE_V3_7_0_ACCEPTANCE.md。

## 2026-11-12 3.8升级进行中

官方v3.8.0已在upgrade/upstream-v3.8.0合并。定制功能逐项清单、兼容调整和本轮证据维护在[3.8验收表](UPGRADE_V3_8_0_ACCEPTANCE.md)。服务端19616项、前端8969项和原生207项回归通过，133项既有迁移保持原文。当前生产仍为3.7.0-10044，原生构建与群晖隔离迁移/业务验证完成后再升级。

3.8兼容补充。book-source-job.service.ts和repository.ts接入API密钥书库范围，数据库分页前过滤，单任务操作验证当前访问权限。8项专项回归随完整服务端19624项通过。

## 2026-11-12 3.8自用正式升级完成

群晖已通过DSM升级为3.8.0-10046，普通套件账号原生运行，INFO无BETA。应用/打包源码fa057c70，服务端19624项、前端8969项、原生207项及插件14项通过。群晖隔离19项、正式生产14项与15张原表数据摘要通过，配置和原书库、阅读记录及字体保留。完整35项定制核对及本轮未重复执行的场景见[3.8验收表](UPGRADE_V3_8_0_ACCEPTANCE.md)。API密钥书库范围过滤和3.8新增146项中文文案已经合并。按照用户要求未创建数据库备份。
