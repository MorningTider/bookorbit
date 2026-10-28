# 前端国际化定制回归

2026-10-29修复用户反馈的统计配置项及热力图漏译，并扩大到图表标签/悬浮提示/星期、来源、书库列、标注样式和筛选、新手引导、成就、后端固定画像文案及错误兜底。UI使用翻译键，数据ID、图表字段、颜色、格式、排序及用户自定义名称保持原值。

## 上游合并要求

- 保留statistics-chart-meta.ts的labelKey及StatisticsPage的t调用。
- 元数据图共用metadata-field-label.ts，使用原字段定位数据，仅在展示层翻译；提示与坐标须同步。
- useTableColumns在组合层翻译固定列，不能改写用户自定义列和存储布局ID。
- 统计画像的后端字符串视为接口值，由客户端insight-labels.ts翻译；上游新增类型须同时补资源。
- en.json和zh.json同时维护语义化键；其他语言保持既有回退策略。
- scripts/audit-ui-localization.cjs检查840个Vue模板、中文缺键及脚本UI候选。脚本候选需要追踪渲染消费者，包含品牌、示例书名、已在下游翻译的常量，不能只凭字符串出现认定漏译或宣称全部无英文。

## 验证

完整前端741个测试文件、8336项测试通过，语言资源校验和改动范围ESLint及vue-tsc通过。新增热力图中英文切换测试检查坐标、tooltip和数据点不变；表格测试检查固定列即时切换且自定义名称保持。完整回归首次发现ICU分类返回顺序与jsdom Blob/Response差异，测试改为精确无序分类比较和二进制Response，未改变被验证的业务行为。

此记录是源码验证结果。新版SPK及真实浏览器验收完成前，不宣称线上漏译已修复。

扩展复查：追加115类固定通知/错误、31类带状态码错误、实体管理13类动态错误的国际化。错误码、HTTP状态、实体类型仍作为协议值保留；展示层按语言解释。修正中文复数资源须使用ICU other分支的格式问题，25套语言资源校验已通过；此前10003候选不部署，后续采用包含该修正的候选。真实浏览器使用编译产物和合成接口数据，已检查配置列表与热力图字段中文、页面异常0；该检查不是生产登录验收。中文统计标题同时纠正“元数据淡化”“获取标签”等不准确翻译。通知/错误构造器也纳入长期脚本候选扫描。

## 2026-10-29 已部署10004

最终应用源码77afa4e5，SPK3.5.0-10004，SHA256 2c6054f9144f1fc5fc043f8ee3e5128e9d73c510db35ad21a1ce54fd12b866ad。旧10003候选未安装。最终完整前端回归741文件8336项通过，语言资源25套校验通过，改动范围ESLint与vue-tsc通过。

DSM套件中心从10002直接升级10004成功。最终备份/audit目录为/volume1/database/pg/backups/bookorbit-spk-upgrade-10004-20261028T190720Z，PG完整备份为/volume1/database/pg/backups/logical-20261028T190724Z-5e1829ed。配置SHA256 e7a939f13b786ea0819172f7ea77f0687f6574549de307604e05738768303a32在升级前后相同，迁移指纹未变。实际安装前端index SHA256 d75cf8e7bb56b3deb541401639688eb1236f8e6e621312f54aeabbbe3658b269与源码构建产物一致。

生产12项只读API检查全部通过，收据production-api-10004.json留在私有备份目录，生产令牌仅在NAS内存使用。verify-localization-browser.cjs对公网实际前端运行浏览器验证，通过配置名称、热力图SVG13个字段和脚本异常0检查；接口数据在新浏览器上下文中完全合成，没有使用生产账号或写入生产数据，不能把该浏览器验证描述为使用生产账号遍历所有页面。报告local/synology-native/reports/browser-localization-10004-public.json，截图/private/tmp/bookorbit-statistics-10004-public.png。

后续可用BOOKORBIT_PLAYWRIGHT_MODULE指定Playwright模块，运行node scripts/synology/native/verify-localization-browser.cjs BASE_URL；只验证前端展示，真实API需单独跑NAS生产探针。访问已有页面时刷新加载新资源。当前仍是Beta包，公开再分发审计是另一个尚未完成事项。
