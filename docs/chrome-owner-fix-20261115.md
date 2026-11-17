# Chrome 绑定检查超时修复

截图中的 `Command failed: powershell.exe ... Get-NetTCPConnection` 已在本机复现：旧连接检查在 15,345 ms 被 `SIGTERM` 终止，标准错误为空。单独测量中，端口枚举花费 13,646 ms，Chrome 进程查询再花费 3,159 ms，超过同一个 15 秒限时。失败发生于创建执行会话之前，受影响批次 `d322829b-8ac0-4e66-8976-7824db625b03` 的事件为空、没有草稿 ID。

修复使用系统 `netstat.exe` 枚举 TCP 监听者，再一次性查询精确 PID 的 Chrome 名称和数据目录。只接受本机回环地址、正确端口、正确 Chrome 数据目录；错误配置、缺失进程信息和不确定结果仍拒绝连接。端口枚举和进程查询分别设定有限超时，异常显示可读提示，不把命令行或路径输出给用户。旧历史记录只调整展示文字，原始错误和执行状态保持不变；长提示不会撑宽页面。

修复后的真实 Chrome 配置核验成功，用时 11,255 ms。真实 ERP 页面检查是另一层验证：已有店小秘标签页仍发生 `Runtime.evaluate` / `Page.getFrameTree` 超时，因此不能把此连接修复当作真实商品上架成功。

验证：

- `node --test tests/chrome-owner.test.mjs tests/erp.test.mjs tests/erp-runner-stability.test.mjs tests/desktop-profile.test.mjs`：29 项通过。
- `node tests/browser-chrome-owner-error.mjs`：历史错误可读、原始证据保留、桌面与窄屏无横向溢出。
- `npm run check`：29 个页面脚本通过。
- `node tests/chrome-fresh-profile.mjs dist/chrome-owner-fix-20261115/win-unpacked/resources`：打包连接器在中文和空格路径启动全新 Chrome、连接正确配置、拒绝错误配置。

上述隔离测试未付费生图，未保存或发布真实商品。截图中的“宠物滑板”使用“油画1 / 海报和印刷品”母稿，上架前需选择对应商品类目的母稿，不能沿用这份油画母稿直接重试。

交付版本为 `dist/chrome-owner-fix-20261115-ready/win-unpacked/商品裂变工作台.exe`。请保留整个 `win-unpacked` 目录，退出旧工作台后从此文件启动。当前运行中的旧工作台没有被替换。

最终包核对通过：119 个应用文件、13 个连接器文件与源码一致，未打入开发数据或凭据。上述目录版本的隔离桌面测试通过全部 10 项检查，包括首次启动、配置加密、关闭重启后恢复配置及三个工作台页面渲染。同目录的单文件便携包首次启动通过，但自动关闭重启测试等待就绪信号超时，因此本次提供已完成全部检查的目录版本作为启动入口，不把单文件包重启报告为通过。
