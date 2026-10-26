# Internet Archive 公共领域漫画书源

用于 BookOrbit 请求下载系统的索引器插件。仅检索来源标明 Public Domain Mark 或 CC0 且可公开下载的 CBZ 漫画，下载前重新校验来源、许可和文件可用性。

安装 `index.mjs` 后，在管理设置的请求书源中添加 `internet-archive-comics` 类型。漫画沿用上游电子书请求类型，以 CBZ 格式入库。需要服务器能够访问 archive.org；可在该索引器的网络配置中指定服务器可达的代理。搜索和实际文件下载均使用该配置。

不支持借阅、受限访问文件，也不会绕过访问验证。来源的许可声明应由使用者结合具体作品核实。

验证：`node --test plugins/internet-archive-comics/index.test.mjs`。完整运行时验证：设置 `BOOK_SOURCE_E2E_PLUGIN=internet-archive-comics`，执行 `scripts/book-source/verify-indexer-runtime.mjs`，必要时设置 `BOOK_SOURCE_PROXY_URL`。
