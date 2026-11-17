import fs from 'node:fs';
import path from 'node:path';

// Copy only a built, audited runtime. Merchant data is always created from empty.
const source=path.resolve(process.argv[2]||'dist/fresh-user-20261112/win-unpacked');
const target=path.resolve(process.argv[3]||'../新用户测试-20261112');
if(fs.existsSync(target))throw new Error('目标目录已存在，不能覆盖已有测试数据：'+target);
if(!fs.existsSync(path.join(source,'商品裂变工作台.exe')))throw new Error('请先构建桌面程序');
fs.mkdirSync(target,{recursive:true});
fs.cpSync(source,path.join(target,'程序'),{recursive:true,errorOnExist:true,force:false});
fs.mkdirSync(path.join(target,'用户数据'));
fs.mkdirSync(path.join(target,'验收素材'));
const ps1=`$ErrorActionPreference = 'Stop'
try {
  $testRoot = $PSScriptRoot
  $exe = Join-Path $testRoot '程序\\商品裂变工作台.exe'
  if (!(Test-Path -LiteralPath $exe)) { throw '找不到测试程序，请保留整个测试文件夹。' }
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $exe
  $startInfo.WorkingDirectory = $testRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $allowed = '^(systemroot|windir|comspec|pathext|systemdrive|userprofile|appdata|localappdata|temp|tmp|programfiles|programfiles\\(x86\\)|programw6432|programdata|allusersprofile|public|username|userdomain|homedrive|homepath|os|number_of_processors|processor_architecture)$'
  $startInfo.EnvironmentVariables.Clear()
  foreach ($entry in [Environment]::GetEnvironmentVariables().GetEnumerator()) {
    if ($entry.Key -match $allowed) { $startInfo.EnvironmentVariables[$entry.Key] = [string]$entry.Value }
  }
  $win = [Environment]::GetFolderPath('Windows')
  $startInfo.EnvironmentVariables['PATH'] = (Join-Path $win 'System32') + ';' + $win + ';' + (Join-Path $win 'System32\\WindowsPowerShell\\v1.0')
  $startInfo.EnvironmentVariables['WORKBENCH_DESKTOP_DATA'] = Join-Path $testRoot '用户数据'
  $startInfo.EnvironmentVariables['WORKBENCH_DESKTOP_PORT'] = '4191'
  [System.Diagnostics.Process]::Start($startInfo) | Out-Null
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '全新用户测试启动失败') | Out-Null
  exit 1
}
`;
const vbs=`Option Explicit
Dim files, shell, root, command
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = files.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & files.BuildPath(root, "启动测试.ps1") & Chr(34)
shell.Run command, 0, False
`;
fs.writeFileSync(path.join(target,'启动测试.ps1'),'\ufeff'+ps1,'utf8');
fs.writeFileSync(path.join(target,'双击启动全新用户测试.vbs'),'\ufeff'+vbs,'utf16le');
const guide=`全新用户测试（同一台电脑，独立数据）

如何打开
双击“双击启动全新用户测试.vbs”。窗口标题是“全新用户测试 · Temu 工作台”。
请从这个入口启动，直接打开“程序”中的 EXE 不会带上本次隔离设置。
关闭后仍使用同一个入口；刚填写的测试数据会保留，不会每次清空。

第一次应该看到什么
没有店铺、母稿、ERP 连接、浏览器配置、模型密钥或历史任务。
模型名称和 API 地址等产品默认值仍会显示，代表可选配置，不是已登录。
原有工作台及其数据未复制进本目录，也不会在这里自动导入。

从这里开始，逐项验证
1. 打开“连接设置”，确认没有旧店铺、旧连接和已配置密钥。
2. 添加“Chrome 专用窗口”，命名“新用户测试浏览器”，端口填 9333。
   不选原来的比特窗口。若端口占用，请使用其他空闲端口。
3. 新建 ERP 连接，选择这个新浏览器，打开店小秘登录，手动登录。
   不开启 Chrome 账号同步，不导入旧浏览器数据。
4. 新增店铺，填写实际店铺、站点，粘贴该店铺母稿链接，校验并保存。
5. 返回“店铺上架”，确认新店铺和母稿出现在下拉框。
6. 有意开始生成测试时，再手动配置自己的模型密钥。
   用一件商品、一套图片开始，执行方式先选“仅保存草稿”。
7. 检查保存结果；退出重开，验证设置和进度仍在。

重要边界
店小秘账号里的店铺、母稿是云端数据。登录同一个账号后仍能看见它们。
要测试完全没有云端历史的账号，需要另一个测试账号或测试店铺。
本目录的隔离范围是软件数据和专用浏览器，不是整个 Windows 系统。
电脑已安装的 Chrome、系统组件、网络和硬件仍然存在。
这轮跑通后，还需在 Windows 沙盒、虚拟机或实际新电脑上测试依赖与安装。
本次没有执行收费生图、登录远程账号或发布商品。

文件夹用途
程序：独立桌面运行程序；无需使用本机 Node、Python 或 Codex 来启动。
用户数据：仅本次测试的配置、任务、密钥、页面缓存和专用浏览器记录。
验收素材：空文件夹，可放本次测试的一件商品素材。
将来重新从零测试，请另建空白测试档案；不要删除原工作台的数据。
测试版为未签名内部验收包。
`;
fs.writeFileSync(path.join(target,'先看这里-新用户测试说明.txt'),'\ufeff'+guide,'utf8');
console.log(JSON.stringify({folder:target,launcher:path.join(target,'双击启动全新用户测试.vbs'),data:path.join(target,'用户数据'),port:4191}));
