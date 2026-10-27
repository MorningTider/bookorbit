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
