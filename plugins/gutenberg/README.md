# Project Gutenberg 下载适配器

该适配器使用 BookOrbit v3.5 的 indexer 插件接口，搜索公开 OPDS 目录并下载开放获取的 EPUB。当前版本为 1.1.0。

将本目录部署到应用持久目录 `/data/plugins/indexers/gutenberg`，或通过现有索引器插件安装页面安装 `index.mjs`。在图书请求设置中添加并启用该索引器，再通过 `/requests` 创建请求、搜索资源和下载入库。已用编译后的插件加载器验证真实搜索、地址解析和下载暂存；目标群晖的安装与正式入库仍待验证。

仅接受 Gutenberg HTTPS 下载地址；下载文件的大小限制、任务状态和用户权限由现有下载任务框架负责。EPUB 是否包含封面及元数据取决于来源文件，不能保证每本均有。

运行离线解析测试：`node --test plugins/gutenberg/index.test.mjs`。

目录兼容：同时支持搜索页的 `subsection` 图书目录，以及详情页的 `acquisition` / `acquisition/open-access` EPUB 链接。每次最多读取五个详情页，并发最多两个，每页上限 2 MiB。读取来源声明的语言和文件大小，不再把未知语言固定写成英语。

实际网络验证：使用编译后的 BookOrbit 插件加载器和 `DirectDownloadService` 搜索《A Modest Proposal》，下载在 75,176 字节处中断后经过 ETag/范围校验续传，最终 107,350 字节，通过 EPUB 校验。本机网络较不稳定，《Pride and Prejudice》的较大样本在三次尝试后仍中断，不能据此宣称所有文件和目标 NAS 网络均已通过。

可复现验证（需要先构建服务端，使用临时目录和模拟任务记录，不写生产数据库或书库）：

```sh
pnpm --filter server build
node scripts/book-source/verify-gutenberg-runtime.mjs
```

可通过 `BOOK_SOURCE_E2E_QUERY` 更换公开测试作品。验证脚本只选择声明体积低于 4 MiB 的样本，并在结束时清理暂存文件。
