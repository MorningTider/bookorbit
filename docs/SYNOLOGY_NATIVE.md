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
