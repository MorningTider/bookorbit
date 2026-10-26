# 起点、七猫公开免费章节调查

日期：2026-10-25。用户没有授权下载接口，明确要求先调查公开免费章节。此次只读、少量样本，不登录、不购买、不解密、不批量下载，不修改群晖代理或生产服务。结论不等同于正文下载功能已实现。

## 起点

本机实际读取官方移动书籍页 https://m.qidian.com/book/1010868264/ 和公开目录 https://m.qidian.com/book/1010868264/catalog/ ，均HTTP200。目录SSR包含1418个章节及章节ID、卷、顺序等结构化信息。这个样本的HTML标签全部显示免费，不能据此认定所有VIP章节长期免费；限免、渲染逻辑和服务端实际访问权限尚需分别核实，不能仅用HTML免费标签决定下载权限。

未登录以普通fetch请求目录中第一章 https://m.qidian.com/chapter/1010868264/402733549/ 返回HTTP200，页面约42922字符，正文容器含2544字符、页面71个p元素，无标题验证提示。仅记录结构和长度，不将小说正文纳入仓库。证明单个公开样本技术上可读取，不证明其他章节、完整作品或来源批量访问许可。

官方合作API https://open.yuewen.com/docs/1010.html 需要产品appflag、appsecret、IP白名单；https://open.yuewen.com/docs/1012.html 的免费模式属于合作模式，明确说明其章节正文不可缓存。不能把该接口当作无需凭据的公开EPUB下载接口。官方章节模型区分vipStatus和freeStatus；公开网页的缩写字段未经确认，不直接套用API含义。

接入前仍需：普通非限免样本的公开/受限边界验证；独立提取正文的完整性与广告过滤；目录变化、章节失效、取消、限速、请求时限、内容上限、来源URL约束；明确导入是公开章节选集而非完整作品；与现有用户隔离、队列、去重、EPUB验证衔接。不得把预览、缺章或付费提示保存为完整章节。

## 七猫

官方首页 https://www.qimao.com/ 及书籍页 https://www.qimao.com/shuku/222767/ 可由网页读取工具读取，书籍页展示首章预览和目录入口。单章链接读取失败；本机普通fetch对书籍页请求失败，群晖生产容器对首页请求亦失败。未稳定取得目录与单章正文的统一数据契约，失败不等于不存在公开正文。

官方版权声明 https://www.qimao.com/copyright 对复制作品内容提出书面许可要求。因此可公开阅读不能直接解释为已获批量保存许可；当前没有经核验的开放下载接口或授权接入材料。暂不实现基于未确认内部接口、App解密或验证绕过的下载器。

## 当前状态

起点：公开目录和单章正文的技术可行性初步通过；稳定性、权限边界及入库实现未完成。
七猫：官方页面可读，但本机/NAS访问及单章稳定获取未通过，仍保持元数据功能。
现有番茄、Gutenberg不受本次调查影响，生产服务没有变更。

## TaleBook 复用调查

用户提出优先核验TaleBook是否有授权实现，满足条件则复用。读取官方仓库master文件树固定提交 b2d60b33b7476f7e64a125e22761b0194a6e1e48，未运行其下载器，也未引入其签名密钥。

- 根LICENSE为BSD-2-Clause，允许在保留版权声明、条款和免责声明条件下复用该许可覆盖的代码。不能据此认定源站小说内容或App接口也获授权。
- webserver/plugins/meta/qimao/api.py开头明确仅支持详情、目录、搜索，不含下载。Issue805及PR806属于七猫元数据接入，不能当作正文下载授权证据。实现引用其他七猫项目的签名逻辑，任何复用需另查原始来源许可；不直接复制签名材料。
- webserver/services/booksource/engine.py及save_service.py提供通用目录/章节解析和保存能力，依赖外部真实规则。内置seeds/booksources.seed.json只有example-novel.com演示规则，没有可直接使用的七猫或起点正文规则。
- webserver/plugins/source/legado.py的插件元数据另标license=GPL-3.0，与根BSD声明不同；不能把所有组件一概按BSD处理。若未来复用具体代码，需按对应文件和上游来源核验许可并保留归属。
- 七猫映射含ISBN占位符和当前时间作为pubdate，不适合照搬到BookOrbit的真实ISBN及出版日期字段。

结论：可研究通用书源机制，但当前检查到的官方代码没有提供可直接搬入的已授权七猫/起点完整正文下载方案，也未找到源站授权证明。未将未验证能力标为已实现，未修改生产。

参考：
https://github.com/talebook/talebook/blob/b2d60b33b7476f7e64a125e22761b0194a6e1e48/LICENSE
https://github.com/talebook/talebook/blob/b2d60b33b7476f7e64a125e22761b0194a6e1e48/webserver/plugins/meta/qimao/api.py
https://github.com/talebook/talebook/blob/b2d60b33b7476f7e64a125e22761b0194a6e1e48/webserver/services/booksource/seeds/booksources.seed.json
https://github.com/talebook/talebook/issues/805

2026-10-25更新：起点公开免费卷选集、通用JSON/CSS章节引擎及TXT转换完善已随r8部署生产。群晖隔离130章入库及生产健康检查通过。七猫正文仍未接入。此前未实现记录属于历史状态，当前边界与验收见PUBLIC_CHAPTER_ENGINE.md及SYNOLOGY_DEPLOYMENT.md。

## 2026-10-26 七猫补查

官方书籍页https://www.qimao.com/shuku/222767/仍可公开展示首章；这不等于已取得稳定章节目录/正文下载契约。官方https://www.qimao.com/copyright/仍要求对作品页面、段落和内容的复制等取得明确书面许可。当前用户没有授权下载接口，TaleBook也未找到可直接复用的授权正文实现，因此继续保留元数据功能，不把公开展示首章当作已完成正文下载。无App签名、解密或访问限制绕过实现，未批量保存作品正文。起点和通用公开章节引擎已实现的状态以部署记录为准。
