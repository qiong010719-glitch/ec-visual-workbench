(function () {
        const TOUR_FLAG = 'aplus_newbie_tour_v1';

        function buildSteps() {
            return [
                {
                    popover: {
                        title: '👋 欢迎使用 A-Plus 视觉生图引擎',
                        description:
                            '<p>整套流程：</p>' +
                            '<p style="margin-top:0.6rem;">' +
                            '①&nbsp;选模式（快速 / 大师；极速只用于铺货）<br>' +
                            '②&nbsp;填产品信息 + 选输出范围<br>' +
                            '③&nbsp;上传 1–8 张参考图<br>' +
                            '④&nbsp;<code>一键构思</code>（出策略 → 等待）<br>' +
                            '⑤&nbsp;<code>开始生成</code>（真正出图）' +
                            '</p>' +
                            '<p style="margin-top:0.6rem;background:rgba(0,255,197,0.1);padding:0.45rem 0.6rem;border-radius:0.4rem;border-left:1px solid var(--zonai-teal);font-size:0.85rem;">⚡ <strong>极速狂飙模式</strong>跳过 ⑤，一键构思就直接出图。</p>' +
                            '<p style="margin-top:0.7rem;color:#aaa;font-size:0.85rem;">下面我把<strong>每个关键位置</strong>都给你点一遍 ↘️</p>'
                    }
                },
                {
                    element: '#modeSelectorUI',
                    popover: {
                        title: '🎮 第 1 步：选生成模式',
                        description:
                            '<p>三种模式速度和精度差异很大：</p>' +
                            '<p style="margin-top:0.5rem;">' +
                            '⚡&nbsp;<strong>极速飙车</strong>：2–3 分钟出图，<strong>新手首选</strong><br>' +
                            '🔥&nbsp;<strong>快速设计</strong>：5–7 分钟，更精细<br>' +
                            '👑&nbsp;<strong>大师设计</strong>：11–14 分钟，最强但最慢' +
                            '</p>',
                        side: 'right',
                        align: 'start'
                    }
                },
                {
                    element: '#tip-info-icon',
                    popover: {
                        title: '💡 重点：黄色「?」图标里有填写技巧！',
                        description:
                            '<p>这个会跳动的 <strong style="color:#FFD700;">黄色问号图标</strong>很容易被忽略——<strong>悬停上去</strong>会展开 AI 生成的"避坑指南"：</p>' +
                            '<p style="margin-top:0.5rem;">• 卖点要简洁<br>• 有参数请写参数<br>• 冷门产品要写应用场景</p>' +
                            '<p style="margin-top:0.6rem;color:#aaa;font-size:0.85rem;">看完照着填，AI 出图准确率直接翻倍。</p>',
                        side: 'right',
                        align: 'start'
                    }
                },
                {
                    element: '#prodName',
                    popover: {
                        title: '✏️ 第 2 步：填产品信息',
                        description:
                            '<p>这里填两件事：</p>' +
                            '<p style="margin-top:0.4rem;">' +
                            '<strong>产品名称</strong>：含物理特征（材质、形状）<br>' +
                            '<strong>核心卖点</strong>：精简，别一大段，给 AI 关键词级别的输入' +
                            '</p>' +
                            '<p style="margin-top:0.5rem;">下方还有 <strong style="color:#ff7777;">⚠️ 强制要求</strong>：写"必须白底""禁止人物"这种硬约束，模型会优先执行。</p>',
                        side: 'right',
                        align: 'start'
                    }
                },
                {
                    element: '#tip-image-icon',
                    popover: {
                        title: '💡 重点：图片说明图标也很重要！',
                        description:
                            '<p>这个 <strong style="color:#FFD700;">黄色 ?</strong> 里讲清楚了图片该怎么传：</p>' +
                            '<p style="margin-top:0.5rem;">• 别只传 1 张，AI 不会凭空脑补细节<br>• 主体图减少背景干扰，细节要清楚<br>• 按分类区域上传效果更好<br>• 信息混乱的图会让 AI 翻车</p>' +
                            '<p style="margin-top:0.6rem;color:#aaa;font-size:0.85rem;"><strong>悬停</strong>上去看完整说明 ⬆️</p>',
                        side: 'left',
                        align: 'start'
                    }
                },
                {
                    element: '#dropZoneContainer',
                    popover: {
                        title: '🖼️ 第 3 步：上传参考图',
                        description:
                            '<p>规则：</p>' +
                            '<p style="margin-top:0.4rem;">' +
                            '• <strong>最多 8 张</strong>，每张 <strong>≤ 400KB</strong><br>' +
                            '• 按分类拖拽进对应区域（产品主体 / 风格 / 场景…）<br>' +
                            '• 必须有至少 <strong>1 张产品主体图</strong>，否则不能生成' +
                            '</p>',
                        side: 'left',
                        align: 'start'
                    }
                },
                {
                    element: '#designScope',
                    popover: {
                        title: '🎯 第 4 步：选输出范围',
                        description:
                            '<p>决定生成什么：</p>' +
                            '<p style="margin-top:0.4rem;">' +
                            '• <strong>主图 7 张</strong>：最常用<br>' +
                            '• <strong>主图 + 老/高级 A+</strong>：完整页面方案<br>' +
                            '• <strong>纯 A+</strong>：只补 A+<br>' +
                            '• <strong>THD 7 张</strong>：无字无人物（合规向）' +
                            '</p>',
                        side: 'right',
                        align: 'start'
                    }
                },
                {
                    element: '#agentBtn',
                    popover: {
                        title: window.WorkbenchPlatform==='temu'?'🧠 可选：先构思并调整方案':'🧠 第 5 步：一键构思（出策略，不出图）',
                        description: window.WorkbenchPlatform==='temu'?'<p>通常直接点击下方“开始生成”即可。需要先审阅时，可在这里仅生成方案，再到“查看并修改本套设计方案”中编辑，点击“按当前方案生成”。</p>':
                            '<p>填好上面内容后点这个，AI 会先去<strong>"想策略"</strong>：</p>' +
                            '<p style="margin-top:0.5rem;">点完会弹出<strong style="color:#FFD700;">等待界面</strong>（光晕在转），AI 生成视觉策略大纲。</p>' +
                            '<p style="margin-top:0.5rem;">⏳ <strong>快速</strong>：1–2 分钟<br>👑 <strong>大师</strong>：3–5 分钟</p>' +
                            '<p style="margin-top:0.5rem;color:#aaa;font-size:0.85rem;">这一步只产出文字策略，<strong>暂时不会出图</strong>。</p>' +
                            '<p style="margin-top:0.6rem;background:rgba(0,255,197,0.1);padding:0.5rem 0.7rem;border-radius:0.4rem;border-left:1px solid var(--zonai-teal);">⚡ <strong>极速狂飙模式没有这一步</strong>——点一下就直接出图，不需要再操作下面的「开始生成」按钮。</p>',
                        side: 'top',
                        align: 'start'
                    }
                },
                {
                    element: '#mainBtn',
                    popover: {
                        title: window.WorkbenchPlatform==='temu'?'🎨 开始生成：自动构思并出图':'🎨 第 6 步：开始生成（真正出图）',
                        description: window.WorkbenchPlatform==='temu'?'<p>填写商品资料并上传主体图，选好模式、模型与张数后，点击一次即可自动构思并生成整套图片。构思失败会停止。</p><p>将使用文本与图片服务额度；刷新页面可继续查看同一任务，不重复生成。</p>':
                            '<p>构思完成后，这个按钮会从 <span style="color:#666;">灰色禁用</span> 变成 <strong style="color:#FFD700;">金色脉动可点</strong>。</p>' +
                            '<p style="margin-top:0.5rem;">点它才会真正<strong>派发生图任务</strong>，输出最终图片。</p>' +
                            '<p style="margin-top:0.5rem;color:#aaa;font-size:0.85rem;">出图后在下方画廊查看，每张图都可单独 <strong>重绘 / 编辑</strong>。</p>' +
                            '<p style="margin-top:0.6rem;background:rgba(0,255,197,0.1);padding:0.5rem 0.7rem;border-radius:0.4rem;border-left:1px solid var(--zonai-teal);">⚡ <strong>极速狂飙模式</strong>不需要这个按钮——上一步已经直接出图了。</p>' +
                            '<p style="margin-top:0.7rem;color:#FFD700;font-weight:bold;">📘 之后随时可点右上角「新手引导」再看一遍。</p>',
                        side: 'top',
                        align: 'start'
                    }
                }
            ];
        }

        // ===== 结果页引导（出图后教用户怎么操作每张图）=====
        const RESULT_TOUR_FLAG = 'hyrule_result_tour_done';

        function buildResultSteps() {
            const isUltra = !document.getElementById('view-ultra-log').classList.contains('hidden');
            const firstSlot = document.querySelector('[id^="slot-"]');
            const steps = [
                {
                    popover: {
                        title: '🎉 出图了！这一页怎么用',
                        description:
                            '<p>这里是<strong>图片结果页</strong>。每张图都可以单独调整，不满意的那张单独处理就行，<strong>不用整批重来</strong>。</p>' +
                            '<p style="margin-top:0.6rem;background:rgba(255,214,10,0.12);padding:0.55rem 0.75rem;border-radius:0.45rem;border-left:1px solid #FFD60A;">⚠️ 因为最近默认通道出现问题，暂时还没有办法解决。<strong style="color:#FFD60A;">生成失败不会扣除任何 token 和积分</strong>，看到失败的图直接重试即可，耐心刷几次通常就能出来。</p>'
                    }
                }
            ];
            if (firstSlot) {
                steps.push({
                    element: '#' + firstSlot.id,
                    popover: {
                        title: '🖼️ 每张图上的按钮（鼠标移上去出现）',
                        description:
                            '<p>把鼠标放到图片上，下面会出现一排操作：</p>' +
                            '<p style="margin-top:0.5rem;">' +
                            '• <strong>EDIT</strong>：改这张图的提示词文字，然后重画<br>' +
                            '• <strong>INPAINT</strong>：在图上圈一块 + 写文字，只修那一小块；弹窗里还有「🔄 送入编辑模式」按钮，产品画错时把图带过去换产品保风格<br>' +
                            '• <strong>REDRAW</strong>：提示词不变，直接重抽一张<br>' +
                            '• <strong>下载</strong>：单独存这一张<br>' +
                            '</p>' +
                            '<p style="margin-top:0.5rem;color:#aaa;font-size:0.85rem;">生成失败的图会显示 <strong>RETRY</strong>，点它重试即可（不扣积分）。</p>',
                        side: 'left',
                        align: 'start'
                    }
                });

            }
            steps.push({
                element: isUltra ? '#ultraBatchBtnContainer' : '#batchBtnContainer',
                popover: {
                    title: '📦 打包下载全部成品',
                    description:
                        '<p>一次性把这批图<strong>打包成 zip 下载</strong>。</p>' +
                        '<p style="margin-top:0.5rem;color:#aaa;font-size:0.85rem;">个别图拉取失败会自动跳过，其余照常打包，不会整包失败。</p>',
                    side: 'right',
                    align: 'start'
                }
            });

            return steps;
        }

        window.startResultTour = function () {
            const ctor = getDriverCtor();
            if (!ctor) { console.warn('driver.js 未加载'); return; }
            const inst = ctor({
                showProgress: true, allowClose: true, overlayOpacity: 0.78,
                smoothScroll: true, stagePadding: 6, stageRadius: 14,
                popoverClass: 'hyrule-tour',
                progressText: '第 {{current}} 步 / 共 {{total}} 步',
                nextBtnText: '下一步 →', prevBtnText: '← 上一步', doneBtnText: '知道了 🎉',
                onDestroyed: function () {
                    try { localStorage.setItem(RESULT_TOUR_FLAG, 'true'); } catch (e) {}
                },
                steps: buildResultSteps()
            });
            inst.drive();
        };

        // 首次出图时自动触发一次结果页引导
        window.maybeStartResultTour = function () {
            try { if (localStorage.getItem(RESULT_TOUR_FLAG) === 'true') return false; } catch (e) { return false; }
            if (!document.querySelector('[id^="slot-"] img')) return false;   // 得真有图了
            const advVisible = !document.getElementById('view-adventure-log').classList.contains('hidden');
            const ultraVisible = !document.getElementById('view-ultra-log').classList.contains('hidden');
            if (!advVisible && !ultraVisible) return false;
            setTimeout(function () { window.startResultTour(); }, 1200);
            return true;   // 告诉调用方：结果页引导已经安排
        };

        function getDriverCtor() {
            if (typeof window === 'undefined') return null;
            if (window.driver && typeof window.driver.js?.driver === 'function') return window.driver.js.driver;
            if (typeof window.driver === 'function') return window.driver;
            return null;
        }

        function setAttractMode(on) {
            const btn = document.getElementById('newbieTourBtn');
            const tip = document.getElementById('newbieTourTip');
            if (btn) btn.classList.toggle('tour-attract', !!on);
            if (tip) tip.classList.toggle('hidden', !on);
        }

        window.startNewbieTour = function () {
            const ctor = getDriverCtor();
            if (!ctor) { console.warn('driver.js 未加载，无法启动新手引导'); return; }
            const inst = ctor({
                showProgress: true,
                allowClose: true,
                overlayOpacity: 0.78,
                smoothScroll: true,
                stagePadding: 6,
                stageRadius: 14,
                popoverClass: 'hyrule-tour',
                progressText: '第 {{current}} 步 / 共 {{total}} 步',
                nextBtnText: '下一步 →',
                prevBtnText: '← 上一步',
                doneBtnText: '完成 🎉',
                onDestroyed: function () {
                    try { localStorage.setItem(TOUR_FLAG, 'true'); } catch (e) {}
                    setAttractMode(false);
                },
                steps: buildSteps()
            });
            inst.drive();
        };

        // An automatic tour must not interrupt someone already filling the form.
        // The explicit guide button remains available for this session.
        let hasStartedWorking = false;
        for (const event of ['pointerdown', 'keydown', 'input']) {
            document.addEventListener(event, () => { hasStartedWorking = true; }, {capture:true, once:true});
        }

        function isReadyForTour() {
            if (document.querySelector('.fe-overlay.show, .rc-overlay.show, dialog[open]')) return false;
            // 1. 必须已登录（authOverlay 隐藏 + localStorage 标记）
            try {
                if (localStorage.getItem('hyrule_terminal_auth') !== 'GRANTED') return false;
            } catch (e) { return false; }
            const auth = document.getElementById('authOverlay');
            if (auth) {
                const cs = getComputedStyle(auth);
                if (cs.display !== 'none' && parseFloat(cs.opacity) > 0.05) return false;
            }
            // 2. 公告弹窗已关闭
            const announce = document.getElementById('announceModal');
            if (announce && announce.classList.contains('show')) return false;
            // 3. 登录后弹出的模式选择弹窗已关闭
            const modeSel = document.getElementById('modeSelectionModal');
            if (modeSel) {
                const cs = getComputedStyle(modeSel);
                if (cs.display !== 'none') return false;
            }
            // 4. 主仪表盘可见
            const dash = document.getElementById('view-dashboard');
            if (!dash || dash.classList.contains('hidden')) return false;
            if (dash.offsetParent === null) return false;
            const anchor = document.getElementById('modeSelectorUI');
            if (!anchor || anchor.offsetParent === null) return false;
            return true;
        }

        window.addEventListener('load', function () {
            // 第一次使用：让按钮发光 + 显示「第一次使用必读 👉」标签
            try {
                if (localStorage.getItem(TOUR_FLAG) !== 'true') {
                    setAttractMode(true);
                } else {
                    setAttractMode(false);
                }
            } catch (e) {}

            let tries = 0;
            const timer = setInterval(function () {
                tries++;
                if (tries > 600) { clearInterval(timer); return; }
                try {
                    if (localStorage.getItem(TOUR_FLAG) === 'true') { clearInterval(timer); setAttractMode(false); return; }
                    if (hasStartedWorking) { clearInterval(timer); return; }
                    if (!isReadyForTour()) return;
                    clearInterval(timer);
                    setTimeout(function () { if (!hasStartedWorking && isReadyForTour()) window.startNewbieTour(); }, 600);
                } catch (e) {}
            }, 500);
        });
    })();
