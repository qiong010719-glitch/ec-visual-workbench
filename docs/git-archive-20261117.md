# Temu 采集开发前的 Git 存档

存档日期：2026-11-17（北京时间）。

此版本保存已有的商品做图、裂变、桌面端与店小秘上架流程，以及尚未提交的源码、文档和测试。Temu 前端关键词采集尚未跑通，此存档不包含已实现的采集模块。

## 版本位置

- 仓库：`https://github.com/qiong010719-glitch/ec-visual-workbench`
- 分支：`codex/temu-image-workflow`
- 固定回撤标签：`archive/temu-before-collection-20261117`

标签固定本次存档，后续开发继续提交到分支。无需覆盖或强制推送主分支。

## 存档范围

仓库根目录保留工作台源码的现有结构。工作台还依赖上级目录的 `scripts/`，桌面打包也会从该目录读取 ERP 执行器。本次将这些配套文件的原样副本保存到 `workspace-support/auto-listing/`：

- `scripts/`：上架执行器、连接库、图片和表格辅助脚本、核验脚本。
- `start-listing-workbench.ps1`、两个工作台启动文件。
- 原外层 `README.md` 和 `.gitignore`。
- `manifest.json`：上述 25 个文件的 SHA-256 和字节数。

配套文件是存档副本；正在运行的工作台仍使用原上级目录，不因存档改变执行路径。

`.env`、密钥、浏览器用户目录、商品运行数据、生成素材、依赖和安装包不包含在此次源码存档中。外层 `config/` 为本机店铺配置，也不上传。淘宝工作台和商业网站不是此次 Temu 源码存档的范围。

## 恢复到独立目录

1. 选择一个新的空目录，将仓库克隆到其中的 `ec-visual-workbench/`，检出标签 `archive/temu-before-collection-20261117`。
2. 将 `workspace-support/auto-listing/` 中除 `manifest.json` 外的文件和目录复制到新目录的上层，恢复以下布局：

```text
新的空目录/
  ec-visual-workbench/
  scripts/
  start-listing-workbench.ps1
  启动本地工作台.cmd
  启动上架工作台.cmd
```

3. 用 `manifest.json` 核对配套文件哈希。依照 `docs/merchant-workbench.md` 安装锁定版本的依赖，并单独恢复所需的本机配置。不要覆盖正在使用的浏览器目录或任务数据。
4. 此存档证明源码已保存，不代表所有历史功能重新通过真实店铺验收。恢复后先在独立数据目录核验；历史 ERP 核验脚本可能指向真实商品，不要为了检查备份而直接运行。

原机器另有完整的本地历史与文件备份：`../outputs/temu-front-collection-20261117/baseline/`。该目录不上传 GitHub。
