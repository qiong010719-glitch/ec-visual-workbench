# 恢复最新跨境工作台

本说明适用于当前维护分支 `codex/chrome-window-settings-20261119`。该分支包含统一跨境界面及后续采集、认领、分类和批量流程改动；具体支持范围见 [当前流程说明](category-search-and-batch-20261127.md)。2026-11-17 历史标签的恢复说明保留在 [Git 存档说明](git-archive-20261117.md)。

## 1. 克隆到新的空目录

准备 Node.js 22 或更新版本、Git，以及浏览器验收使用的 Microsoft Edge。在 Windows PowerShell 中选择一个新的空父目录，例如：

```powershell
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path 'D:\workbench-latest'
Set-Location -LiteralPath 'D:\workbench-latest'
git clone --branch codex/chrome-window-settings-20261119 --single-branch https://github.com/qiong010719-glitch/ec-visual-workbench.git ec-visual-workbench
Set-Location -LiteralPath '.\ec-visual-workbench'
```

记录 `git rev-parse HEAD` 的结果，可明确本次恢复的提交版本。已有工作区、浏览器登录目录和商品任务数据应保留在原位置。

## 2. 校验并恢复配套脚本

当前启动器、桌面构建和部分测试使用仓库上一级的 `scripts/`。最新配套文件保存在仓库内的 `workspace-support/auto-listing/`，需要先恢复到刚创建的空父目录。

在仓库根目录运行以下 PowerShell。它先校验清单中的每个文件及其完整文件集合，再复制到父目录并核对复制结果；已有同名目标会停止，避免覆盖原有文件。

```powershell
$restoreRepository = (Get-Location).Path
$restoreParent = Split-Path -Parent $restoreRepository
$supportRoot = Join-Path $restoreRepository 'workspace-support\auto-listing'
$supportManifestPath = Join-Path $supportRoot 'manifest.json'
$supportManifest = @(Get-Content -LiteralPath $supportManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json)
$supportTopLevel = @(Get-ChildItem -LiteralPath $supportRoot -Force |
    Where-Object { $_.Name -ne 'manifest.json' })
foreach ($supportItem in $supportTopLevel) {
    if (Test-Path -LiteralPath (Join-Path $restoreParent $supportItem.Name)) {
        throw "恢复目标已存在，未覆盖：$($supportItem.Name)"
    }
}
$supportActualPaths = @(Get-ChildItem -LiteralPath $supportRoot -Recurse -Force -File |
    Where-Object { $_.FullName -ne $supportManifestPath } |
    ForEach-Object { $_.FullName.Substring($supportRoot.Length + 1).Replace('\', '/') })
if (Compare-Object ($supportManifest.path | Sort-Object) ($supportActualPaths | Sort-Object)) {
    throw '配套文件集合与 manifest.json 不一致，请重新核对克隆内容。'
}
foreach ($supportEntry in $supportManifest) {
    $supportSource = Join-Path $supportRoot $supportEntry.path
    $supportDestination = Join-Path $restoreParent $supportEntry.path
    if (Test-Path -LiteralPath $supportDestination) {
        throw "目标已存在，未覆盖：$supportDestination"
    }
    if ((Get-Item -LiteralPath $supportSource).Length -ne $supportEntry.bytes -or
        (Get-FileHash -LiteralPath $supportSource -Algorithm SHA256).Hash -ne $supportEntry.sha256) {
        throw "配套文件校验失败：$($supportEntry.path)"
    }
}
$supportTopLevel | Copy-Item -Destination $restoreParent -Recurse
foreach ($supportEntry in $supportManifest) {
    $supportDestination = Join-Path $restoreParent $supportEntry.path
    if ((Get-Item -LiteralPath $supportDestination).Length -ne $supportEntry.bytes -or
        (Get-FileHash -LiteralPath $supportDestination -Algorithm SHA256).Hash -ne $supportEntry.sha256) {
        throw "恢复后校验失败：$($supportEntry.path)"
    }
}
Write-Output "配套文件恢复并校验完成：$($supportManifest.Count) 个文件。"
```

恢复后的关键目录为：

```text
workbench-latest/
  ec-visual-workbench/       当前仓库
  scripts/                   配套浏览器和 ERP 执行器
  desktop-preview-data/      首次启动后自动创建的本地数据目录
```

仓库的 `.gitattributes` 对 `workspace-support/auto-listing/**` 设置了 `-text`，Git 会保留这些文件的原始字节；即使本机启用了 `core.autocrlf`，清单的 SHA-256 仍应一致。配套清单覆盖该目录除 `manifest.json` 自身之外的全部文件，包括 `scripts/lib/chrome-existing.mjs`。

## 3. 安装、验证并启动

继续在 `ec-visual-workbench/` 中运行：

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test
npm.cmd start
```

`npm ci` 依照锁文件安装运行及开发依赖；浏览器隔离测试需要本机已安装 Microsoft Edge。验收通过后，服务入口为 `http://127.0.0.1:4196/cockpit.html`。4196 端口已被其他版本占用时，启动器会停止，请先结束原服务后再启动本次恢复版本。

桌面界面使用仓库根目录的 `启动跨境工作台.cmd` 或 `npm.cmd run desktop`；需要制作 Windows 分发包时运行 `npm.cmd run build:desktop`。父目录恢复的旧启动文件仅作为配套存档保留，日常使用上述仓库内入口。

## 4. 恢复后的设置

首次进入工作台后，按界面重新配置所需的服务连接、浏览器窗口和店铺绑定。GitHub 源码不包含本机密钥、浏览器登录、商品运行数据或生成素材。需要迁移既有数据时，单独核对来源、版本与任务状态后再处理。

源码恢复和隔离测试通过只证明代码与依赖可恢复。真实平台支持范围以当前流程说明和界面能力提示为准；历史核验脚本可能引用旧商品，不要直接运行它们来验证本次恢复。
