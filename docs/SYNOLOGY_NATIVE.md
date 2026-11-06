# BookOrbit 群晖原生迁移验证

2026-10-26：生产仍为Docker r21，原生SPK尚未构建或安装。本文件记录迁移前提和实际探针，不把容器内成功等同于宿主机原生成功。

## 已确认的目标环境

- 架构x86_64，内核4.4.302+。
- 已安装Node套件18.20.8、20.20.2、22.22.3；BookOrbit仓库要求Node至少24。
- 宿主PATH有python3、ffmpeg、pdftotext、psql；未找到ffprobe、pdfinfo、ddjvu、pg_config。不能据PATH探测推定系统所有目录均不存在该工具，但不能依赖它们作为已就绪运行条件。
- 当前锁定Docker基础为Node26.11.1 Alpine3.23，现有Node依赖musl加载器、libatomic、libstdc++及libgcc。原生模块sharp及完整媒体链路仍需另行验证。

## 迁移顺序与边界

1. 验证包内自带运行时在DSM普通用户下可执行，再验证sharp、数据库连接和媒体工具。
2. 数据库作为独立SPK处理；PostgreSQL18和pgvector版本保持兼容，不复用其他主版本的数据目录。
3. 应用以独立端口、独立配置和独立数据进行原生隔离验收，保留现有Docker服务。
4. 完成权限、生命周期、升级、备份恢复及真实功能检查后，才准备生产迁移。当前没有批准停止或迁移生产数据库。

## 可重复运行的Node探针

`scripts/synology/native/probe-node-runtime.py`从指定、精确匹配的隔离镜像导出Node和ldd依赖，在新建临时目录中使用独立加载器，以非root用户执行，不修改系统运行库或PATH。无论成功失败均删除临时运行时，保留0600 JSON报告。前两轮在/tmp被noexec拒绝；改用卷内目录后musl Node26启动通过，但process.execPath指向加载器，不适合直接承担现有书源guard和插件检查的子进程启动。该方案未采用为包运行入口。

## 上游参考

