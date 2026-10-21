# 定制分支与上游同步流程

本文约定如何在上游正式版本上维护 BookOrbit 定制改动，并在后续发布时同步升级。

## 当前分支状态

- 上游仓库：`https://github.com/bookorbit/bookorbit.git`
- 用户 fork：`https://github.com/MorningTider/bookorbit.git`
- 正式基线：`v3.5.0`，对应提交 `c59dd011`
- 定制分支：`custom/bookorbit-v3.5.0`
- 定制分支从 `v3.5.0` 建立，再迁入现有定制改动。上游 `v3.5.0` 之后尚未进入正式版本的提交没有自动带入。

`origin` 应指向用户 fork，`upstream` 指向官方仓库。不要在 `main` 上直接开发定制功能。

## 首次配置与检查

```bash
git remote -v
git remote add upstream https://github.com/bookorbit/bookorbit.git  # 仅在 upstream 尚不存在时执行
git fetch upstream --tags
git switch custom/bookorbit-v3.5.0
git status --short --branch
```

确认定制分支基于目标正式 tag：

```bash
git merge-base --is-ancestor v3.5.0 custom/bookorbit-v3.5.0
git log --graph --oneline --decorate --max-count=30
```

上游仓库地址、tag 和版本号必须以官方 Releases/Tags 页面及签名信息为准。不要只根据 fork 的 `main` 推断正式版本。

## 同步新的正式 tag

每次上游发布新 tag，例如 `v3.6.0`：

1. 确认该 tag 是官方正式发布，记录 tag、提交和发布日期。
2. 检查定制分支和工作区状态，确保没有未保存改动。
3. 从定制分支创建一次性升级分支。
4. 将官方 tag 合并进升级分支，不要把上游 `main` 的未发布提交混入正式升级。
5. 解决冲突时先理解上游改动与定制功能的关系，再逐项合并；不要整文件选择 ours 或 theirs。
6. 按 `UPGRADE_CHECKLIST.md` 完成依赖、数据库、测试、构建和群晖验证。
7. 所有检查通过后，将升级分支合并回定制分支，并把本文件中的基线版本更新为新 tag。

命令示例：

```bash
git fetch upstream --tags
git switch custom/bookorbit-v3.5.0
git switch -c upgrade/upstream-v3.6.0
git merge --no-ff v3.6.0
# 解决冲突并完成验证后：
git switch custom/bookorbit-v3.5.0
git merge --no-ff upgrade/upstream-v3.6.0
```

升级成功后，可继续沿用现有定制分支名，避免每次升级更名；文档中的当前基线版本必须同步更新。升级失败时保留升级分支用于排查，不要强推或重写已部署版本的历史。

## 定制代码维护原则

- 每项定制尽量拆成可单独审查的提交，并在需求矩阵中记录状态和验证证据。
- 上游已实现同一功能时，优先评估移除定制补丁，避免长期重复维护。
- 上游修复单个问题时可以 cherry-pick 到升级分支；完整版本升级使用 tag 合并，不要用一串 cherry-pick 替代整版同步。
- 数据库 schema 变更必须按项目 Drizzle 规则生成迁移，不手写迁移 SQL。
- 前端 API、后端 DTO、共享类型和权限检查必须一起核对。
- 更新依赖前先检查 lockfile、Node/pnpm 版本、构建基础镜像和原生依赖。
- 不将 DSM 密码、SSH 密码、数据库口令、JWT 密钥、令牌、真实用户数据或私有日志提交进仓库。
- 合并后应重新确认自动刮削、TXT 扫描与转换、元数据匹配、封面展示、书源插件和群晖部署状态，不沿用旧版本的口头验证结论。

## 回滚

- 代码回滚：保留已验证的定制版本提交或部署 tag，创建回滚分支或回滚提交，不用强制重置共享分支。
- Docker 回滚：将 `APP_IMAGE` 设回已验证的精确版本 tag，并按部署文档重新启动。
- 数据库回滚：优先恢复升级前的数据库备份和对应应用版本。数据库主版本升级或 schema 迁移后，不能假定旧应用可直接打开新数据目录。
- SPK 回滚：先验证旧版本能否读取升级后的数据。若不能，必须恢复升级前的数据备份；不能只降级应用包而忽略数据库兼容性。

