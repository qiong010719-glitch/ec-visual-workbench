# PR #7 无出图验收记录

日期：2026-11-12（北京时间）
基线：`cursor/taobao-text-move-inpaint-de46`，`c075551`。
结论：本地修复后的无出图链路通过；真实模型是否保留蒙版外画面仍未验证，禁止据此合并。

后续状态：实图验收发现问题后已增加像素保护及边界拦截，详见 [最新保护修复验收](taobao-pr7-guard-qa.md) 和 [第一次实图验收](taobao-pr7-live-qa.md)。下文仅记录第一次无出图验收时的范围、依赖与提交状态，不代表当前状态。

## 范围与执行边界

- 只修改淘宝项目 `D:\agent合集\自动上架\ec-visual-workbench-taobao`。
- 没有读取已有 `.env` 的密钥，没有向真实图片服务提交请求，实际生成次数为 0。
- 测试使用显式本地假凭据和回环地址上的图片服务替身。返回的测试图带有“本地测试替身 · 未真实出图”字样；它只用于证明请求和任务流程，不能证明模型编辑效果。
- 临时文件、浏览器专用资料目录、截图、测试状态都保存在本项目内；未使用 4185。
- 改动保留在 PR #7 的本地分支工作区，尚未提交或推送；没有合并任何 PR。
- 原有未跟踪的 `package-lock.json` 未修改。

## 实际发现与修复

1. 首次拖动的旧位置为 `null`，原代码只发送新位置的一个蒙版。浏览器已复现并保留请求记录。现在必须同时具备旧位和新位；未知旧位时阻止提交，提供“标记原字位置”按钮让用户点选原图文字中心，不用猜测中心点代替真实位置。
2. 原卡片横向 flex 排布与悬浮按钮会压缩、遮住图片，鼠标跟随的倾斜效果还会让百分比坐标轻微偏移。淘宝槽改为纵向排布，快捷按钮与操作按钮移到图片外，并关闭这些槽位的倾斜；坐标直接按实际图片矩形计算。没有新增文字图层。
3. 原接口把空值、负数和越界尺寸转换或夹成看似有效的区域。现在在排队前要求一个 `erase` 和一个 `paint` 方框，且全部坐标为有效数字、宽高为正、边界在 0–100% 内。
4. 补齐重复点击、刷新恢复和失败重试：按槽保存待完成的移动信息；同槽已有任务时不重复提交；局部修改失败保留原图，重试仍走局部编辑。原有单张 REDRAW 入口在存在待应用文字移动时也走相同检查。
5. 保存上次移动的原文，防止二次移动改用后来修改的构思；识别提示词中的“原文”字段，并显示待移动原文供人工核对。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| 原分支淘宝测试基线 | 16/16 通过；这些原测试没有阻止首次移动缺旧位的情况 |
| 补充断言后的淘宝测试 | 16/16 通过，覆盖缺原图、缺旧位、双蒙版、越界/空值、重复点击和原文保留 |
| 回归测试 | 151 项通过，0 失败；另 1 项 Apify 认证测试因需要读取 `.env` 测试文件而显式排除 |
| 浏览器端到端 | 8 组检查通过；页面异常为 0；意外外部请求为 0 |
| 静态检查 | 21 个页面脚本语法与静态资源引用检查通过；`git diff --check` 通过 |
| 预览服务 | `http://127.0.0.1:4173/` 返回 HTTP 200；`imageConfigured=false` |

浏览器验证使用真实页面、鼠标拖动、标记原位置、点击重绘和任务轮询。链路是：

`页面 → 本地 /api/inpaint → 本地模拟 /v1/images/edits → 本地任务完成`

检查了上传原图字节、PNG 蒙版字节、双区域百分比、`800x1000` 原图尺寸、`gpt-image-2` 模型保持不变；没有调用 `/images/generations`。另用 100×80 测试图逐像素核对蒙版：允许区域 alpha 为 0，其余区域 alpha 为 255。

浏览器还覆盖了：首次缺旧位拦截；原位置标记与拖动钉重叠；按钮不遮图；重复点击；任务中刷新；二次移动；靠边移动；模拟上游失败后人工重试；缺原文与缺原图拦截。

Apify 测试首次完整执行时被验收环境的 `.env` 读取拦截器阻止。后续用精确测试名排除这一项，没有修改其代码或放开真实配置文件读取。

## 本地证据与复跑

- 浏览器检查脚本：`tests/browser-taobao-text-move.mjs`。
- 最终浏览器报告：`tests/results/taobao-text-move/report.json`。
- 修复后截图：`tests/results/taobao-text-move/01-before-edit.png`、`02-after-mock-edit.png`。
- 实际发往模拟上游的蒙版：`tests/results/taobao-text-move/last-mask.png`。
- 原始缺旧位复现：`runs/pr7-no-output-20261112/baseline-browser.json`。
- 测试日志：`runs/pr7-no-output-20261112/all-tests.log`、`taobao-tests.log`、`browser-tests.log`。
- 本次无出图保护模块：`runs/pr7-no-output-20261112/guard.mjs`；阻止读取 `.env`、外网连接及 4185，并限制测试写入本项目。
- 当前 4173 使用 `runs/pr7-no-output-20261112/preview.mjs`，不执行普通入口的 `.env` 加载，使用独立的验收数据目录。该入口和保护模块是本机验收材料，在 Git 忽略目录内。

在项目目录内可复跑：

```powershell
$qaTmp = Join-Path (Get-Location) 'runs\pr7-no-output-20261112\tmp'
$env:TEMP = $qaTmp
$env:TMP = $qaTmp
node --import ./runs/pr7-no-output-20261112/guard.mjs --test --test-skip-pattern='Apify uses bearer auth, enforces per-run caps and paginates without URL secrets' tests/*.test.mjs
node tools/check-source.mjs
```

浏览器脚本使用已有 Playwright 和 Edge，不安装新依赖。本机可通过 `PLAYWRIGHT_MODULE_URL=file:///C:/Users/Xiao/.codex/skills/video-batch-download/node_modules/playwright/index.mjs` 指定已有模块，然后执行 `node --import ./runs/pr7-no-output-20261112/guard.mjs tests/browser-taobao-text-move.mjs`。

## 下一关与剩余限制

仍需用户明确授权后，选一张真实图进行耗额度编辑，并逐项比较旧字清除、新字位置、字句一致性、蒙版外像素及商品外观。本次模拟验证不能证明这些效果。

固定 56%×18% 方框并不自动适配长句、多行、旋转文字；原文来自构思/文案字段，并非 OCR。操作前必须核对页面显示的原文、原字中心和方框能否覆盖完整文字。不得把提示词中的“保持原样”当作模型已经做到的证据。

合并门禁继续有效：只有用户明确说“合”才允许合并。