- [Synology套件权限配置](https://help.synology.com/developer-guide/privilege/privilege_config.html)：采用包用户运行及独立生命周期配置。
- [Node26.11.1平台与构建要求](https://github.com/nodejs/node/blob/v26.11.1/BUILDING.md)：DSM当前内核不在此版本列出的Linux测试平台范围内，实际启动或小探针成功也不能替代完整应用兼容性验收。

## 丛书字段补查

从隔离API实际返回的sourceUrl读取百年孤独61061443、挪威的森林261、三体5739303的百度移动页结构化card原始字段，均无丛书或系列字段。因此这三个样本没有证明解析器漏读，也不能据此填写作品所属丛书。此项为缺少真实有字段样本的验收待办。

## 官方Linux运行时实测通过

宿主glibc实际为2.36。官方Node26.11.1 Linux x64发行包SHA256为`3883bfc73f9a680ca4eab04b196068aaaab1373ffa77d8fc1a4408222495b651`。首次执行发现宿主缺libatomic.so.1；从Debian官方包的镜像取得9KB归档，按Debian官方SHA256核验，仅以私有库路径提供，不安装进系统。

`probe-official-node.py`最终在DSM普通用户UID1026下验证：容器外直接运行、execPath正确、execFile子进程、fork IPC全部通过，测试运行时已清理。成功报告已复制到本机忽略目录`local/synology-native/reports/node-official-20261026.json`；下载材料保存在忽略目录`local/synology-native/cache/`，来源及完整性锁保存在`runtime-source-lock.json`。

这是运行时基础验证，不是完整BookOrbit或SPK验收。接下来盘点Sharp原生addon，验证glibc版本图片处理依赖，再验证媒体工具与独立数据库。现有生产仍Docker r21。

## Sharp宿主机实测通过

隔离镜像盘点显示唯一.node addon为Sharp0.35.5的musl构建，应用代码目录584MiB且不含实际.env或用户数据挂载。本轮没有整体迁出应用或复制数据库配置；只打包Sharp的锁定纯JS依赖和官方npm的glibc平台包进行测试。

`build-sharp-probe.py`复用Sharp0.35.5、semver7.8.5、detect-libc2.1.2、@img/colour1.1.0，按npm SHA512验证@img/sharp-linux-x64 0.35.5与@img/sharp-libvips-linux-x64 1.3.4。平台包来源与完整性已写入来源锁。

在DSM普通账号、Docker外、官方Node26.11.1和私有libatomic下，Sharp0.35.5/libvips8.18.7完成合成PNG编码、JPEG缩放32x24到16x12、WebP旋转到24x32，均验证解码后的尺寸。Node execPath、execFile及fork IPC同步复验通过。测试运行时目录已清理，报告保存在忽略目录`local/synology-native/reports/node-sharp-native-20261026.json`。

## 接下来的验收

- 按锁定镜像导出并单独封装PDF、音频、DjVu等外部工具，验证普通用户实际文件处理。
- 为应用生命周期准备隔离数据、数据库和端口，验证完整BookOrbit宿主进程，不使用生产数据库进行试启动。
- PostgreSQL18+pgvector独立包需单独验证initdb、角色权限、备份恢复及扩展加载。
- 完整链路与包生命周期通过后才构建可安装候选、提交DSM安装验收；当前未安装任何新SPK。

## 音频和PDF宿主机实测通过

`probe-media-runtime.py`按隔离镜像ID校验来源，从镜像只读导出媒体工具及ldd动态依赖，在普通用户家目录的新临时目录内封装独立musl加载器。测试子进程移除继承的LD_LIBRARY_PATH，以UID1026在Docker外运行，不修改系统库。

实际通过：1秒合成WAV编码为AAC/M4A，ffprobe读取AAC编码及有效时长；合成单页PDF的信息读取、PNG渲染和文本提取命令运行。PDF样本为色块，无字体文字，因此不覆盖中文字体和文本提取准确性。临时工具及合成样本已经自动清理，0600报告位于群晖`/tmp/bookorbit-native-media-20261026.json`。本机脚本通过Python语法解析。

来源为生产同版r21隔离镜像`sha256:45a14dca6227860dd71028da67856f11fc34f8f335ad1181193d71c85bdd30d7`。报告passed只表示这两类探针通过，不代表完整媒体或应用验收。当前镜像PATH中找不到ddjvu、djvused、c44，DjVu依赖仍待补齐并验证；正式分发前仍需锁定媒体组件来源、版本和许可证。完整原生应用与独立PostgreSQL尚未运行，生产未迁移。

## 完整原生服务基础验收通过

2026-10-26，使用probe-application.py在DSM普通用户UID1026下运行r21应用，监听临时127.0.0.1端口。代码和冻结依赖从锁定隔离镜像导出，Node和libatomic按既有SHA256核验，Sharp补入已验证的glibc平台包。没有使用生产数据库、配置或书库。

探针在bookorbit-db-verify新建随机名称的一次性数据库。实际通过7项：原生执行全部数据库迁移、服务与数据库健康、宿主普通用户进程、前端首页、未登录401、全新初始化、停止后重新启动并成功登录。测试账号和随机凭据仅在内存中生成，没有导出凭据。该测试仍连接隔离Docker PostgreSQL，不代表独立原生数据库已经通过。

首轮在应用导出阶段达到180秒限制，未创建数据库或启动服务，临时目录已清理。第二轮允许600秒导出并增加阶段输出后通过。群晖期间负载约16，测试已避免继续并发启动；不能把导出慢误判为应用兼容失败。

测试服务已停止，一次性数据库和临时应用目录均已删除。成功报告为群晖/tmp/bookorbit-native-app-20261026-r2.json，本机复制记录位于忽略目录local/synology-native/reports/。

## DjVu补充实测通过

当前r21镜像既没有DjVu命令，也没有安装djvulibre包；不能把仓库Dockerfile的安装声明当作现网安装事实。从[Alpine官方3.23仓库](https://dl-cdn.alpinelinux.org/alpine/v3.23/community/x86_64/)补充djvulibre与djvulibre-libs 3.5.29-r0，SHA256已锁定，先在锁定镜像信任的Alpine密钥下执行apk verify，两个包签名通过。签名验证容器只读、无网络，仅挂载两个APK文件，结束后无容器残留。

工具与动态库仅导出至一次性私有目录，宿主普通用户执行：c44将16x12合成PPM生成DjVu、djvused核对1页、ddjvu解码回PPM。音频与PDF探针同步复验通过。首次签名容器启动超过30秒限制，已核对无残留；设置120秒限制及唯一容器名称、显式清理后复验通过。

报告为群晖/tmp/bookorbit-native-media-djvu-20261026-r2.json。报告中的tools为原镜像盘点，因此DjVu仍显示null；实际使用的是签名核验后补充的工具，checks中的djvuEncodeInspectDecode已通过。临时运行时和上传的5个测试归档已清理，生产8184健康状态仍为ok。

## 当前迁移门槛

- 已完成：Node、Sharp、音频/PDF/DjVu合成样本及完整原生服务基础启动、初始化、重启登录。
- 未完成：原生服务的实际书籍导入和阅读、中文PDF字体与提取准确性、其他外部集成和工具、生产数据恢复演练。
- 独立PostgreSQL18原生核心18.6-10019和独立pgvector0.8.7-10006 SPK已在DSM运行，BookOrbit生产快照恢复的隔离实例通过业务读取。生产BookOrbit尚未切换，群晖内部数据库未修改。独立数据库项目见../postgresql-spk。
- SPK权限、生命周期、升级、备份恢复和DSM安装验收仍待完成，没有生成或安装BookOrbit SPK。

## 2026-10-27 独立数据库应用验收

生产r21数据库一致快照恢复到原生PG隔离库，167张表逐表行数一致；应用账号为非超级用户，角色连接额度24匹配现有池20。使用相同生产镜像ID、独立数据副本和新JWT密钥，书籍目录只读且Docker网络Internal=true。该网络忽略主机端口发布，实际从NAS访问隔离容器IP:3000；构建辅助脚本已移除无效18185发布声明，凭据仅保存在NAS私有文件和进程内存。

重启后发现PG先于Docker网桥启动导致监听缺失，已在独立PG项目10019中修复。通过DSM升级后集群/角色/扩展/167表保留；书籍查询11本、详情、8路并发详情、健康检查均通过。数据文件Range读取206此前已通过。生产BookOrbit仍使用旧容器数据库，未切换，PG修复后的整机重启复测及最终生产切换仍待完成。

## 2026-10-27 PG整机重启验证

已按用户授权重启NAS。原生PG10019先于Docker网桥启动的情况真实复现，受管监听随后自动恢复，无人工PG重启。隔离BookOrbit实际健康、11本查询、详情、8路并发、4096字节Range读取206及匿名401通过；PG集群/角色/扩展/167表保留，向量行与HNSW索引保持。生产应用最终健康200，仍连接原Docker数据库。PG整机重启门槛已通过；下一步为另行安排的一致备份与生产数据库切换，尚未执行。

## 2026-10-27 native PG formal installation completed

DSM installed PostgreSQL18.6-10020 and independent pgvector0.8.7-10007, both beta=no.14 final native identity/data/role/configuration/extension checks passed; BookOrbit remained healthy locally and publicly on r21 with the native DB. The original Docker DB/application and every data volume remain stopped and retained. Full evidence and formal artifact hashes are in the separate postgresql-spk project. No additional NAS reboot was performed for these metadata-only formal upgrades.

## 2026-10-27 原生应用构建输入

数据库迁移已完成，生产r21使用原生PostgreSQL18.6-10020，应用容器继续提供服务。旧段落中的“独立数据库未完成”是历史状态。

新增stage-application-payload.py：只读导出锁定r21镜像的/app程序，核验官方Node归档和可执行文件、libatomic及Sharp材料，使用新建私有目录，拒绝夹带环境文件，导出失败自动清理。容器仅用于提取构建材料，工具不创建或启动容器，不修改生产数据库和配置。输出明确标记application-only-not-distributable，不能当作已经完成SPK。

新增payload-contract.py：供后续SPK构建前调用，校验完整文件哈希清单、x86_64 ELF、运行时来源锁、内部相对链接及媒体工具齐备；拒绝数据目录、环境文件、逃逸或绝对链接。每个文件必须归属于记录了版本、来源和许可证的组件；需要对应源代码的组件必须提供源代码材料。尚未收齐材料时拒绝构建，不把一次探针成功当作分发材料齐备。

本机10项输入契约测试和10项材料准备测试通过。原生SPK生命周期、全部媒体及Python依赖清单、真实导入阅读、生产恢复演练及DSM安装尚未完成。不会将尚未验证的BookOrbit包标记为正式版。

### 本轮群晖实际结果

锁定r21程序导出成功，文件清单38572项。导出中发现并仅排除了.env.example、依赖.vscode/settings.json及node_modules/.pnpm/node_modules/server指向不存在构建目录的确切链接。原始运行环境配置仍被拒绝。修复DSM Python3.8缺少Path.readlink接口，以及root umask077导致包内目录700的问题，加入回归覆盖。

本机和NAS各20项测试通过；前后端ESLint及本轮JSON/Markdown Prettier检查通过。真实普通用户UID1026运行官方Node26.11.1，process.execPath指向原生bin/node；Sharp0.35.5在内存生成16x12 PNG并读取尺寸成功。没有启动应用或连接生产数据库。

材料目前位于/volume1/homes/MorningTider/.bookorbit-native-stage-20261027，清单与运行报告在/volume1/@tmp/bookorbit-native-stage-20261027.inventory.json和同前缀.runtime-check.json，均为NAS本地构建材料，不是已验收SPK。最初普通用户在@tmp执行被拒绝；移动后进一步定位并修复内部权限，最终通过。下一步整理完整媒体与Python运行时、来源和许可证，随后实现普通包用户的生命周期并做原生隔离业务验收。

## 源码构建作为正式入口

按用户要求，正式BookOrbit SPK程序从当前Git提交和pnpm锁文件构建，不再从线上容器提取。stage-application-payload.py保留为r21兼容性对照工具，不作为正式程序来源。

source-build.py要求受跟踪文件已提交，使用git archive导出指定HEAD，不复制本机node_modules、未跟踪文件和本地配置。编译仅在Mac的固定Linux x86_64环境执行，基础镜像摘要、pnpm版本与SHA512锁定；依赖安装使用frozen-lockfile，前后端及共享包均从源码编译，生产依赖在Linux下裁剪。最终SPK不包含或依赖Docker运行服务。

Source.Dockerfile导出程序、迁移文件、静态页面、Kepubify、KOReader插件及应用许可证，并携带同次构建对应的源码归档。finalize-source-build.mjs在Linux内真实生成和读取Sharp图片，并拒绝不便迁移的链接及运行配置。source-build.json记录源码提交、源码归档与锁文件哈希、构建镜像、Node和Sharp版本。此输出仍是应用构建产物，不代表完整SPK或全部组件许可证已齐备。

```sh
python3 scripts/synology/native/source-build.py \
  --output "$PWD/local/synology-native/source-builds/NEW_BUILD" \
  --cache "$PWD/local/synology-native/cache"
```

构建失败不保留半成品输出，已有输出拒绝覆盖。8项测试覆盖提交追溯、脏源码、包管理器与镜像锁、下载缓存篡改、未跟踪凭据不入归档、失败清理及已有产物保护。实际源码编译结果在后续记录补充，不将单元测试当作已完成Linux编译。

### 可选大包缓存预填充

实际Linux构建中少数大字体归档和ECharts在容器网络重复断线；Mac访问相同官方npm归档已通过与pnpm锁文件一致的SHA512校验。可在Mac使用同版本pnpm11.22.0的store add填充专用缓存，仅包含sourceBuild.preloadPackages列出的两个包，然后使用store status核验。不复制本机node_modules。

```sh
pnpm --config.registry=https://registry.npmjs.org store add \
  echarts@6.1.0 @embedpdf/fonts-sc@1.0.0 \
  --store-dir "$PWD/local/synology-native/preload-store"
pnpm store status --store-dir "$PWD/local/synology-native/preload-store"
python3 scripts/synology/native/source-build.py \
  --output "$PWD/local/synology-native/source-builds/NEW_BUILD" \
  --cache "$PWD/local/synology-native/cache" \
  --preload-store "$PWD/local/synology-native/preload-store"
```

构建前只读核对标准v11索引的完整性键和包名，必须与现有锁文件精确一致，拒绝额外包及链接。只归档索引和内容文件，不修改SQLite记录；新的BuildKit缓存初始化后继续由pnpm按frozen-lockfile正常校验和安装。缓存标识绑定这组包的锁值，已有缓存不覆盖。pnpm版本或缓存格式升级须重新验证，不能直接沿用旧格式假设。源码构建测试现为12项。

## 2026-10-28 源码构建实际通过

源码提交9c41f5806489ac513b5c4f708ddf33ca101b33ca的Linux x86_64构建完成，未从生产容器复制程序。前端、后端、共享类型及插件API、冻结生产依赖安装、Sharp生成与读取图片、全部依赖链接的可迁移检查均通过。生产依赖307项全部复用已校验缓存，无重新下载；两个共享模块必须从产物目录内部解析和加载。

pnpm11的legacy deploy内部关闭冻结锁文件，因此正式入口已移除legacy，改用基于现有共享锁的冻结部署路径。依赖输入使用稳定清单归档，源码或文档变更不会迫使依赖层重新安装。Dockerfile和验证用锁文件均从同一个Git提交读取，避免构建时混入随后修改的工作文件。源码构建辅助测试14项通过。

产物位于忽略目录local/synology-native/source-builds/9c41f580，包含source-build.json及对应源码归档。记录值如下：

- pnpm锁文件SHA256：505b9051086f213f801700b2bb0406493ef3a5247c9ee35f8df2a42a62dac303。
- 对应源码归档SHA256：712c186a6b607280f1a7b5b5c9fbf2291418897ab40fd2e8585439c1b7a670ec。
- Node26.11.1、Sharp0.35.5，构建镜像摘要86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567。

原生装配入口新增互斥的--source-build选项，检查源码提交、对应源码归档、构建环境和原生验证记录，再装配官方独立Node和libatomic。该路径不调用Docker导出，也不覆盖源码构建产生的Sharp依赖。与原输入契约合计38项测试：14项源码构建、14项装配及10项输入契约。实际装配清单36576项；输出仍标记application-only-not-distributable，媒体、Python、完整许可证材料、生命周期及应用业务验收仍需完成。

```sh
python3 scripts/synology/native/stage-application-payload.py \
  --source-build "$PWD/local/synology-native/source-builds/9c41f580" \
  --materials "$PWD/local/synology-native/cache" \
  --output "$PWD/local/synology-native/stages/NEW_STAGE"
```

### 源码装配产物的DSM普通用户复验

通过100.86.77.124连接DSM，以普通用户UID1026解包并运行源码装配产物；本轮没有sudo或root进程。Node26.11.1、Sharp0.35.5、两个共享模块内部解析与加载、16x12 PNG生成和尺寸读取全部通过。源码提交仍为9c41f5806489ac513b5c4f708ddf33ca101b33ca。

群晖验证目录为/volume1/homes/MorningTider/.bookorbit-native-source-9c41f580，报告verification-runtime.json。为本轮普通用户检查传输的运行归档未包含完整对应源码归档，不是可分发SPK；完整对应源码和全文件清单保留在Mac装配目录，正式打包仍需通过组件来源和许可证门槛。运行归档SHA256为17644887e117af72f6767dc12f0ec23ee6cdc4f4ba2b5232f4f0b3b45ae71488，NAS解包前已核对。

本轮只运行模块及图片检查，没有启动新的BookOrbit主服务或访问生产数据库。原生产8184健康检查HTTP200、status=ok。完整媒体/Python运行时、SPK生命周期、实际导入与阅读、数据库恢复演练及DSM安装尚未完成，不扩大为完整原生业务验收。

## 2026-10-28 媒体与 Python 私有运行库候选

新增 Support.Dockerfile、prepare-support.sh、collect-support.py 和 attach-support.py，将 FFmpeg、Poppler、DjVu、中文字体、Python 3.11 及 cloudscraper 依赖收集到独立 support 目录。Docker 仅为 Mac 构建环境，NAS 直接执行 ELF。构建清单记录 Debian 包版本、库哈希、版权与 APT 元数据；对应源码和全部依赖锁定仍需补齐，候选明确禁止作为正式包发布。

DSM 虽报告 glibc 2.36，实际缺少 arc4random 系列符号。仅调整 Expat 仍不能满足其他依赖，因此媒体/Python 使用配套私有 libc 和显式私有加载器。启动器清除继承的 LD_PRELOAD、LD_LIBRARY_PATH，不向主 Node 或系统命令注入私有 libc；Python 子进程重新进入自己的启动器。系统库不做替换。

Poppler 的原始固定数据路径使中文 PDF 无法正确提取文字。构建时从对应 Debian 源码增加 BOOKORBIT_POPPLER_DATADIR 支持，保留原有显式参数和默认路径语义，保存补丁、源码与哈希。验收使用无 ToUnicode 的中文测试 PDF，避免仅用内嵌字符表掩盖缺失 CMap。

本机 Linux 只读、无外网、UID501 六组检查通过：私有运行库符号、AAC 标签与音频、私有中文字体、中文 PDF 提取及渲染、DjVu 文本及解码、Python HTTPS 与子进程。HTTPS 使用临时本地证书及 localhost 解析，不等同于外部书源验收。共53项辅助单元测试通过，临时样本自动删除。NAS 候选归档 SHA256：6c61df76ad7ccd3b7bd864caddf170d593bd2f716b9950740520601d41d3041e，上传后已核对一致。

### DSM 私有运行库实际验收

普通用户 UID1026 在 /volume1/homes/MorningTider/.bookorbit-native-private-libc-9c41f580 执行相同六组检查全部通过。verification-support.json 记录 missingRuntimeSymbols 为空、实际加载器位于候选 support/private-lib、Python 子进程入口为候选 bin/python3；Python3.11.2、OpenSSL3.0.22、cryptography50.0.2。临时证书和样本已删除。生产8184健康检查 status=ok、database=up。

本轮验证仅覆盖合成媒体与运行库，不代表完整 BookOrbit 业务或 SPK 验收。仍需锁定 APT/Python 全部输入、补齐组件对应源码、实现安装升级与权限脚本，完成独立数据库上的导入、阅读、任务恢复及 DSM 套件验收后再切换生产。

## 2026-10-28 运行依赖精确清单

lock-support-inputs.py 从已通过 DSM 普通用户验收的私有运行库收据生成 support-runtime-lock.json：218个 Debian 包、20个 Python 分发，逐项记录精确版本和 SHA256。Debian 同时记录二进制版本与对应源包版本，不能用二进制修订号代替源包版本；Python 记录 files.pythonhosted.org 的精确 HTTPS 地址，拒绝凭据、查询参数和非预期主机。生成器拒绝重复包、歧义 APT 记录、版本不匹配、缺失哈希及路径越界，8项测试通过。

其中 pyjsparser2.7.1 使用源码分发，清单显式标记 sdist；其构建工具链仍需冻结。该清单目前是运行输入记录，不是完整构建锁：尚未接入强制锁定重建，APT 仓库快照及构建工具链还未固定，对应源码也未完整下载。后续必须验证精确制品可获取、离线哈希校验及锁定重建，不允许因旧版本不可用而静默换成最新版。

复核命令（输出必须是新文件）：

```sh
python3 scripts/synology/native/lock-support-inputs.py \
  --artifact local/synology-native/support-private-libc \
  --output /private/tmp/bookorbit-support-lock-new.json
```

## 2026-10-28 锁定重建与源码应用业务验收

新增 build-support.py，使用404项已观测工具链包的精确版本安装约束，并核对实际 dpkg 版本；Python20项使用精确制品地址、require-hashes、no-deps、no-build-isolation，执行 pip check。不再由 Poppler 脚本临时安装未固定开发包。构建结束重新从收据生成运行清单，要求218项 Debian 和20项 Python 的版本、源包身份与制品 SHA256 与锁文件完全一致，否则失败。

实际构建 support-locked-first 和带最终门槛的 support-locked-checked 均成功；后者 locked-rebuild.json 记录 runtimeIdentitiesMatched=true、toolchainPackages=404。前者在只读、无外网、普通用户环境的六组媒体/Python 验收全部通过。重建与此前 DSM 已验候选相比，可执行程序、私有库和 Python 代码一致；差异为 Python 安装来源元数据及保存的构建脚本。本结论不声称逐字节、全目录可重复构建；APT 仓库版本淘汰仍可能导致未来构建明确失败，不允许自动改用新版。

collect-support-sources.py 通过认证 APT 索引按对应源版本收集169组 Debian 源码，逐项核对 dsc 身份、SHA256与文件大小，全部通过。材料位于忽略目录 local/synology-native/source-materials/debian-runtime-0b24a941，source-receipt.json SHA256 为950e519dafdd2576361aca11a4d2ba19160773bcbb4396212e4a14db34ae46b5。源码清单绑定运行锁哈希，不能把这份 Debian 材料扩大为 Node、Sharp、所有 Python 组件的完整源码审计。

新增 probe-source-application.py：只从指定源码候选读取程序并检查提交与 Sharp 收据；使用已有隔离数据库服务器上的一次性数据库，不从容器导出程序。NAS UID1026 的第三轮报告 /tmp/bookorbit-source-application-20261028-v3.json 共10项检查全部通过：迁移、健康、普通用户、前端、未登录拒绝、首次设置、登录重启、TXT导入/正文/Range、TXT转EPUB及spine、书籍转换后重启持久化。三次启动9.06/7.05/7.04秒，临时库与临时目录已删除，生产8184仍status=ok。首轮90秒等待曾失败，第二轮放宽至180秒后通过；尚未将该单次超时归因于确定缺陷，须继续覆盖正式套件启动及NAS重启。

本轮新增构建入口6项、源码计划5项测试；锁清单测试扩为10项，覆盖pip报告旧hash字段及冲突拒绝。媒体工具的核验与应用业务测试是不同证据，不能互相替代。

生产切换授权已获得：原生SPK验收完成后，先最终备份再停旧应用容器并启动SPK，保留旧容器和数据。当前尚未执行切换。生产挂载为 /data 对应 /volume1/docker/bookorbit/data/app、/books 对应 /volume1/library（只读）、/books/ebook 对应 /volume1/library/ebook（读写）。原生迁移须处理持久数据库路径和群晖ACL，不能只复制容器环境变量或给整座书库递归放开写权限。DSM套件生命周期、原生PG上的完整应用验收、路径与权限迁移及最终切换仍待完成。

生产只读路径审计发现：book_files.absolute_path 有6468行、books.folder_path 有11行、library_dir_scan_state.dir_path 有14行、library_folders.path 有2行使用 /books 前缀。该查询只返回计数，没有修改记录；正式迁移必须对这些记录和额外JSON配置做完整预检及隔离回放，不能只改11本书的主记录。

## 2026-10-28 生产路径只读审计与原生PG副本事务回放

新增 audit-native-paths.cjs、path-migration-plan.py 与 replay-path-plan.cjs。审计在 REPEATABLE READ、READ ONLY 事务内扫描 public 下573个文本/JSON字段，逐语句设置5秒超时并限制schema规模；JSON中的绝对旧路径会作为未审查字段阻塞，不自动递归替换。scalar记录按完整路径分组，检查目标是否已存在。计划绑定完整审计与精确映射，使用最长路径前缀，拒绝非规范路径、目录边界误匹配、合并碰撞、未知字段、缺失碰撞证据与映射漂移。15项Python测试通过；两份CJS使用ESLint recommended及Node globals检查，无警告，Prettier通过。

实际生产审计完成，6495组匹配均来自四个已审查字段：book_files.absolute_path6468、books.folder_path11、library_dir_scan_state.dir_path14、library_folders.path2，无JSON匹配、未知字段或目标碰撞。审计和计划存于NAS私有目录 /volume1/homes/MorningTider/.bookorbit-native-migration-audit-20261028，未将真实路径快照或凭据传回Mac。映射为 /books 到 /volume1/library、/data 到现有 /volume1/docker/bookorbit/data/app；本轮不迁移存储目录。

通过原生PG套件Admin完成一致备份与独立恢复，测试数据库 bookorbit_spk_pathcheck_20261028a 使用非超级用户、8连接额度。初始直接连接被原生PG按应用隔离规则拒绝，随后仅为该副本角色登记127.0.0.1/32的SCRAM访问；没有新增外部监听，也没有重启数据库。隔离连接凭据仅保留在NAS0600文件，副本及其loopback规则暂为后续原生服务验收保留，完成后需清理测试角色与规则，保留备份。

回放器只接受 bookorbit_spk_pathcheck_ 前缀的数据库身份，先检查 current_database()，再开始事务。每个字段加表锁，使用参数化UNNEST批量更新，逐组核对原计数与目标碰撞，改写后复核，任一步失败则ROLLBACK。实际注入第二组books计数错误，先前book_files更新也完全回滚，全部6495组原路径保留；正确计划全部更新成功，573字段复审旧路径为0；再次执行旧计划被拒绝。回放器另在生产连接上实测于identity阶段拒绝、未开始事务；此检查仅执行数据库身份查询。replay-receipt.json保存副本回放证据。

以原容器UID1026/GID101核验映射后的6468个文件：missing=0、notRegular=0、unreadable=0、outsideLibrary=0，报告host-path-access.json。此结果只证明原容器身份可访问，不能当作新SPK账号的ACL验收。生产8184健康仍status=ok，生产路径未改写，容器未停止。下一步仍需套件生命周期、新账号最小ACL和原生应用在该副本上的整体验证，不能把路径回放通过扩大为SPK可切换。

## 2026-10-28 原生进程生命周期及安装候选入口

native-service.py 新增普通账号控制器：启动、停止、状态、子进程最多4次启动、有界退避、停止时回收子进程组。服务配置必须由当前账号持有且权限0600，状态目录0700；PID由进程启动tick、UID、脚本及状态目录共同验证，不向复用或无关PID发送信号。数据库仅允许127.0.0.1上的 bookorbit_spk_pathcheck_ 隔离库；生产模式明确拒绝。关键路径、PATH、Node选项、私有lib、Python和媒体工具由控制器指定，配置不能注入NODE_OPTIONS；BookDock与临时目录固定在私有状态目录内。

10项策略单测通过。verify-native-lifecycle.py 使用合成Node HTTP程序，在Linux只读根目录、无外网、UID501完成8项进程检查：启停及状态、重复启动、子进程崩溃恢复、停止后无子进程、重复停止、同端口再启动、无关活动PID拒绝、占用端口拒绝。初次只读容器运行发现临时目录不可写，改为套件私有TMPDIR，并在仿真环境提供专用tmpfs；同端口探测使用SO_REUSEADDR以允许TIME_WAIT后再次启动。修改后全部通过。

NAS普通用户UID1026用已验证候选Node重复8项检查全部通过，未连接数据库；合成目录已清理，报告 /volume1/homes/MorningTider/.bookorbit-native-lifecycle-20261028/acceptance.json。NAS控制器SHA256与本机一致，为f1e662efbc0e62921decea48ef5fd94a4b0d04082730888cb41ef71328bab288。本机新收据绑定相同控制器哈希。不能把这个普通用户进程检查写成DSM专用账号或完整套件验收。

spk/脚本使用专用bookorbit-native账号，不执行Docker。初次安装只初始化私有目录和无真实凭据的配置样例；管理员需将已准备的隔离连接配置交给该账号。升级先备份配置和旧迁移指纹，再停服务；postupgrade拒绝未经验证的数据库迁移变化，保留持久目录。上述升级脚本尚需通过DSM实际验收，不能声明一键升级完成。Supervisor本身被SIGKILL时的孤儿恢复尚未验收，正式发布前仍需覆盖。

build-acceptance-spk.py 是私有安装验收入口，严格验证现有源码/支持组件文件清单、核心文件、专用账号、匹配的控制器进程测试哈希，并要求代码已提交。只生成Beta隔离安装候选，productionEnabled=false。正式可分发构建仍须通过原有payload-contract完整组件审计；本入口不宣布该门槛已通过。候选装配测试5项通过。专用账号ACL、原生PG上的完整服务、DSM安装/升级与生产切换仍未完成。

## 2026-10-28 DSM初次安装、专用账号及原生应用实际运行

已从已提交的3667baa0构建并经DSM套件中心安装bookorbit-native3.5.0-10000隔离Beta，SPK SHA256为074830e72c0af88ccb3be2bf2b2be8d7ca3166c3a18d2c2525bfef423b315851。归档42783项，DSM包校验MD5一致，Node、主程序、前端和控制器哈希与输入一致，专用账号配置无root覆盖。安装时关闭自动启动，后续配置就绪才启动；程序直接运行于/volume1/@appstore/bookorbit-native。

DSM创建bookorbit-native UID/GID217211，附加synopkgs组。安装后的状态目录/volume1/@appdata/bookorbit-native归该账号所有、权限0700。给/volume1/library新增该账号的只读继承ACE，修改前ACL保留在NAS私有审计目录acl-library-before.txt；没有递归放开写权限，也未修改其他账号ACE。专用账号实测6468个文件全部存在、可读、不可写、无路径越界。隔离连接和随机JWT密钥保存在该账号0600的service.json；生产应用数据228K复制至独立data目录，原数据不变。

首次启动因隔离配置漏SETUP_BOOTSTRAP_TOKEN而失败，已补独立随机值，控制器和样例增加提前检查，避免重复等待启动超时。修正后通过DSM服务控制启动成功。原生PG隔离角色连接额度由路径回放时的8调整为24，匹配应用最大20连接池；原生PG全局40连接不变，调整前观测总连接13。角色仅允许127.0.0.1/32的认证访问，没有开放外部地址。

probe-installed-native.py 实测9项全部通过：数据库健康、副本11本书查询、详情、4个并发详情、原生主机路径的Range内容与磁盘字节一致、前端、匿名拒绝、专用UID217211的原生Node进程、生产8184健康。测试JWT仅在NAS内存使用，没有传回Mac；结果保存私有审计目录installed-api.json。DSM内核未提供/proc/PID/task/PID/children，验收器改用/proc/stat的PPID识别，避免把内核接口缺失误报为服务故障。

专用账号的媒体首轮在40秒测试预算下有音频和Python组合超时，ABI、字体、PDF、DjVu通过；后续单独诊断工具可正常启动。改用显式120秒的有界预算、私有临时Python字节码缓存并记录耗时后六组全部通过：4.11/20.69/2.21/8.90/0.61/8.58秒，报告media-acceptance-cached.json。网络请求自身5秒超时不变；这不代表冷启动性能已优化完成。控制器新增按包元数据哈希隔离的持久私有Python缓存，避免只读安装目录不能写pyc及跨版本缓存误用。

异常恢复补测发现启动就绪与子进程记录写入之间有时序窗口。控制器现在要求可信子进程身份和HTTP健康同时就绪，并在exec前设置父进程死亡信号、重置信号处理器。最新控制器在NAS普通账号完成9项，包括管理进程SIGKILL后的回收及再次启动，全部通过；新收据cache-helper-controller.json绑定f16db693916d5727666e61ab2fbe1101f2f8f91e94f93670b0ee1f3aa52cb9ef。旧失败合成测试留下的一个已删除目录中的测试Node已按专用测试目录、UID1026、PID组与exe/cwd联合限定清理，生产UID217211未选中。生产中安装的10000控制器仍为前一版，修正将通过下次SPK升级交付。

新增verify-native-upgrade.py合成验证5项通过：私有配置备份、同schema接受、未知schema变化拒绝、数据/配置保留、缺少证据拒绝。仍需实际DSM上传升级确认。下一候选INFO增加postgresql18>=18.6-10020依赖；[Synology SDK说明](https://help.synology.com/developer-guide/synology_package/INFO_optional_fields.html)该字段同时影响包启停顺序。未重启NAS，不能声称已完成整机重启验收。

## 2026-10-28 原生下载辅助程序

官方GitHub网页资产与资产API下载均发生超时，未接受不完整文件。随后从历史部署材料bookorbit-release-20261023.tar.gz的独立tomato-downloader条目取得发行件，10469040字节、SHA256 d9db872448e3cda78a18eaa3c7ee162ce631251ed51eb789f8e6676abe118722，与现有代码和官方v2.4.15固定值完全一致；作为可追溯缓存，不替换BookOrbit仓库源码构建。通过既有安装器再次校验并连同MIT/NOTICE纳入全新support-with-auxiliary阶段，39206项，旧阶段保持不变。运行锁记录版本、URL、提交与版权文本哈希；装配器拒绝改动、错误架构及链接，4项测试通过。

verify-tomato-runtime.py以专用UID217211验证5项全部通过：认证回环状态、仅回环监听、匿名拒绝、普通身份、进程停止，未执行书籍下载，临时数据已清理。首次从/tmp执行被拒绝，改为套件私有临时目录内的同哈希副本进行验证，没有改变系统挂载限制。报告/volume1/@appdata/bookorbit-native/auxiliary-bootstrap.json。下版控制器只自动选择包内bin/tomato-downloader，配置不能替换成任意外部程序；依赖后续SPK升级才会在已安装实例中生效。

本轮控制器策略测试扩为14项，验证器策略4项，候选装配5项，辅助装配4项均通过；公共Redistribution组件审计门槛仍保留。生产Docker依然运行，未修改生产路径或切换生产数据库连接。

## 2026-10-28 DSM 上传升级及升级后服务重启

从已提交的ab717e36构建隔离候选3.5.0-10001，源应用仍来自仓库9c41f580，支持阶段为support-with-auxiliary。SPK SHA256为7c2b476db54575604b0f99ddc1213fec1a502ffde7cc78ee68abb744637919fc，外层INFO的payload MD5校验通过。通过已登录DSM套件中心手动上传并确认升级，由10000升级为10001，没有使用SSH安装套件。

实际安装版本10001、专用UID217211保持不变。配置SHA256在升级前后均为e6fa36e001fa44ba1148257242dd7a4aca97f5edfbe6f871472654365c7c4ce2，升级配置备份与当前配置相同，迁移指纹一致。安装后的控制器SHA256为f16db693916d5727666e61ab2fbe1101f2f8f91e94f93670b0ee1f3aa52cb9ef。原生进程环境已自动选择包内下载助手，并使用包版本隔离的私有Python缓存。

升级后9项只读API验收全部通过。随后通过套件服务控制停止、启动，均返回success=true。重启后的验收扩为10项，新增书源状态接口确认fanqie.configured=true，所有检查通过；同时验证11本复制图书可查询、详情、并行详情、宿主路径Range字节一致、前端、匿名拒绝、专用账号原生进程及8184生产健康。收据位于NAS私有审计目录installed-api-10001.json和installed-api-10001-after-restart.json。验收器从已安装元数据读取版本，避免报告硬编码旧版本。测试令牌只在NAS内存使用。

上述是隔离安装和同schema直接上传升级验收，不是生产替换或整机重启验收。生产仍为Docker r21；本候选productionEnabled=false。后续需完成受保护的生产配置/路径迁移入口、最终停写备份和生产切换，再验收真实访问。完整公开再分发组件审计仍待完成，不能宣布正式公开发行。

## 2026-10-28 生产迁移候选控制器

原生服务新增显式production模式，只有包元数据productionEnabled=true才接受；生产端口固定8184，数据库必须为回环5433的bookorbit或bookorbit_prod前缀，仍拒绝环境注入。隔离模式保持回环监听。私有候选构建需提供10001安装升级后10项只读API通过收据，元数据绑定其SHA256；该能力不等同公开正式发行，公开组件审计门槛未移除。

控制器策略18项、候选装配7项通过。新控制器SHA256为76292ea8ce4e670490f2be6cba45ba01483ff1f1b6e161cdba9cec286f19f85e，在NAS普通UID1026再次完成9项合成生命周期检查，包括子进程崩溃恢复、管理进程被杀后的回收、重复启停及端口占用保护，全部通过；没有使用真实数据库。收据production-capability-controller.json保存在NAS私有生命周期目录。生产尚未切换。

生产迁移采用最终备份的新数据库副本，在副本中改写路径并验证后提升为新生产库；不直接改写当前生产库。此阶段仍须完成迁移执行器、最终停写备份、专用账号ebook写权限及切换验收。

## 2026-10-28 生产迁移执行器和范围权限

cutover-native-app.py默认只读检查，显式--execute才执行。验证现网容器仍运行、数据库为已迁移的原生bookorbit、三个已审查挂载一致且关键登录/加密配置存在，要求无活跃书源任务且专用账号已有ebook目录写权限。停止旧应用后再次检查客户端与书源任务，执行原生PG完整逻辑备份和应用数据归档校验；恢复到全新bookorbit_spk_pathcheck_cutover库，只在副本执行已有事务路径改写器和全字段复查，再改名为新bookorbit_prod_spk库，保留原bookorbit数据库。新服务沿用原JWT及加密密钥；数据库采用新普通角色的回环SCRAM。当前执行器尚未真机执行，不能据此宣称生产迁移完成。

切换前失败会恢复隔离配置、隔离数据和原容器；健康确认后禁止自动重启旧容器，避免丢失新库写入。原容器及原库保留，不删除历史卷。11项测试覆盖源身份/挂载、密钥保留、路径替换、私有数据复制和符号链接拒绝，以及备份失败、复制失败、启动失败、健康后失败及成功路径。文件权限操作在非root测试中替身化，实际ACL另外实测。

NAS已保存ebook目录原ACL到私有审计目录acl-ebook-before-write.txt，仅为/volume1/library/ebook新增bookorbit-native读写继承ACE。专用UID已完成新临时子目录和文件的创建、读取、删除，全部通过并删除测试文件；/volume1/library根仍只读。10002私有迁移候选SHA256为2ef926687e3b5b1bcce1f8805c84afb08463e65df1bcbb649401cb5331e11f1b，正通过DSM上传；尚未将生产Docker替换。

## 2026-10-28 BookOrbit原生生产接管完成

DSM已由10001升级10002，程序来自仓库源码9c41f580，打包提交2e953791。生产能力候选仍标Beta，不代表完整公开再分发审计已通过。上传升级后隔离10项API再次通过，默认只读迁移预检ready=true。执行器提交87636b4b，NAS脚本SHA256 c7a47d3481aced808978eba5148db17acc0b4924c8ba63a1134606c9d5b39fcb与仓库一致。

按已有生产切换授权停止bookorbit-app，执行原生PG最终备份/校验及应用数据归档。完整逻辑备份位于/volume1/database/pg/backups/logical-20261028T094452Z-2ca42b96；应用归档、配置、源容器元数据、计划及验收收据位于/volume1/database/pg/backups/bookorbit-native-cutover-20261028094443，私有权限。由最终备份恢复全新bookorbit_spk_pathcheck_cutover_20261028094443，副本中完成事务路径改写和全字段旧路径清零复查，再提升为bookorbit_prod_spk_20261028094443。原bookorbit数据库未改写、未删除。

新生产由bookorbit-native专用UID217211的包内Node直接运行，端口8184，非Docker运行时。配置mode=production，原JWT、bootstrap及四项加密密钥逐项一致。bookorbit-app容器40c8d300c4ff1e2b52dd6e1a539d5e89ffe0fd72f70b0704b6d2bfc31253d9e2已停止并设restart=no，原容器/数据卷/应用目录保留。健康后已禁用自动回退旧库策略；不能简单启动旧容器代替新库。

12项生产只读API全部通过：数据库、11本图书查询、详情、包内下载助手配置、4路并发详情、文件Range与宿主字节一致、前端、匿名拒绝、专用原生进程、8184健康、旧容器停止、旧容器自动重启关闭。服务通过DSM套件控制停止/启动后相同12项再次通过，收据production-api.json和production-api-after-restart.json在私有切换目录。包systemd单元is-enabled为enabled；本轮未重启整机。

166张public表的行数比对中164张完全一致，book_files6468、books11。auth_sessions由7到6、refresh_tokens由165到117；逐条ID比对确认缺失的1个会话及48个刷新令牌全部已过期，缺失有效记录0。该变化符合server/src/modules/seed/cleanup.service.ts启动时清理过期认证记录的逻辑，不能宣称166表数量逐项完全相同。比较收据data-comparison.json保存在私有切换目录。

真实浏览器通过100.86.77.124:8184与https://jch2w.com:8926访问原生服务，返回200并渲染“登录 · BookOrbit”页面；生产令牌仅在NAS内存使用，没有转移到Mac。后续公开组件审计、正式包与整机重启验收仍应分别处理；Android实机与七猫正文边界不因此完成。

## 2026-10-28 正式发行证据缺口清单

audit-release-gaps.py只盘点许可证证据，不自动作法律许可判断。对10002支持阶段盘点754个npm包实例，5个实例缺声明（passport-strategy、pause），26个实例未找到包根目录许可证或NOTICE；计数包含多依赖实例，不等于独立组件数量。清单包括BookOrbit两个工作区包、sharp-libvips及若干小依赖。根目录未发现不代表上游没有许可，仍需核对嵌套版权文件和对应源码材料。完整报告位于忽略的local/synology-native/reports/release-gaps-10002.json。

正式公开发行仍须补齐逐组件许可文本、必要对应源码，并将全部payload文件绑定到已审查组件后通过payload-contract。不能用package.json的license字段代替完整审计。本轮仅新增审计工具与记录，未改现网服务或重启NAS。

许可证证据复查：26个根目录未找到NOTICE的包实例中，12个在README内带有完整许可段落。审计器新增内嵌许可证据及SHA256记录，不复制或改写冻结阶段，剩余14个实例涉及7个组件：@bookorbit/plugin-api、@bookorbit/types、@img/sharp-libvips-linux-x64、@nodable/entities、abstract-logging、boolbase、drizzle-orm。报告release-gaps-10002-embedded.json保存在local/synology-native/reports。仅有许可证名称或链接不视作完整许可文本；源码义务和公开发行批准仍待审查。5个package.json缺声明仍作为元数据缺口保留，不等同于5个包没有许可证文件。

## 2026-10-29 发行材料收集与界面漏译修复并行进度

已从npm精确版本元数据定位上游提交，取得Drizzle0.45.4与@nodable/entities3.1.0许可证、sharp-libvips1.3.4对应提交的第三方声明，以及9c41f580中的BookOrbit仓库许可证。release-notice-lock.json固定5个组件证据的来源/提交/SHA256，collect-reviewed-notices.py实际收集5项并逐项校验通过。sharp构建仓库Apache许可证不能代替所含库的许可证。

collect-sharp-sources.py按已安装versions.json和固定sharp配方收集28个库的源码归档，28/28下载完成并验证可识别为tar归档，保留来源与内容哈希；不执行远程配方，限定并发、大小与时长，解析保护测试5项通过。收据位于local/synology-native/release-evidence/sharp-sources/receipt.json。独立上游校验值、补丁身份及递归依赖/版权审查尚未完成，不能把28/28下载成功写成公开发行已批准。abstract-logging作者许可证端点503、boolbase1.0.0没有发行标签，未把新提交许可证冒充旧版本证据。上述材料保留，用户反馈的全前端漏译正在优先修复。

## 2026-10-29 当前10006发行材料复核

以auxiliary-0ded7f49实际payload重新盘点，754个npm包实例，14个实例缺包内完整许可文本，仍涉及7个组件。固定上游材料不能改变包内缺失计数，应与外部补充材料分别记录。

boolbase1.0.0补齐上游2015-10-14追加的ISC文本，固定提交be0bcd8a4e917a0a5895e95b523fbbed05a64871，许可SHA256 cdf4d87ae0a6c160227263bf4e39a0a10e30e89ae7256e0f7ac7bde0836552c6。2014初始提交9837d5bf4f30390ac6384a6bc605ca2d69ade4bf、追加许可提交及实际安装版本的index.js字节完全一致，SHA256 c62510fca8738c7444cdf5012bdd0ce214a1b6f7eaff7facb3a919e4656d7341。该证据是上游补充许可且代码未变，不冒称1.0.0压缩包原带LICENSE。release-notice-lock.json已记录区别，六项固定材料全部重新下载并核验通过，收据local/synology-native/release-evidence/notices-six-20261029/receipt.json。

abstract-logging2.0.1固定提交80dfaef91ee87008f4ed2b6e78921d383bccd406没有LICENSE，Readme.md链接原作者MIT许可站。固定README与实际安装文件一致，SHA256 e1a86711fb5055c0e66901276b7d2c843554bf5f1dab218c069c8b9d17148e81。作者HTTPS页面本轮已成功访问，保存原HTML及SHA256 0315813ad87e9e4338ff5c9494ef2d6663be85703d032bee2fa35bcd605340bc；页面显示动态2026版权年份，作为作者链接证据单独保留，未冒充2020固定发行材料。目录local/synology-native/release-evidence/abstract-logging-author-20261029。

公开发行仍需完成abstract-logging固定许可材料复核、sharp对应源码独立校验及补丁/依赖审查，以及全部payload组件绑定。没有改变线上服务或移除Beta标识。

## 2026-10-29 慢存储启动修正10007已部署

源码提交9c21da6cb8133a104c09db9e9836c50e80f33c73修正监督程序：临时PID和退出状态原子替换不再fsync，等待就绪上限600秒，可信监督/子进程身份与HTTP健康必须同时成立，明确失败提前返回。配置、数据库、备份持久化同步没有变化。全套原生Python回归151项通过，其中控制器23项包含240秒延迟成功、600秒截止、无可信子进程拒绝及监督退出提前失败。

群晖UID217211实际运行合成Node验收10项全部通过，首启故意延迟200秒，涵盖重复启停、子进程崩溃恢复、监督程序被杀后的回收、无孤儿进程、其他PID与端口占用拒绝；没有使用真实数据库。该测试模拟慢就绪，不宣称强制RAID故障或整机重启。控制器SHA256 a400266f384063e599907eeca2b9d38bae7a77ffe43135017c09489094e145a3，收据local/synology-native/lifecycle-check/delayed-lifecycle-20261029.json及NAS私有升级目录startup-lifecycle-10007.json。

应用继续使用0ded7f49构建产物，本次仅更新包内控制器。SPK3.5.0-10007，SHA256 178e8b41a7197e707216b536b740eee4c687d607411f47a85013d6aec067f52e。配置备份及完整PG备份核验通过，升级审计目录/volume1/database/pg/backups/bookorbit-spk-upgrade-10007-20261029，PG备份/volume1/database/pg/backups/logical-20261028T205419Z-89c790c1。

DSM从10006升级10007成功，日志04:59:12开始启动，04:59:27启动返回0，实际约15秒，synopkg status为running。已安装控制器指纹与上述收据相同；配置SHA256 e7a939f13b786ea0819172f7ea77f0687f6574549de307604e05738768303a32保持不变。12项生产API全部通过，11本图书可查、详情并发和文件Range正常，收据production-api-10007.json位于NAS私有升级目录。真实公网前端5个图标解码和19项说明验收通过，接口数据为合成，报告local/synology-native/reports/browser-provider-branding-10007-public.json。未重启NAS；十分钟仍是有界上限，不承诺任意存储故障都能成功启动。公开发行组件审查仍未完成，保留Beta。

## 2026-10-29 Sharp来源及构建材料核对完成一轮

新增verify-sharp-sources.py与sharp-source-evidence-lock.json，固定28个归档、构建配方/版本清单摘要、不可变提交/发布资产身份及3个外部补丁。校验器只读取归档，不执行第三方配方或源码；验证文件内容、类型与执行位，不把完整性盘点自动变成公开发行许可。上游身份或归档变化须更新锁并重新复核。

最终锁定收据local/synology-native/release-evidence/sharp-upstream-locked-20261029/receipt.json：28项都有上游对照，其中14项匹配官方SHA256/SHA512，12项匹配固定GitHub/GitLab提交的Git对象，2项仅匹配官方Google对象的尺寸及MD5。这2项明确记录weakChecksumAlgorithm=MD5、strongIndependentChecksumVerified=false，不计入强摘要14项。

TIFF的build/gitlab-ci.ps1在发布归档中使用CRLF，固定Git提交使用LF；仅在已核对的根.gitattributes明确声明对应文件为text/eol=crlf、没有未知子目录覆盖且还原后Git对象完全一致时接受，并记录转换。没有一概忽略空白或换行变化。完整与截断Git树、路径逃逸、内容篡改、执行位、符号链接、分页、摘要歧义、弱校验、属性覆盖及锁漂移、空证据拒绝与失败CLI退出19项测试通过；全部原生Python回归170项通过。

另外补齐zlib-ng、mozjpeg及fontconfig导出归档省略的57个文件，每个文件与固定提交Git对象一致，存于sharp-export-supplements-20261029。sharp-libvips构建仓库ebb95f8add54eee8bed840e3fb587e4cbec857d7完整归档63个Git文件全部核对，SHA256 65fdb633c2d97626352a3771b7a0ce30b6a89af03d2a1238491c8b068e6b8dad，配方与最初收集来源时使用的posix.sh完全一致。

构建仓库引用的GLib、mozjpeg、librsvg三项固定补丁已保存并记录SHA256；对7、9、4个原始文件执行git apply --check全部成功，未实际应用或执行补丁。三项摘要保存在sharp-source-evidence-lock.json，实际材料与dry-run-receipt.json位于sharp-patches-20261029。

后续公开再分发审查仍应覆盖librsvg配方中的cargo update --workspace所涉及实际Rust依赖、相应声明及整个payload组件绑定；当前资料不能直接声称公开发行已批准。公开发行准备与用户群晖自用的运行验收分开记录。上述工作仅在Mac收集材料与运行测试，没有重新打包或改动线上10007。

复核入口：python3 scripts/synology/native/verify-sharp-sources.py --receipt ACQUISITION_RECEIPT --output NEW_OUTPUT_DIRECTORY；默认读取同目录sharp-source-evidence-lock.json，必要时用--lock显式指定审查版本。输出目录必须全新，失败项保留原因，不静默改写原有归档或批准状态。

来源验证器退出语义补充：存在未核对通过的来源时返回非零退出码，同时保留详细失败收据；不接受空来源集合。此前28项上游对照的结果不因此改写，公开批准字段仍为false。

## 2026-10-29 自用正式版10008已部署

用户明确选择先完成自用正式包，公开发布以后处理。新增build-private-stable-spk.py入口与private-stable-policy.py：必须绑定当前安装的应用源码、payload清单、控制器、数据库迁移指纹和版本一致的12项生产API通过收据，继续要求普通账号生命周期验收。默认候选打包仍为Beta，自用正式入口才移除INFO的beta字段，描述改为“BookOrbit 图书管理服务（群晖原生版）。”公开发行批准字段保持false，不能将自用正式包当成公开分发审核完成。

打包提交d169dc5c68c462ba1d3f04a197647a922a6ebb62，应用沿用0ded7f49已验证产物，控制器a400266f384063e599907eeca2b9d38bae7a77ffe43135017c09489094e145a3不变。自用策略8项及全部原生Python回归178项通过。正式SPK3.5.0-10008，SHA256 838de3a15f3fbf2c7a20647f54f63f488613d9873cdab8f36f1ff18f6803e989；INFO实际版本、无Beta、说明及payload MD5逐项核对通过。文件local/synology-native/spk/private-stable-10008/bookorbit-native_x86_64_3.5.0-10008.spk。

本轮LAN SSH不可达，改用用户提供的100.86.77.124，DSM由用户完成Secure SignIn后访问套件中心。通过DSM正常上传升级，服务器日志证实10007到10008成功，09:10:37启动到09:10:51返回0，约14秒。未卸载、未更改数据库结构、未重启NAS。

完整PG备份/volume1/database/pg/backups/logical-20261029T010058Z-2186563a已通过verify_backup；配置和验收审计目录/volume1/database/pg/backups/bookorbit-private-stable-10008-20261029。升级前后配置SHA256 e7a939f13b786ea0819172f7ea77f0687f6574549de307604e05738768303a32一致。已安装元数据releaseChannel=stable、publicationScope=private、productionEnabled=true，实际控制器指纹一致，INFO没有beta=yes，synopkg status为running。

12项生产API全部通过，11本图书、详情并发、宿主Range及原生进程正常，收据production-api-10008.json留在上述NAS私有审计目录。公网真实前端5个官方图标与19项中文说明验证通过，接口数据为合成，报告local/synology-native/reports/browser-provider-branding-10008-public.json。DSM详情已实际检查10008、无BETA和新中文说明，截图/private/tmp/bookorbit-private-stable-10008-dsm.png。

自用正式版交付范围是当前群晖的正常升级与运行。Android实机、七猫正文和未执行的整机重启测试保留原有边界，不将其写成新增已实现能力；公开再分发材料不再作为本次自用交付前置条件。

### 2026-10-29 TXT 逐文件迁移与标题修复

生产 ebook 库由 book_per_folder 转为 book_per_file，10个TXT从3条书目拆为10条；原3个书目ID、全部文件ID、主文件阅读关联保留，音频库不变；先前总数18的基准有误，实际为16本（10本电子书、6本有声书）。独立数据库预演及生产各完成两次扫描和10个TXT阅读验证，所有源文件SHA256与阅读记录指纹保持一致。生产审计位于 /volume1/database/pg/backups/bookorbit-txt-split-20261029，迁移前备份 logical-20261029T072837Z-c93436bb，拆分后备份 logical-20261029T075816Z-285bd5c2 均校验通过。

应用提交164dc3ed修复装饰线和网址被识别为TXT标题；相关106项源码测试、13项迁移保护测试与生产构建类型检查通过。以专用账号对10个真实文件运行新编译提取器，复现旧标题错误并验证新结果，收据txt-extractor-real-files.json。新旧app/dist仅提取器及其source map不同。

候选3.5.0-10009已由新源码构建，通过DSM上传后正在处理，尚未确认安装成功。安装期间本机Tailscale转为Stopped，SSH超时；须恢复网络后先检查服务器实际版本再继续，禁止盲目重复安装。最终自用稳定包尚未生成和验收；当前不能把候选上传当作正式交付。

网络恢复后确认旧包10008仍正常，重新通过DSM升级10009成功。只读核心验收最初因18本基准失败；查询生产及删除审计确认有声书ID2/9已于2026-10-29 09:32删除，早于本次迁移，实际总数为16，无TXT丢失。按16本核验12项核心API通过；两次真实扫描、10本TXT阅读、全部文件SHA256、阅读记录指纹、安装后标题提取合计8项通过，收据production-api-10009-verified-count.json及production-txt-10009.json。独立测试服务已停止。自用正式10010已由相同源码和新生产验收绑定生成，SHA256 139930b2a40e4e0ea85fd83d2a511da0ab2fddf797546f4031ef3a64a4b4d415，正在DSM上传，最终安装状态待验收。

10010 已通过DSM升级并恢复running，实际releaseChannel=stable、publicationScope=private、sourceCommit=164dc3ed，INFO无beta=yes。最终12项生产核心API和8项TXT专项验收全部通过（production-api-10010.json、production-txt-10010.json）；10本TXT仍独立，重复扫描未重并，阅读记录与全部源文件保持一致。最终自用包位于 local/synology-native/spk/txt-title-private-stable-10010/bookorbit-native_x86_64_3.5.0-10010.spk，SHA256如上。10009仅为验收中间版本，最终交付10010；公开发行不在本次范围。

### 2026-10-29 页面入库与自动元数据验证

按用户要求不再备份，并清理历史备份：本机local/synology-native/spk下12个SPK（4624947200字节）已删；NAS /volume1/database/pg/backups下31个历史目录（95812334字节，含逻辑导出、升级配置和应用归档）已删，历史条目提及的该目录收据和备份不再可用。在线数据库、配置、原书籍未删除；保留的旧数据库/容器不在此次文件备份清理范围。NAS homes/MorningTider、database/pg、BookOrbit appdata、tmp的限定检查未发现BookOrbit SPK，不能据此声称整盘所有路径均无安装包。

通过真实页面创建“自动刮削验证”书库ID3，每文件一本，目录只放余罪、云南虫谷、南海归墟三份副本。创建后自动扫描468，自动加入元数据抓取，无手动运行；3本均补齐作者、简介、封面，页面从未抓取数0、简介/封面缺失数0。证实正常扫描导入链路有效；此前直接数据库拆分不会走scanner创建事件，后续扫描已有条目也不会补触发。

从页面为正式电子书库运行一次补抓，10本处理结束队列为空，9本有简介及封面，精绝古城仍缺两项，不能认定全部元数据抓取成功。该轮日志有外部服务连接失败/503，具体单书候选不足原因尚未完全锁定。临时库已通过页面删除，3份测试副本已删，正式书库和阅读条目保留；没有直接数据库写入。本轮未构建新包。

### 2026-10-29 豆瓣回退修复候选

源码7524e3f902b4bdc90b7abd499db5aee9714298fe构建通过，10011候选SHA256 47698994d2f84303d4b27297968367688d7ae48dbead1194993e532535be090f。135项匹配/服务/豆瓣回归及生产类型、ESLint通过；群晖实测建议接口三个查询均为空，公开豆瓣搜索龙岭迷窟可用，新解析器对真实页返回10个图书候选。当前DSM登录已过期，等待用户完成内网浏览器认证；尚未安装10011，线上仍10010，不能声称修复已上线。此轮按用户要求不新建数据库备份。

10011 已通过DSM安装及12项生产API；真实页面使用“龙岭迷窟 / 天下霸唱”搜索显示2个豆瓣候选（2016青岛/2019湖南文艺），精绝古城显示3个豆瓣候选，含ISBN、简介、封面。线上现存龙岭迷窟作者为草梦枫雪，正确天下霸唱候选因此位于“可能是不同的书”；本轮仅验证查询，未保存查询测试的书籍字段，不声称已纠正历史误匹配。

随后DSM安装自用正式3.5.0-10012（SHA256 6b9bade05f0b378df69fd1d0b9be8e308a14fdc336ec50061b70f0fb0ae7bcc0），stable/private，无Beta，运行正常，12项生产API全部通过，16本书。两份豆瓣编译模块哈希与源码构建产物一致。验收收据local/synology-native/lifecycle-check/douban-final-10012.json。未手动创建数据库备份；已清理套件生命周期自动留下的11个配置备份目录（/volume1/@appdata/bookorbit-native/backups），保留在线service.json；本轮中间候选10011 SPK已删，保留最新正式10012。源码修复与同步要求已提交。

### 2026-10-30 国内作者及转换关联实机进展

103a44e2修复每文件模式定向监视扫描无视附件归属的问题；3172b72e增加百度百科、豆瓣作者简介、番茄、起点。后端作者/扫描611项及前端作者188项通过，生产类型与ESLint通过。10013（SHA256 1373e85b4e53c5b9a820d5d5656cbc451ea419e95d9aee8db17b353dcd54c5a5）经DSM安装、12项生产API后，以相同来源构建并安装自用正式10014（14e54e5e7524b561e5b5eacf3a85fef4dbd266304d1bcfc64b57f8e77fbbf7fe）。

真实页面创建临时库4/书目26，执行TXT转换后，监视器及主动重扫477均保持书目26拥有TXT6475与EPUB6476，无新增重复。测试目录最初由root创建且模式被umask收紧为0500，导致写入EACCES；仅将该目录改为专用UID且chmod0700、实际写入探针通过后重试成功，不是转换代码报错。临时库已通过页面删除，测试副本已清理。中文作者页面验证：天下霸唱返回百度百科和3条豆瓣简介；忘语返回起点、番茄及豆瓣；番茄风晓莫作者链接查询返回头像身份（其字体编码简介暂不保存）。未将测试的其他作者写入天下霸唱条目。

历史余罪仍拆为TXT书目10/文件6460与EPUB书目25/文件6474。只读检查确认EPUB有阅读尝试5、一次会话及reading状态，TXT无对应状态/尝试，不能直接删除。de681e7d新增显式页面“重新关联已有EPUB”，后端同时要求上传和删除书籍权限、editor库访问，事务锁定两书/文件，限制同库同目录同名同标题单TXT/单EPUB，遇阅读状态重叠或其他不支持的关联记录拒绝。保留文件及阅读记录ID、原字段时间戳和TXT元数据，清除的只是源重复书目及其附属元数据。上传模块447项、转换弹窗6项、前后端生产类型及ESLint通过。

该修复10015候选（3d4c5411e587c3d7a1480eaf98a485df6cfc89eb23b18edd70d2a3712af9445d）已通过DSM安装，等待BookOrbit用户重新登录后执行页面操作；尚未实际重新关联余罪，也未生成最终10016。前后校验脚本/private/tmp/bookorbit_edition_verify.py仅记录摘要/文件哈希，不能恢复数据，不是数据库备份。现阶段不能把未来不再拆书等同于历史重复已经合并。按用户要求未手动新建数据库备份，升级自动配置备份与中间SPK仍需最终清理。

### 2026-10-30 历史转换关联修复与自用正式10016完成

用户重新登录后，从余罪书目10的转换弹窗点击“重新关联已有 EPUB”，接口201返回bookId=10、fileId=6474、removedDuplicateBookId=25。未直接写数据库。前后只读摘要验证：原文件6460/6474均保留且归属10，TXT/EPUB两格式齐全，原TXT元数据及两文件SHA256不变，阅读尝试、阅读会话、用户状态、文件进度各1条且除书目归属外内容一致，重复书目25已移除。六项检查通过。页面重新扫描电子书库显示“无更改”，再次核验六项通过，未重新拆书；书库共18本（12本电子书、6本有声书）。

10015的12项生产API通过后，同一应用源码de681e7d构建自用正式3.5.0-10016，SHA256 ea71035e5fdc45fa1511a5e940050bda129ed81ed07fcc456703555ad388cadc。通过DSM套件中心升级，实际stable/private、running，INFO无beta=yes。正式安装后的12项生产API及6项文件/历史完整性检查全部通过；页面显示余罪一条书目、TXT和EPUB两格式、正在阅读状态及原阅读会话。重扫依照格式优先级将EPUB设为主格式，未改变原元数据及文件内容。收据local/synology-native/lifecycle-check/edition-repair-final-10016.json；当前包local/synology-native/spk/edition-repair-private-stable-10016/bookorbit-native_x86_64_3.5.0-10016.spk。

按用户既有清理要求，删除本地10012/10013/10014/10015四个历史SPK，仅保留最新10016；NAS bookorbit-native/backups下四个生命周期自动配置备份已清空，在线service.json保留，database/pg/backups确认空。未创建数据库备份。中文作者来源验证见上一节，番茄字体编码简介暂不保存、豆瓣仅明确作者简介的边界不变；自用验收不代表公开发行材料已完成。

### 2026-10-30 作者编辑保存、列表与升级缓存完成

用户澄清此前点击的是“编辑作者”中的“保存”，不是刷新元数据。原流程仅提交文字字段，详情中实时预览的头像没有被保存。a3594d61将来源身份previewImage纳入嵌套验证的编辑请求，表单显示并默认勾选预览头像，可取消；缺失简介预填到表单，手动修改保留。服务端查库编辑权限及作者身份，再下载并保存头像，下载失败不写文字字段；前端失败时保留表单，返回缺少头像也不显示成功。a83184f7另修复百度同名词条正常跳转、主职业与作家描述联合识别、明确有声书播讲者识别。全部作者后端441项、前端192项通过，静态和类型检查通过。

10018页面实测沈醉天“编辑→保存”200，头像与原预览简介一并持久化；模拟一次503验证中文失败提示、草稿保留，再真正保存成功。头陀渊也从编辑表单保存200。随后返回列表仍出现旧占位图，确认KeepAlive的AuthorsView只在首挂载请求数据。7d21d042增加恢复时分页重读，保留筛选排序，首访不双请求；真实10021从列表进入温世仁编辑并保存200，返回时自动请求列表，缩略图加载且performance.timeOrigin不变，证明没有整页刷新。该次先临时绕过旧浏览器缓存以加载正确前端，不能单独视为升级缓存验收。

继续查明浏览器仍加载旧index-D0MmTEsJ，而服务器已为index-C8vMfclO。原生归档mtime=0，同长度入口的弱ETag恒W/"4bb9-0"，可错误304。9f24dcb4禁止静态尺寸/mtime验证器，入口及非指纹文件no-store，assets指纹文件仍长期immutable。6项HTTP集成先复现旧304再验证新内容。10022实际本地和公网10项条件请求全通过，恢复正常浏览器缓存及PWA更新后实际入口匹配C8vMfclO，不再依赖调试绕过。仅修改公共静态资源策略，电子书Range接口不变。

最后由同一来源9f24dcb4构建自用正式3.5.0-10023，SHA256 8879214b2e618c4c3a9b7c1c4bef96de1a34dc6bc98259b1b0da1945ca996a56，通过DSM套件中心升级。实际stable/private、running、无beta=yes；正式版12项生产API与10项缓存保护全部通过，后端保存/静态模块和两份作者前端文件哈希与打包来源一致。验收收据local/synology-native/lifecycle-check/author-save-final-10023.json；页面分阶段收据author-edit-save-browser-10018.json、author-return-list-10021.json、author-normal-browser-cache-10022.json。最终包local/synology-native/spk/author-save-private-stable-10023/bookorbit-native_x86_64_3.5.0-10023.spk。10017和10019仅构建未安装，10018/20/21/22为中间验收，不再是交付版本。

当前13个可见作者中9位头像已持久化并在列表加载：卖报小郎君、天下霸唱、头陀渊、常书欣、忘语、沈醉天、渝江河、温世仁、辰东。小桃红的百科默认跳转植物，枝雀静无对应词条，辰为单字歧义，蟠桃儿/王汤姆/忘幽为混合署名；未给这4条伪配头像，不代表所有来源必定能补齐全部人物。期间用户已将温世仁从多人署名改为独立作者20，未覆盖其修改。正常编辑保存有可用预览头像时不再需要逐个刷新元数据补救；无匹配资料仍应保持占位图。

按用户要求不创建数据库备份，已删除本轮10016到10022共7个旧或中间SPK，仅保留10023；套件生命周期生成的5个配置备份目录已清空，在线service.json保留，database/pg/backups确认空。源码、定制同步清单及测试记录均已提交，不把本次自用验收等同公开发行批准。

## 2026-10-30 TXT 转 EPUB 提交并发窗口修复

10023 上的《凡人修仙传》和《精绝古城》仍被拆成 TXT、EPUB 两个条目。实机日志显示，监视器的定向扫描分别比 addFileToBook 完成早 2.156 秒和 3.321 秒；EPUB 已发布到目录，媒体检查和归属事务还未提交。此前只在扫描开始时尊重已登记的附件归属，未覆盖这一窗口。

源码 a316516b 在文件发布前登记共享 SelfWriteRegistry，覆盖媒体检查和整个数据库事务，并在成功或失败时释放。监视器沿用引用计数等待；定向、目录及全量扫描也避免处理正在登记的文件，并保留原书所有已登记格式，防止全扫误删附件。目录扫描与全扫共用附件归属分组，不采用固定增加延迟的方法。

先在原实现复现发布前缺少保护的失败；修复后上传和扫描 28 个文件 1056 项测试通过，ESLint、生产 TypeScript 检查通过。真实 FileWatcherService 与 20 秒延迟提交联合回归验证：提交期间不启动扫描，提交后仅处理一次事件；失败分支释放引用计数。

10024 由当前仓库源码构建并通过 DSM 套件中心安装。通过页面创建开启监视、每文件一本的临时书库，分别转换 15,271,086 字节及 464,916 字节的 TXT 副本，得到原书 29/30 各两个格式、文件 6481/6483 和 6482/6484。两次页面扫描任务 498/499 均 added=0、updated=0、missing=0，没有新书或文件迁移。20 秒提交窗口由上述真实监视器回归测试覆盖，未人为延迟生产事务。

随后从原 TXT 书的页面使用“重新关联已有 EPUB”：原书 1 保留文件 2、6479，移除重复 27；原书 16 保留文件 6466、6480，移除重复 28。只读摘要比对确认两组文件 SHA256、原书元数据、阅读尝试、会话、状态及逐文件进度不变，原书 1 的一条阅读尝试和一条状态记录保留。主文件归属也恢复一致。生产电子书库页面重扫任务 500/502 均无新增、更新或缺失。

临时书库 5 已从页面删除，再核对数据库无引用后仅删除本次创建的四个测试副本及其空目录。正式数据回到 18 本书（12 本电子书、6 本有声书），10024 的 12 项原生生产 API 全部通过。验收摘要位于 local/synology-native/lifecycle-check/conversion-race-candidate-10024-evidence.txt；不包含账号凭据或原始阅读数据，不是数据库备份。

最终以同一源码 a316516b 和同一载荷构建自用正式 3.5.0-10025，SHA256 1d260bfc52b9b40378df20eb8d4732f7e98d85b73585c5637baae30f01789da5，通过 DSM 套件中心安装。实际运行 stable/private、pending 为空、无 Beta 标识；12 项生产 API、10 项本地及公网条件缓存请求通过，上传模块、上传服务和扫描服务三份已安装文件哈希与构建来源一致。最终收据 local/synology-native/lifecycle-check/conversion-race-final-10025.json，最终包 local/synology-native/spk/conversion-race-private-stable-10025/bookorbit-native_x86_64_3.5.0-10025.spk。升级后再次比对两组原文件、元数据及阅读记录摘要通过。

未创建数据库备份。按用户要求删除本轮旧 10023 和中间 10024 SPK，仅保留最新 10025；清理两次 DSM 升级自动生成的两个 service.json 备份目录，保留在线配置，database/pg/backups 仍为空。临时副本与库已清理，未直接写库修复生产条目。本轮验收覆盖正常转换、慢提交保护、重复扫描与已出现的重复条目；不将进程崩溃或断电中断转换等未实测场景宣称为全部验证。

## 2026-10-31 小说下载页与聚合来源验收

用户反馈下载页交互、部分书名搜索及封面简介缺失，并要求按设置自动聚合来源、结果标注书源。真实番茄接口对“我在”返回多本书和完整元数据；旧页复用单书匹配流程，短关键词被相关性阈值过滤，且模板未渲染封面。baeeb577 对显式番茄/起点浏览保留标题包含关键词的候选，仍保留单书自动匹配与其他提供商规则；页面请求最多 20 条，实际数量由提供商与相关性过滤决定。

a507f70f 取消单来源下拉框，聚合已启用的可下载来源。设置 → 元数据 → 提供商新增“小说下载来源”，番茄、起点各有独立 downloadEnabled；先启用提供商，下载开关仅控制小说搜索与下载，不关闭元数据刮削。已有配置未声明此字段时兼容原有可用来源。严格嵌套 DTO 校验布尔值，复用配置事务持久化，无数据库结构变更。DownloadSourcePolicy 在提交、重试及后台下载开始处执行服务器校验。每条结果按自身来源提交，不依赖页面的全局选择。起点仍限定公开免费章节。

结果卡片展示封面、书名、作者、分类、可展开简介和来源标记；封面失败显示占位。搜索区增加加载与空结果反馈，结果放在任务区之前，下载入队显示提示。新文案使用 en/zh 国际化。前端书源及设置 46 项、后端搜索、配置与任务 230 项通过，另有 7 项数据库专用测试本机跳过；前后端类型和正常提交静态检查通过。

10026 仅构建，因后续聚合需求未安装。10027 包含完整需求，通过 DSM 套件中心安装。首次生成包因 Mac 磁盘空间不足失败，清理本轮已被替代的四个忽略构建目录后，以相同来源重新构建成功；未因此改动群晖服务。DSM 第一次上传遇到会话异常，刷新后重新上传成功，未执行重复安装。

10027 真实页面搜索“我在”返回 11 条，10 条番茄、1 条起点，11 张封面 naturalWidth 均大于 0，标题、简介与来源标记可见。简介展开/收起与 390 像素手机宽度无横向溢出通过。设置页暂时关闭起点下载并保存，后续真实请求 providers=fanqie、resultsPerProvider=20；起点元数据开关仍为 true，持久配置为 enabled=true/downloadEnabled=false。随后从页面恢复两个下载来源，保存返回 200。未为了测试额外下载或添加书籍，生产仍为 18 本书。

候选 12 项原生生产 API 通过；浏览器验收摘要 local/synology-native/lifecycle-check/novel-aggregation-browser-10027.json，正式准备记录 private-stable-readiness-10027.json。截图和收据不含凭据，均为忽略的本地验收材料。

最终自用正式包 3.5.0-10028 由相同 a507f70f 与同一载荷构建，SHA256 ae4a90aa2704a170c35e65f88073e3b3708892ae69ecd3c05c0dc010457b5235，已通过 DSM 套件中心升级。实际 stable/private、无 Beta、pending 为空。正式版 13 项生产 API（含两个下载来源恢复开启）、10 项本地/公网缓存检查及 8 份后端与页面文件哈希核验通过；真实浏览器最终请求 providers=fanqie,qidian、resultsPerProvider=20、目标电子书库 1，入口 index-BdJ09rH5.js 与已装版本一致。最终收据 local/synology-native/lifecycle-check/novel-aggregation-final-10028.json，安装包 local/synology-native/spk/novel-aggregation-private-stable-10028/bookorbit-native_x86_64_3.5.0-10028.spk。

未创建数据库备份。旧 10025 与中间 10026/10027 安装包已清理，只保留最新 10028；两个 DSM 自动配置备份目录已清理，保留在线 service.json，数据库备份目录为空，应用数据目录内无历史 SPK。源码、固定依赖和当前构建保留，历史中间构建按带清单的忽略目录清理，以避免磁盘再次耗尽。本轮没有新增实际下载书籍；下载任务路由、队列反馈和禁用校验由相关回归覆盖，真实页面验收覆盖搜索与来源开关，不描述成新书正文下载已完成。

历史构建清理完成：根据构建清单核验后移除 40 个旧 hash stage 和 14 个旧 source-build 输出，保留当前 a507f70f 的三层 stage、最新源码构建、固定依赖、Git 源码和唯一最新 10028 SPK。可用空间恢复约 59.2 GiB；摘要 local/synology-native/lifecycle-check/novel-build-cleanup-10028.json。

## 2026-10-31 番茄原生启动与新书上传竞争修复

10028 的搜索与设置验收没有覆盖本次实际正文下载。用户任务 1 在 537/285 ms 退出；套件普通账号以相同环境运行 Node 得到 exit 127、缺少 libatomic.so.1。d98cd8ed 修复 TomatoRuntimeService 启动 guard 时丢失 LD_LIBRARY_PATH，仅保留必需库路径，固定 PATH、隔离 HOME，不透传数据库、JWT 或 LD_PRELOAD。新增 --guarded 原生探针，真实 Node guard 与下载器子进程认证、loopback 监听、普通 UID、退出和临时清理全部通过。

10029 通过 DSM 安装后，目标《我在精神病院学斩神》实际下载 219.896 秒、8,711,977 字节并通过 EPUB 校验，但入库失败。storeUpload 与已修复的 addFileToBook 是不同路径：新书发布文件后未登记共享自写保护，监控抢先创建空书目 31，上传事务插入冲突；旧错误处理又删除了已发布文件。9238a1e6 将保护扩大到新书上传发布至事务提交，并仅清理临时数据，保留已发布有效文件。真实监控加 20 秒延迟提交覆盖新书路径，不能以固定 debounce 代替事务边界。

同时新增明确的入库核对重试：页面确认后向原任务 retry 发送 confirmedImportNotCompleted=true。严格 DTO 拒绝其他值，事务仍检查所有权、失败状态、未关联结果、其他活动任务与队列限制；服务检查库编辑权限及来源开关。正常运行和已完成任务不能使用恢复通道。入库失败不再向界面暴露原始 SQL，完成任务可直接打开书籍。上传、扫描和书源 1142 项测试及前端 26 项通过，7 项数据库专用测试本机跳过；前后端生产类型检查、源码生产构建和正常提交检查通过。

10030 通过 DSM 安装后，先只读确认原任务未关联结果、书目 31 无文件无阅读尝试、目标文件不存在，再从实际页面点击“核对入库后重试”并确认，POST 返回 202。没有直接写库或新建替代任务。原任务第 4 次执行完成，复用书目 31，文件 6491，8,711,975 字节，SHA256 2aa02930b319b17c4e36288d4b93ca8fa8589ee87d9fde2ec0e87de35f951b68。EPUB CRC、书名、2043 个 XHTML 文档、主文件归属、单文件及大小检查均通过，总书数 19。生成时间影响文件字节，不要求与上次下载哈希相同。

实际页面显示任务已完成，“查看已入库书籍”进入 /book/31，文件页只有一份 EPUB，作者、简介与主格式正常，未开启阅读器或新增阅读会话。10030 的 12 项只读生产 API、10 项本地/公网缓存检查通过；收据位于 local/synology-native/lifecycle-check/private-stable-readiness-10030.json 与 tomato-import-10030.json。

以同一应用源码 9238a1e6、打包提交 c27674d5 构建自用正式 3.5.0-10031，SHA256 43cfbf4a97257f2f5dd1956fb7e4ca19766c5f643ca6464f4e5c716cd1d5afc6。10031 仅构建，随后用户新增任务列表与进度需求，未安装此包；线上先保留候选 10030，再依次验收组合候选。未创建数据库备份。

## 2026-10-31 下载任务列表、记录删除与真实章节进度

9649d070 将任务卡片改为表格，展示书名、来源、状态、创建/更新时间与操作，保留 25 条游标分页和状态自动刷新。DELETE /book-sources/jobs/:id 只删除当前用户完成、失败或取消的记录；同用户事务锁与重试串行，删除谓词再次限制所有权和终态。进行中的任务先取消并等待终态。删除不调用书籍、文件或阅读记录修改接口，旧来源被禁用后仍可清理自己的历史记录。

243153c5 增加真实进度。检查固定 Tomato-Novel-Downloader v2.4.15 源码，使用任务 progress.saved_chapters/chapter_total，严格核对 jobId/bookId 和非负安全整数范围。起点与通用公开章节下载按实际写入章节数报告。未知总数不估算百分比，获取目录、下载、生成校验 EPUB 与入库分别保留状态；完成任务显示 100%。一个全局活动下载仅保存一个当前任务/用户隔离的内存快照，结束释放，避免频繁数据库写入；页面刷新可重读，应用重启不保留瞬时百分比，沿用中断重试机制。不能把该功能宣称为下载断点续传。

列表提交通过 90 项服务端及 28 项前端测试；加入进度后通过 92 项服务端及 29 项前端，再增加 1 项真实 worker 回调、所有权和结束释放联合回归并通过。7 项需要专用数据库的测试本机未运行。前后端生产类型、正常提交 lint/格式检查和 Linux 源码生产构建通过。核心应用与支持库仍为原生运行，Mac 容器仅用于源码构建。

10032 经 DSM 安装用于列表候选，10033 合并真实进度后经 DSM 安装。用户重新登录后刷新实际页面，完成任务 2 显示 100%，列表字段与来源正常；删除确认先取消时记录保留，再确认返回 200、记录消失。书目 33、文件 6492、元数据、阅读尝试和状态的摘要与 EPUB SHA256 完全不变。该书是用户后续重新下载结果，任务 2 此时已完成，不能把早期书目 31 的复用证据混作当前书目。

从页面重新发起验收任务 3，真实进度先后显示 638/2033（31%）、653/2033（32%）、713/2033（35%），原生 progress value 同步变化；活动行没有删除按钮。随后从页面取消，等待已取消后删除验收记录，两次接口均 200，原书记录及文件哈希仍不变。整个测试在入库前取消，没有新增书目。390 像素手机视口页面宽度仍为 390，表格内部滚动，恢复桌面视口。

10033 的 12 项只读生产 API、10 项缓存请求通过，实际业务总书数 19。页面证据为 local/synology-native/lifecycle-check/task-progress-ui-10033.json，来源绑定收据为 private-stable-readiness-10033.json。

同载荷自用正式 3.5.0-10034，源码与打包提交 243153c5，SHA256 5d63309e105b1c19078728900ac6c9e2cebeb150a6ecdd8da3d8f875ada9dc87，已通过 DSM 套件中心安装。最终 stable/private、pending 为空、INFO 无 Beta；12 项生产 API、10 项缓存请求和 8 份已安装关键模块/页面哈希通过，总书数 19。正式升级后再次对比书目 33、文件、元数据及阅读数据摘要一致，实际页面仍显示任务列表。最终收据 local/synology-native/lifecycle-check/task-progress-final-10034.json。

按既有清理要求，最终验证后删除 10028 至 10033 六份旧/中间 SPK，仅保留 local/synology-native/spk/task-progress-private-stable-10034/bookorbit-native_x86_64_3.5.0-10034.spk；Downloads 中没有历史 BookOrbit SPK。群晖清理本轮五个只含 service.json 的生命周期副本目录，在线配置哈希保持一致，配置备份目录与 PostgreSQL 备份目录均为空，应用状态目录没有 SPK。未创建数据库备份。已删除的完成任务记录不会自动重新出现，其书籍和文件仍保留；验收任务 3 已取消并从页面删除，原历史取消任务 1 保留供用户自行管理。

## 2026-10-31 服务器字体导入（不需要套件升级）

通过现有“服务端字体”页面导入五个官方未修改字体：Noto Serif CJK SC Regular/Bold、Noto Sans CJK SC Regular/Bold、LXGW WenKai Regular，共 3 个字体家族、5 个文件，页面全部返回已添加。浏览器 document.fonts 的五个字形均为 loaded，常规为 400、粗体为 700。字体不是塞入安装包的临时文件，数据存放在应用 data/fonts；该目录下 licenses 保存三份 SIL Open Font License 和来源清单。notofonts/noto-cjk 固定提交 f8d157532fbfaeda587e826d4cd5b21a49186f7c，LXGW WenKai v1.530，完整 URL、大小和 SHA256 见 scripts/synology/native/reading-fonts-manifest.json。没有导入系统专有字体，也没有更改用户默认阅读字体。

下载来源滑动开关代码已完成，11 项原有提供商筛选/保存测试通过；增加按钮后，测试工具按 aria-labelledby 区分提供商与独立下载开关，避免混为一组。尚待本轮组合包部署后页面验收，不能仅凭源码修改记为已上线。

## 2026-11-01 自用正式 10037 交付完成

本条更新前述 10034/10035/待部署记录：10036 候选与 10037 自用正式包均通过 DSM 上传安装，源码 c53026122d2b77edd72daac822027e5ea89d54cd，打包提交 ddc2900b。10037 的 releaseChannel=stable、INFO 无 beta 字段、DSM 状态 running/status_code=0。正式包 SHA-256：e153bdcc92de923c59ed2ccdb1dd33d691ebfb47c8990c8607e329499a807d88。保留最终安装包 local/synology-native/spk/private-stable-10037/bookorbit-native_x86_64_3.5.0-10037.spk。

升级流程已改为核对源码、载荷、迁移、已审阅前置版本及策略摘要，再以套件普通账号运行包内迁移。PG18 隔离数据库由 127 条迁移增量升到 130 条且哨兵数据保留；生产 10036 正常应用剩余 0129，10037 同 schema 升级正常完成。没有数据库备份。旧故障记录保留用于回归，不代表当前套件仍损坏。

页面验收：先打开作者编辑框、再放行延迟的元数据请求，头像保存勾选会出现且默认开启；未提交该作者修改。刘慈欣已通过页面保存，正式包作者列表及刷新后头像加载成功。源码针对性 19 项测试、格式和 ESLint 通过。字体 5 家族 7 文件在正式包页面全部 FontFace.load 成功，中文分类并保留唯一原字体名；开放许可和摘要留存在字体数据目录。

小说下载来源已使用圆形 role=switch；保留用户原状态（番茄开、起点关），未擅自开启来源。猎罪神探真实搜索展示“✓ 已入库”和“? 可能已入库”及正确书目链接。临时书库从页面创建为 book_per_file，验证 TXT 首次上传、同路径不同内容确认、替换后不增书、明确新建后两本、完整哈希命中、刷新后待确认恢复、独立规则保存和恢复全局继承。其目录最初继承只读 ACL 导致验收上传 500，补充该临时目录的套件写权限后通过；未改原库 ACL。

临时书库和样书已从页面删除，其两个 TXT 所在独立目录随后清理。本机两个专用测试数据库容器已移除。正式包 12 项生产 API、10 项静态缓存、8 份关键前后端文件摘要均通过。原 23 本书、6482 文件、元数据、16 位作者、26 条作者关系、9 条阅读状态、5 条阅读进度的完整行摘要与升级前全部一致。

证据：local/synology-native/lifecycle-check/private-stable-10037-acceptance.json、private-stable-10037-data-check.json、private-stable-readiness-10036.json、schema-upgrade-c5302612.json；页面与隔离验收材料见 local/synology-native/reports/stable-10037/。5 个本机历史 SPK 已删除，保留最终正式包；服务器升级自动配置副本按既有清理授权移除，当前配置、字体和业务数据库保留。源码与文档仅本地提交，不推送。

能力边界：上传/断点上传/小说/Book Dock 及追加、替换的跨媒体组合由本机相关回归与 PG18 七项真实 HTTP 测试覆盖，不能把本次临时 TXT 页面验收写成所有媒体、全部故障组合实机穷举通过。Android 实机、公开发行材料及未执行的整机重启验收等原有后置事项不因本次交付自动完成。

## 2026-11-06 番茄长书无进展超时修复（待实机安装）

现场任务10、11在2026-11-06的多次下载均以600272–601611ms中止，日志为AbortError，对应原整本600000ms限时。修复将该配置作为没有新增已保存章节的闲置时限，守护进程通过IPC接收真实章节增长；总耗时不作为终止条件。启动、上游请求、取消、孤儿进程回收与无进展等待仍有界。

锁定下载器v2.4.15源码commit e2197970c366180bb566b8acfbda67cc1331a1ef确认BookManager会加载status.json与downloaded_chapters.jsonl，仅下载缺章。应用按书ID保留独立缓存，失败或取消不清空，成功校验后删除；闲置7天清理，活动缓存跳过。旧随机工作目录仍按原2小时清理。真实子进程测试覆盖IPC进展超过原时限后仍存活、无进展后停止且退出IPC；服务集成测试覆盖超过闲置时限但持续有章节、失败保留缓存且重试重用、重复进度不续命。

本机测试与源码构建不代表生产已部署；后续安装与长书验收结果需追加本节。

### 10039 正式包安装与验收

修复源码提交6ad59fac5fa3c67ca4179357bef0a7c9ab927eb9。本机17项针对性测试通过，含真实守护进程、无进展超时、取消、超过原时限仍有进度以及失败缓存重用；后端TypeScript与全量ESLint通过，Linux源码构建前后端成功。

10038候选经DSM手动安装后，12项生产只读API与三份新运行模块SHA-256核验通过。按同一应用载荷和安装收据构建自用正式10039（无BETA），SHA-256为49cb3f5d13f2a0828f33d972d09490e79a0273f2ced744091a5aabaa7391dd4c，并再次通过DSM套件中心升级。正式版本running/status_code=0、stable，12项API全部通过；七张业务表的完整行摘要在升级前后完全一致，无数据库结构变更或数据库备份。

群晖普通账号隔离测试确实保留了28章状态与28行追加日志。该书随后上游长期无新增章节，新逻辑约611秒后按闲置超时停止，未错误报告下载完成；此结果不能描述为整本成功下载。缓存已复用到生产，正式API重试原任务10、11，不新建重复任务。任务10实际进度28/197，证明恢复了已有章节；任务11排队。上游剩余章节的可用性仍须按实际结果报告。

包：local/synology-native/spk/tomato-idle-private-stable-10039/bookorbit-native_x86_64_3.5.0-10039.spk。收据：local/synology-native/lifecycle-check/tomato-idle-readiness-10038.json、tomato-idle-final-10039.json。源码已本地提交，未推送。

### 10039 后续：任务10仍停在28章，未完成整本下载

2026-11-06用户再次报告失败。恢复Tailscale后只读核对生产API：任务11已完成，resultBookId=41，书名为《二十四史：完本精校大全集（中华古籍国学宝典文库）》；任务10尝试5次后仍失败，错误为无新增章节超时。生产缓存完整保留前28章，目录共197章，缺169章，从“开国名将谱”开始。线上下载器日志出现93次register_key空响应、182次章节为空或缺失提示（计数为当前日志中的匹配行，不等于独立失败请求数）。

使用同一已核验v2.4.15可执行文件，在Mac上的隔离Linux环境以干净状态复现：同样取得前28章后停止新增，后续返回空内容、注册接口空响应，夹有TLS握手失败。该复现不能证明网络、权限或接口兼容性中的哪一种是最终根因。缺失169章在目录中均标记isChapterLock=true，但needPay=0，且已有18章也带lock标记，因此不能直接宣称“后169章都是付费章节”。官方公开详情与阅读页本次返回404，也不足以证明书籍下架或必须付费。

核对上游v2.4.16发布记录与v2.4.15比较，公开变更主要为TTS与CI，未发现正文下载源码修复依据；未据此替换生产下载器。本次未修改生产配置、数据库、任务或SPK，也未再次重试任务10。原28章缓存保留，Mac隔离进程退出。整本获取能力仍待解决，不能把闲置超时与续传修复的通过结果写成该书完整下载成功。后续应核实上游正文可用性及授权来源，不以延长超时、导入缺章EPUB或重复点击重试作为完成验收。

脱敏汇总：local/synology-native/lifecycle-check/tomato-partial-followup-20261106.json。

### v2.4.16 隔离单章兼容性核验（2026-11-06）

进一步从上游官方发行元数据核对并下载Linux_musl_amd64 v2.4.16，SHA-256=c97b039f798f1ffa9e0faa4ff5961bf3a11ce5242399ec94d35515cedb15efdf。在本机隔离Linux环境按正常Web API逐项测试同书第28、29、34、100、197章，独立临时目录、无生产数据或认证：28章成功取得1/1章；29、34、100、197章均为成功0/1、失败1/1、持久章节0。可确认失败不只集中在某个批次的第一个坏章节，直接升级到当前最新版也没有解决这几个样本；不能据4个失败样本宣称已逐章穷举全部169章。

下载器上述失败任务仍返回state=done，包装阶段progress.saved_chapters=1，但history明确failed_chapters=1，因此不能把done或包装进度视作正文成功。BookOrbit现有assertTomatoComplete会检查history并拒绝缺章入库，该保护应保留。

上游Issue #286维护者曾说明相同register_key空响应也可伴随章节被审核/不可用，不能据报错直接认定DNS或付费。本次缺失章节的具体受限原因仍未确定，已请用户用官方App核对第29章《开国名将谱》是否可直接阅读，以区分客户端访问条件与下载器接口兼容性。未修改线上下载器、配置或生产任务；未导入抽样生成的EPUB。脱敏证据：local/synology-native/lifecycle-check/tomato-chapter-compatibility-20261106.json。官方来源：https://github.com/zhongbai2333/Tomato-Novel-Downloader/releases/tag/v2.4.16 、https://github.com/zhongbai2333/Tomato-Novel-Downloader/issues/286 。

### 会员账号信息补充（2026-11-06）

用户已核实：本人开通VIP后，官方App可正常阅读此前受限的后续章节。这说明会员账号在官方客户端具有阅读权限；现有BookOrbit番茄链路没有传递该账号身份，下一步应验证正常账号授权及章节访问能力。锁定下载器的Config没有番茄Cookie/账号授权字段，/api/login只接收管理页面密码，不是番茄账号接口，不能简单增加登录表单宣称已支持VIP下载。

已打开独立Chrome官方登录页https://fanqienovel.com/main/writer/login并切换扫码登录，等待用户自行登录以开展本机验证。当前未读取或传输用户凭据，未修改生产包或任务。需求和状态见CUSTOMIZATION_REQUIREMENTS.md“番茄个人账号授权需求”；登录支持与会员下载均处于待验证，不能标记完成。

### 官网账号登录后单章验证（2026-11-06）

用户已在专用Chrome完成番茄官网登录。只在该浏览器内使用同源正常请求携带现有会话，未导出Cookie、未向群晖或第三方接口传输凭据，未读取其他浏览器用户数据。

结果：7148992787034147848与7328230298259295294的目录分别返回169、197章（HTTP200/code0），两本详情页均HTTP404。对照新版首章、此前已下载的27章、新版缺失28章、旧版缺失29章，正常阅读页均HTTP404，网页/api/reader/full接口均HTTP200但业务code=-1/message“没有对应章节”，没有正文。此前成功章节在网页也失败，因此不能把网页错误解释为该章在官方App已删除，也不能把网页登录当作已验证的VIP下载方案。

官网书架同时展示“因版权问题，以下书籍暂不支持浏览器阅读”，但本轮弹窗内没有可核对的目标书名，不能据此单独认定两个目标书均已列入该清单。用户确认本人VIP在App可读，而正常网页路径仍未提供正文，后续需要支持该账号会员阅读能力的实际正文适配，不能仅加登录表单或转发Cookie给不支持该参数的原下载器。

账号授权与VIP正文下载仍未实现、未部署；本次未修改生产包、任务或原续传缓存。专用浏览器会话留在本机。脱敏证据：local/synology-native/lifecycle-check/fanqie-authenticated-web-feasibility-20261106.json。
