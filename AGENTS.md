# 最新跨境工作台

从 2026-11-23 起，本目录是用户指定的统一维护入口。Temu 最新业务已合入此处的多平台内核与玻璃 UI；后续修改直接在本目录进行，不回写旧 Temu 分支或输出快照。

## 结构与验证

- `src/` 为共享业务内核，`public/local/` 为业务页面和玻璃 UI，`desktop/` 为桌面入口。
- 共享侧栏由 `public/local/workspace-shell.html` 维护，修改后执行 `node tools/sync-workspace-shell.mjs`，然后 `npm run check`。
- `npm test` 使用隔离数据及替身。免费选品、固定模板、多窗口及工作区的集成边界见 `tests/crossborder-sync.test.mjs` 和对应 `browser-*.mjs`。
- 默认启动 `启动跨境工作台.cmd`，端口4196。既有数据仍在上一级 `desktop-preview-data`，名称保留以保证历史数据和浏览器本地状态连续。
- 配套 ERP 脚本在 `../scripts`；打包副本在 `workspace-support/auto-listing/scripts`。修改这类执行器时同时检查分发副本。
- 不从旧4185工作区自动复制真实数据、密钥或登录目录，不自动恢复采集、收费生成或发布任务。
- 保留多平台能力、Chrome窗口所有权检查及不明提交结果的核对机制。总览与任务列表只读取状态。

本次合并与回溯位置见 `docs/unified-workspace-20261123.md`。用户在会话中提供的 Skill 创建访谈和算舟图片渠道规则继续适用。
