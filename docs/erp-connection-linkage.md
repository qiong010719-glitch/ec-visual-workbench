# 上架与连接设置的关联

连接设置保存浏览器环境、ERP 连接及店铺。ERP 连接绑定一个浏览器，店铺绑定一个 ERP 连接，每份母稿属于一家店铺。

上架页按 **ERP 连接 → 目标店铺 → 本批使用母稿** 选择。该页没有独立的浏览器选择；“检查 ERP 环境”、母稿校验与执行均使用该 ERP 已保存的浏览器配置。一个账号可以有多条 ERP 连接，连接名称相似不代表它们共用浏览器。

- 在连接设置保存新增或修改后，上架页会同步 ERP、店铺和母稿列表。窗口切回、跨页保存通知以及前台每五秒读取均可触发更新。
- 所选 ERP 没有关联店铺时，需在连接设置新增店铺，或编辑现有店铺的“使用的 ERP 连接”并保存。上架页不会展示其他 ERP 的店铺作为替代。
- 新批次保存连接配置，历史恢复沿用该批次的 ERP。执行前若发现绑定、浏览器配置、店铺或站点已经变化，停止并提示核对。旧素材和执行记录保留；更换连接时新建批次，已有成品图可以重新导入。
- 已有执行批次继续保留母稿、图片与重复提交检查。连接不可用时不会切换到另一浏览器。

本次验证使用本地测试素材与模拟 ERP，不调用真实生图服务或发布真实商品：

```powershell
npm run check
node --test tests/erp.test.mjs tests/merchant.test.mjs tests/template-coordination.test.mjs tests/erp-template.test.mjs
node tests/browser-erp-linkage.mjs
node tests/browser-store-sync.mjs
node tests/browser-listing-sidebar.mjs
node tests/browser-execution-mode.mjs
node tests/browser-merchant.mjs
```

真实商家验收：选择目标 ERP，检查登录环境；确认店铺和母稿归属；先用“仅保存草稿”验证一条。构思和生成阶段仍保留母稿校验，因此可能打开所选 ERP 的母稿页面。
