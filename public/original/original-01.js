// ── 模式选择 UI 同步函数 ──
        function setModeUI(mode) {
            const modeSelect = document.getElementById('generationMode');
            modeSelect.value = mode;
            document.querySelectorAll('.mode-btn').forEach(btn => {
                btn.classList.toggle('mode-active', btn.dataset.mode === mode);
            });
            const event = new CustomEvent('change', { detail: { isRestore: false } });
            modeSelect.dispatchEvent(event);
        }

        function selectModeFromModal(mode) {
            const modeSelect = document.getElementById('generationMode');
            modeSelect.value = mode;
            // 同步按钮选中态
            document.querySelectorAll('.mode-btn').forEach(btn => {
                btn.classList.toggle('mode-active', btn.dataset.mode === mode);
            });
            // 用 isRestore:true 阻止 change 监听器清空 scope 和 gallery
            const event = new CustomEvent('change', { detail: { isRestore: true } });
            modeSelect.dispatchEvent(event);
            document.getElementById('modeSelectionModal').style.display = 'none';
            document.getElementById('modeSelectionModal').classList.add('hidden');
            // 模式选完后恢复状态
            setTimeout(() => {
                loadAppState();
                checkNewbieStatus();
            }, 50);
        }

        function openSampleLightbox(src) {
            if (typeof event !== 'undefined' && event && event.stopPropagation) event.stopPropagation(); // 阻止冒泡到模式选择按钮
            const lb = document.getElementById('sampleLightbox');
            document.getElementById('sampleLightboxImg').src = src;
            lb.classList.remove('hidden');
            lb.classList.add('flex');
        }

        function closeSampleLightbox() {
            const lb = document.getElementById('sampleLightbox');
            lb.classList.add('hidden');
            lb.classList.remove('flex');
        }


        const N8N_INPAINT_WEBHOOK = "/api/inpaint";
const N8N_FEISHU_REPORT_WEBHOOK = "/api/feedback";   // 旧整页截图报告链路，经 Vercel 转发（action:report），不再暴露 n8n 地址
const OVERRIDE_PWD = ""; // Unused upstream override removed // Unused upstream override removed // Unused upstream override removed

var _supa = window.LocalWorkbench.authClient;   

async function getAuthHeader() {
  const { data: { session } } = await _supa.auth.getSession()
  if (!session) { triggerError('SESSION EXPIRED', '登录已过期，请刷新页面重新登录。'); return null }
  return { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }
}

/* ══════════════════════════════════════════════════════════════
   💰 充值（支付宝电脑网站支付，1:1 到点）
   ──────────────────────────────────────────────────────────────
   前端只负责：填金额 → 调 /api/alipay/create 拿跳转链接 → 跳支付宝。
   真正到账加点由异步回调 /api/alipay/notify 完成（验签 + 幂等）。
   ══════════════════════════════════════════════════════════════ */
const RECHARGE_PRESETS = [50, 100, 200, 500, 1000, 2000];

function openRechargeModal() {
    // 未登录/游客不能充（充值也要真实账号）
    if (localStorage.getItem('hyrule_terminal_auth') !== 'GRANTED') {
        if (typeof guardGuest === 'function' && guardGuest()) return;
    }
    const grid = document.getElementById('rechargePresets');
    grid.innerHTML = RECHARGE_PRESETS.map(v =>
        `<button onclick="pickRecharge(${v})" class="rc-preset recharge-preset" data-v="${v}">${v}</button>`).join('');
    document.getElementById('rechargeAmount').value = '';
    document.getElementById('rechargeHint').innerText = '';
    setRechargeReady(false);
    document.getElementById('rechargeModal').style.display = 'flex';
    if (typeof playZeldaSound === 'function') playZeldaSound('click');
}
function closeRechargeModal() { document.getElementById('rechargeModal').style.display = 'none'; }

function pickRecharge(v) {
    document.getElementById('rechargeAmount').value = v;
    document.querySelectorAll('.recharge-preset').forEach(b => {
        b.classList.toggle('sel', Number(b.dataset.v) === v);
    });
    onRechargeInput();
}
function onRechargeInput() {
    const v = Math.floor(Number(document.getElementById('rechargeAmount').value));
    const hint = document.getElementById('rechargeHint');
    if (!Number.isFinite(v) || v < 1) { hint.innerText = ''; setRechargeReady(false); return; }
    if (v > 5000) { hint.innerText = '单次最多充值 5000 元'; setRechargeReady(false); return; }
    hint.innerHTML = `支付 <b>¥${v}</b> → 到账 <b>${v}</b> 点`;
    setRechargeReady(true);
}
function setRechargeReady(ok) {
    document.getElementById('rechargeSubmit').disabled = !ok;
}

async function submitRecharge() {
    const v = Math.floor(Number(document.getElementById('rechargeAmount').value));
    if (!Number.isFinite(v) || v < 1 || v > 5000) return;
    const btn = document.getElementById('rechargeSubmit');
    btn.disabled = true; btn.innerText = '正在创建订单…';
    try {
        const headers = await getAuthHeader();
        if (!headers) { btn.innerText = '去支付宝支付'; return; }
        const res = await fetch('/api/alipay/create', {
            method: 'POST', headers, body: JSON.stringify({ amount: v })
        });
        const data = await res.json();
        if (!res.ok || !data.pay_url) {
            triggerError('充值失败', data.error || '创建订单失败，请重试。');
            btn.disabled = false; btn.innerText = '去支付宝支付'; return;
        }
        // 跳转支付宝收银台（付完 return_url 会把用户带回来）
        window.location.href = data.pay_url;
    } catch (e) {
        triggerError('充值失败', '网络异常，请重试。');
        btn.disabled = false; btn.innerText = '去支付宝支付';
    }
}

async function loadCredits() {
  const { data: { session } } = await _supa.auth.getSession()
  if (!session) return
  // 走 /api/orders：会自动向支付宝核对本人 pending 订单并入账，再返回最新余额（不再依赖异步 notify）
  const res = await fetch('/api/orders', {
    headers: { 'Authorization': `Bearer ${session.access_token}` }
  })
  const data = await res.json()
  const el = document.getElementById('creditDisplay')
  if (el && typeof data.balance === 'number') el.innerText = `⚡ ${data.balance} 点`
}

// 📋 查账 / 充值记录（含到账自动刷新，每 5 秒自愈对账）
let _ordersTimer = null;
function closeOrdersModal() {
  const m = document.getElementById('ordersModal'); if (m) m.style.display = 'none';
  if (_ordersTimer) { clearInterval(_ordersTimer); _ordersTimer = null; }
}
async function openOrdersModal() {
  const modal = document.getElementById('ordersModal');
  modal.style.display = 'flex';
  document.getElementById('ordersBalance').innerText = '当前余额：加载中…';
  document.getElementById('ordersList').innerHTML = '加载中…';
  await renderOrders();
  if (_ordersTimer) clearInterval(_ordersTimer);
  _ordersTimer = setInterval(function () {
    const m = document.getElementById('ordersModal');
    if (!m || m.style.display !== 'flex') { clearInterval(_ordersTimer); _ordersTimer = null; return; }
    // 没有"待支付"订单就停止轮询（无需再向支付宝核对，省资源）
    const hasPending = _ordersData && (_ordersData.orders || []).some(o => o.status === 'pending');
    if (!hasPending) { clearInterval(_ordersTimer); _ordersTimer = null; return; }
    renderOrders();
  }, 5000);
}
async function renderOrders() {
  const balEl = document.getElementById('ordersBalance');
  const listEl = document.getElementById('ordersList');
  try {
    const { data: { session } } = await _supa.auth.getSession();
    if (!session) { listEl.innerHTML = '请先登录后查看。'; return; }
    const res = await fetch('/api/orders', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
    const d = await res.json();
    if (!res.ok) { listEl.innerHTML = d.error || '加载失败'; return; }
    _ordersData = d;
    balEl.innerHTML = `<span>账号 <b>${d.email || ''}</b></span><span style="margin-left:auto;">余额</span><span class="oc-points">${d.balance}</span><span>点</span>`;
    const fmt = t => t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—';
    let html = '';
    // 💰 充值记录（点标题可折叠）
    const orders = d.orders || [];
    const rcOpen = !_ordersCollapse.recharge;
    html += `<div onclick="toggleOrdersSection('recharge')" class="oc-section${rcOpen ? ' open' : ''}"><span class="oc-caret">▶</span>充值记录 (${orders.length})</div>`;
    if (rcOpen) {
      if (!orders.length) {
        html += '<div class="oc-empty">暂无充值记录</div>';
      } else {
        const chip = o => o.status === 'paid'
          ? '<span class="oc-badge paid">已到账</span>'
          : o.status === 'expired'
          ? '<span class="oc-badge expired">未支付 / 已关闭</span>'
          : '<span class="oc-badge pending">待支付</span>';
        html += '<table class="oc-table"><tr><th>下单时间</th><th>金额</th><th>点数</th><th>状态</th><th>到账时间</th></tr>';
        for (const o of orders) {
          html += `<tr class="oc-row${o.status === 'expired' ? ' dim' : ''}">`
            + `<td>${fmt(o.created_at)}</td>`
            + `<td style="color:#fff;">¥${o.yuan}</td>`
            + `<td style="font-weight:700;">${o.credits}</td>`
            + `<td>${chip(o)}</td>`
            + `<td style="color:var(--text-2);">${fmt(o.paid_at)}</td></tr>`
            + `<tr><td colspan="5" class="oc-id">订单号 ${o.out_trade_no}${o.trade_no ? ' ｜ 流水 ' + o.trade_no : ''}</td></tr>`;
        }
        html += '</table>';
      }
    }
    // 🎁 赠送记录（点标题可折叠）
    const gifts = d.gifts || [];
    if (gifts.length) {
      const gOpen = !_ordersCollapse.gifts;
      html += `<div onclick="toggleOrdersSection('gifts')" class="oc-section${gOpen ? ' open' : ''}"><span class="oc-caret">▶</span>赠送记录 (${gifts.length})</div>`;
      if (gOpen) {
        html += '<table class="oc-table"><tr><th>时间</th><th>点数变动</th></tr>';
        for (const g of gifts) {
          const dv = g.delta >= 0 ? `<span style="color:#30D158;">+${g.delta}</span>` : `<span style="color:#FF6B61;">${g.delta}</span>`;
          html += `<tr class="oc-row"><td>${fmt(g.created_at)}</td><td style="font-weight:700;">${dv} 点</td></tr>`;
        }
        html += '</table>';
      }
    }
    listEl.innerHTML = html;
  } catch (e) {
    listEl.innerHTML = '加载出错：' + (e.message || e);
  }
}
// 折叠状态 + 缓存数据（供折叠再渲染 / 导出用）
let _ordersData = null;
let _ordersCollapse = { recharge: false, gifts: false };
function toggleOrdersSection(key) {
  _ordersCollapse[key] = !_ordersCollapse[key];
  if (_ordersData) { renderOrders(); }
}
function exportOrdersCSV() {
  const d = _ordersData;
  if (!d) { alert('还没有可导出的记录'); return; }
  const fmt = t => t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '';
  const rows = [['类型', '时间', '金额(元)', '点数', '状态', '到账时间', '订单号', '支付宝流水号']];
  for (const o of (d.orders || [])) {
    const st = o.status === 'paid' ? '已到账' : o.status === 'expired' ? '未支付/已关闭' : '待支付';
    rows.push(['充值', fmt(o.created_at), o.yuan, o.credits, st, fmt(o.paid_at), o.out_trade_no, o.trade_no || '']);
  }
  for (const g of (d.gifts || [])) {
    rows.push(['赠送', fmt(g.created_at), '', g.delta, '已入账', fmt(g.created_at), g.request_id || '', '']);
  }
  const csv = '﻿' + rows.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `充值记录_${(d.email || 'account').replace(/[^\w.-]/g, '_')}_${Date.now()}.csv`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 500);
}

        const firebaseConfig = {}; // Local adapter only
        // 2026-10-21：Firebase 连不上（国内网络）也不能让整页脚本崩溃——否则刷新后素材/结果全恢复不出来
        let db;
        try { firebase.initializeApp(firebaseConfig); db = firebase.database(); }
        catch (e) {
            console.error('[firebase] 初始化失败，进入离线模式（刷新恢复照常，实时进度不可用）', e);
            const _nref = { on() {}, off() {}, once: () => Promise.resolve({ val: () => null }), set: () => Promise.resolve(), update: () => Promise.resolve(), remove: () => Promise.resolve(), child() { return _nref; } };
            db = { ref: () => _nref };
        }

        // 🇨🇳 国内加速通道（2026-10-21）：结果图原本在 KIE 图床 / Firebase Storage（谷歌），国内加载极慢、上传直接失败。
        //   显示：经加速节点代拉 + 缩成预览（cnImg），加载失败自动回退原链接；上传：先传加速节点（cnUpload），失败再走 Firebase。
        //   存进状态/发给后端的仍是原链接，只换显示层。
        const CN_HUB = '/api/media';
        const CN_UP_KEY = '';
        const CN_IMG_HOSTS = /^https:\/\/([a-z0-9.-]+\.)?(redpandaai\.co|aiquickdraw\.com|firebasestorage\.googleapis\.com|firebasestorage\.app|storage\.googleapis\.com|googleusercontent\.com|kie\.ai)\//i;
        function cnImg(url, w) {
            if (!url || typeof url !== 'string' || !CN_IMG_HOSTS.test(url)) return url;
            return CN_HUB + '/img?w=' + (w || 0) + '&url=' + encodeURIComponent(url);
        }
        function cnBig(src) { return (typeof src === 'string' && src.startsWith(CN_HUB + '/img?')) ? src.replace(/w=\d+/, 'w=2400') : src; }
        function cnFallback(img) { const o = img.dataset.o; if (o && !img.dataset.f && img.src !== o) { img.dataset.f = '1'; img.src = o; return true; } return false; }
        function cnUpload(blob, onProgress, stallMs = 30000, totalMs = 180000) {
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest(); const t0 = Date.now(); let last = Date.now();
                const iv = setInterval(() => {
                    if (Date.now() - last > stallMs) { clearInterval(iv); xhr.abort(); reject(new Error('网络连不上加速节点（' + Math.round(stallMs / 1000) + ' 秒无进度）')); }
                    else if (Date.now() - t0 > totalMs) { clearInterval(iv); xhr.abort(); reject(new Error('上传太慢（超过 ' + Math.round(totalMs / 60000) + ' 分钟）')); }
                }, 2000);
                xhr.open('POST', CN_HUB + '/up?k=' + CN_UP_KEY);   // 口令放 URL：自定义请求头过不了跨域预检
                xhr.upload.onprogress = ev => { last = Date.now(); if (onProgress && ev.lengthComputable) onProgress(Math.floor(ev.loaded / ev.total * 100)); };
                xhr.onload = () => { clearInterval(iv); try { const j = JSON.parse(xhr.responseText); if (xhr.status === 200 && j.ok && j.url) resolve(j.url); else reject(new Error(j.error || ('HTTP ' + xhr.status))); } catch (e) { reject(new Error('HTTP ' + xhr.status)); } };
                xhr.onerror = () => { clearInterval(iv); reject(new Error('网络错误')); };
                xhr.send(blob);
            });
        }
        // ====== 新增：将本地图片上传到 Firebase 并返回 URL 的辅助函数 ======
async function uploadImageToFirebase(dataUrl, filename) {
    try {
        // 兼容传入裸 base64（存档降级后可能没有 data: 前缀）
        if (dataUrl && !String(dataUrl).startsWith('data:')) dataUrl = 'data:image/jpeg;base64,' + dataUrl;
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        // 2026-10-21：先传加速节点（国内可达），失败再走 Firebase Storage
        try { return await cnUpload(blob); } catch (e) { console.warn('[素材上传] 加速节点失败，改走 Firebase', e && e.message); }
        const storageRef = firebase.storage().ref();
        // 统一存放到 hyrule_materials 目录下，加上时间戳防重名
        const fileRef = storageRef.child(`hyrule_materials/${Date.now()}_${filename}.jpg`);
        await fileRef.put(blob);
        return await fileRef.getDownloadURL();
    } catch (error) {
        console.error("图片上传 Firebase 失败:", error);
        throw error;
    }
}

        let synth = null;
        try { if (typeof Tone !== 'undefined') { synth = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'sine' }, envelope: { attack: 0.005, decay: 0.12, sustain: 0, release: 0.18 }, volume: -16 }).toDestination(); } } catch(e) { console.warn("声音引擎离线"); }

        // Aqua Glass：克制的系统提示音（保留原函数名，低音量、极短、不打扰）
        const playZeldaSound = (type) => {
            try {
                if (!synth || typeof Tone === 'undefined') return;
                Tone.start(); const now = Tone.now();
                if (type === 'victory') { synth.triggerAttackRelease("C5", "16n", now); synth.triggerAttackRelease("G5", "8n", now + 0.12); }
                else if (type === 'click') { synth.triggerAttackRelease("E5", "32n", now); }
                else if (type === 'error') { synth.triggerAttackRelease("G3", "16n", now); synth.triggerAttackRelease("D3", "8n", now + 0.1); }
                else if (type === 'slash') { synth.triggerAttackRelease("A4", "32n", now); synth.triggerAttackRelease("E5", "32n", now + 0.05); }
            } catch(e) {}
        };

        // 错误标题人话化：调用处仍传英文状态码（不动 30 处调用），这里统一翻成用户看得懂的中文
        const ERROR_TITLE_ZH = {
            'CONNECTION REFUSED': '还差一点材料', 'MISSING INTEL': '产品信息还没填', 'MISSING MAIN IMAGE': '缺一张产品主体图',
            'SCOPE MISSING': '还没选输出范围', 'CUSTOM UNSUPPORTED': '当前模式不支持自定义方案', 'ARCHIVE FAILED': '打包没成功',
            'NETWORK ERROR': '网络连不上', 'CONNECTION ERROR': '网络连不上', 'MISSING DIRECTIVE': '还没写指令',
            'NO IMAGE': '还没有图片', 'NO MATERIALS': '还没上传素材图', 'NO BASE': '还没有底图', 'NO ANNOTATION': '还没画圈注',
            'BAD URL': '链接不可用', 'READ ERROR': '图片读取失败', 'LOAD ERROR': '图片加载失败', 'FULL': '已达上限',
            'RENDER ERROR': '生成失败', 'MERGE ERROR': '合成失败', 'CROP FAILED': '裁切失败', 'SIGNAL INTERRUPTED': '连接中断',
            'NO TASK ID': '还没有构思记录', 'NO SOP DATA': '还没有设计指令', 'PARSE ERROR': '指令解析失败'
        };
        function triggerError(title, desc) {
            // 每次都复位成标准报错样式，避免被 onChannelChange 之类临时改过图标/颜色后残留
            const box = document.getElementById('errorOverlay');
            const icon = box ? box.querySelector('.text-6xl') : null;
            if (icon) { icon.textContent = '⚠️'; icon.classList.add('animate-bounce'); }
            playZeldaSound('error');
            const t = document.getElementById('errorTitle');
            t.innerText = ERROR_TITLE_ZH[String(title || '').toUpperCase()] || title; t.style.color = '';
            document.getElementById('errorDesc').innerHTML = desc;
            box.style.display = 'flex';
        }

        // ✅ 成功提示（复用报错弹层，换成绿色🎉 + 胜利音效 + 弹跳动画）
        function triggerSuccess(title, desc) {
            const box = document.getElementById('errorOverlay');
            const icon = box ? box.querySelector('.text-6xl') : null;
            if (icon) { icon.textContent = '🎉'; icon.classList.remove('animate-bounce'); void icon.offsetWidth; icon.classList.add('animate-bounce'); }
            playZeldaSound('victory');
            const t = document.getElementById('errorTitle');
            t.innerText = title; t.style.color = '#4ade80';
            document.getElementById('errorDesc').innerHTML = desc;
            box.style.display = 'flex';
        }

        // 切换生图渠道：选备用通道时弹一次说明，讲清「整套一起出、慢但一次全给」
        function onChannelChange() {
            saveAppState();
            const ch = (document.getElementById('genChannel') || {}).value;
            if (ch !== 'flyfus') return;
            const box = document.getElementById('errorOverlay');
            const icon = box ? box.querySelector('.text-6xl') : null;
            const title = document.getElementById('errorTitle');
            if (icon) { icon.textContent = '🛰️'; icon.classList.remove('animate-bounce'); }
            if (title) { title.textContent = '已切换到备用通道'; title.style.color = '#FFD60A'; }
            document.getElementById('errorDesc').innerHTML =
                '备用通道是<b style="color:#fff;">全部图片完成后一次性出现</b>，中途看不到进度是正常的。<br><br>' +
                '请<b style="color:#fff;">耐心等待，只要不报错就放着等</b>。它比默认通道慢很多，' +
                '但胜在<b style="color:#FFD60A;">一次性成功、一次性全给</b>。';
            box.style.display = 'flex';
            playZeldaSound('click');
            // 图标/颜色的复位交给下一次 triggerError 自动处理，这里不用管
        }

        /* ══════════════════════════════════════════════════════════════
           💰 失败退款
           ──────────────────────────────────────────────────────────────
           后端是「先扣点再转发给 n8n」，生成失败点数就白扣了，但界面上一直
           承诺「失败不扣积分」。这里把承诺兑现：任务失败/超时时凭扣费流水号
           调 /api/refund 退回。
           流水号由各接口通过 X-Request-Id 响应头下发，按 taskId 记账。
           退多少由服务端算，且函数内部幂等 + 防超退，前端重复调用不会多退。
           ══════════════════════════════════════════════════════════════ */
        const _taskRequestIds = {};          // taskId -> 扣费 request_id
        const _refundedTasks  = {};          // 本地去重，少打无谓的请求

        function rememberChargeId(taskId, requestId) {
            if (taskId && requestId) _taskRequestIds[taskId] = requestId;
        }

        async function requestRefund(taskId, note) {
            const reqId = _taskRequestIds[taskId];
            if (!reqId || _refundedTasks[taskId]) return;
            _refundedTasks[taskId] = true;
            try {
                const headers = { 'Content-Type': 'application/json' };
                if (typeof getAuthHeader === 'function') Object.assign(headers, await getAuthHeader());
                const r = await fetch('/api/refund', {
                    method: 'POST', headers,
                    body: JSON.stringify({ request_id: reqId, refund_key: String(taskId) })
                });
                const j = await r.json();
                if (j && j.refunded > 0) {
                    if (typeof loadCredits === 'function') loadCredits();
                    if (typeof _showSimpleToast === 'function')
                        _showSimpleToast(`已退回 ${j.refunded} 点（${note || '生成失败'}）`, '#FFD60A');
                }
            } catch (e) { /* 退款失败不影响主流程，下次重试或人工补 */ }
        }

        /* ══════════════════════════════════════════════════════════════
           🩺 素材链接探活 + 自动重传
           ──────────────────────────────────────────────────────────────
           存档（materialMeta）里会记住每张素材的 Firebase URL，原逻辑是
           「有 url 就直接复用」。但 Storage 上的文件可能早已被清理，死链接
           照样会被发给生图通道 —— 通道下载参考图拿到 404，整批生图全废，
           而且报错信息在通道那边，前端完全看不出是素材的问题。
           所以生图/构思前先探活，失效的用本地副本（base64/preview）重传。
           用 Image 探活而不是 fetch：图片跨域加载不受 CORS 限制。
           ══════════════════════════════════════════════════════════════ */
        function isImageUrlAlive(url) {
            return new Promise((resolve) => {
                if (!url) return resolve(false);
                const img = new Image();
                const timer = setTimeout(() => { img.onload = img.onerror = null; resolve(false); }, 8000);
                img.onload  = () => { clearTimeout(timer); resolve(true); };
                img.onerror = () => { clearTimeout(timer); resolve(false); };
                img.src = url;
            });
        }

        // 返回本次「因失效而重传」的张数；没有本地副本又失效的，收集到 lost 里
        async function ensureMaterialUrls(materials) {
            const lost = [];
            let revived = 0;
            await Promise.all((materials || []).map(async (m) => {
                if (m.url && !(await isImageUrlAlive(m.url))) { m.url = null; revived++; }
                if (!m.url) {
                    const local = m.preview || m.base64;
                    if (!local) { lost.push(m.filename || '未命名素材'); return; }
                    try { m.url = await uploadImageToFirebase(local, m.filename); }
                    catch (e) { lost.push(m.filename || '未命名素材'); }
                }
            }));
            return { revived, lost };
        }
        
        function _showAuthErr(msg, isInfo) {
            const err = document.getElementById('authErrText');
            if (!err) return;
            err.innerText = msg;
            err.style.color = isInfo ? '#FFD700' : '#ef4444';
            err.style.opacity = '1';
            clearTimeout(err._t);
            err._t = setTimeout(() => { err.style.opacity = '0'; err.style.color = '#ef4444'; }, 4500);
        }

        function showVerifyHint(email) {
            const hint = document.getElementById('authVerifyHint');
            const emailEl = document.getElementById('authVerifyEmail');
            if (emailEl && email) emailEl.innerText = email;
            if (hint) hint.classList.remove('hidden');
        }

        function hideVerifyHintAndLogin() {
            document.getElementById('authVerifyHint')?.classList.add('hidden');
            setAuthMode('login');
        }

        async function authenticateTerminal() {
            const email = document.getElementById('terminalEmail').value.trim();
            const password = document.getElementById('terminalPwd').value.trim();
            // 邀请制：即使有人在控制台改了 _authMode，这里也强制走登录，不发起 signUp
            const isRegister = (typeof ALLOW_SELF_SIGNUP !== 'undefined' && !ALLOW_SELF_SIGNUP) ? false : (_authMode === 'register');

            if (!email || !password) { _showAuthErr('请填写邮箱和密码'); return; }
            if (!/^\S+@\S+\.\S+$/.test(email)) { _showAuthErr('邮箱格式不正确'); return; }
            if (isRegister && password.length < 6) { _showAuthErr('密码至少需要 6 位'); return; }

            const submitBtn = document.getElementById('authSubmitBtn');
            const oldBtnText = submitBtn?.innerText;
            if (submitBtn) { submitBtn.disabled = true; submitBtn.innerText = isRegister ? '注册中...' : '登录中...'; }

            try {
                let result;
                if (isRegister) {
                    result = await _supa.auth.signUp({ email, password });
                } else {
                    result = await _supa.auth.signInWithPassword({ email, password });
                }

                if (result.error) {
                    let msg = result.error.message;
                    if (/email not confirmed|not.*confirm/i.test(msg)) {
                        _showAuthErr('邮箱还未验证，已为你打开重发界面 →');
                        showVerifyHint(email);
                    } else if (/invalid login|invalid.*credential/i.test(msg)) {
                        _showAuthErr('邮箱或密码不正确');
                    } else if (/already registered|already exists/i.test(msg)) {
                        _showAuthErr('该邮箱已被注册，请直接登录');
                        setAuthMode('login');
                    } else {
                        _showAuthErr(msg);
                    }
                    try { playZeldaSound('error'); } catch(e) {}
                    return;
                }

                if (isRegister) {
                    // Supabase 行为：identities 为空表示该邮箱已注册过（避免泄露但仍返回此信号）
                    const ident = result.data?.user?.identities;
                    if (Array.isArray(ident) && ident.length === 0) {
                        _showAuthErr('该邮箱已被注册，请直接登录');
                        setAuthMode('login');
                        return;
                    }
                    // 没有 session 说明需要邮件验证
                    if (!result.data?.session) {
                        showVerifyHint(email);
                        return;
                    }
                }

                // 真正登入成功
                localStorage.setItem('hyrule_terminal_auth', 'GRANTED');
                const authOverlay = document.getElementById('authOverlay');
                authOverlay.style.opacity = '0';
                setTimeout(() => {
                    authOverlay.style.display = 'none';
                    maybeShowModeModal();
                }, 500);
                if (typeof loadAppState === 'function') loadAppState();
                if (typeof checkNewbieStatus === 'function') checkNewbieStatus();
                if (typeof loadCredits === 'function') loadCredits();
                try { playZeldaSound('victory'); } catch(e) {}
            } finally {
                if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = oldBtnText; }
            }
        }

        async function resendVerification() {
            const email = (document.getElementById('terminalEmail').value || document.getElementById('authVerifyEmail')?.innerText || '').trim();
            const status = document.getElementById('authResendStatus');
            const btn = document.getElementById('authResendBtn');
            if (!email) { if (status) { status.style.color='#ef4444'; status.innerText = '请先填邮箱'; } return; }
            if (btn) btn.disabled = true;
            if (status) { status.style.color='#aaa'; status.innerText = '发送中...'; }
            try {
                const { error } = await _supa.auth.resend({ type: 'signup', email });
                if (status) {
                    if (error) { status.style.color='#ef4444'; status.innerText = '发送失败：' + error.message; }
                    else { status.style.color='#00FFC5'; status.innerText = '✓ 已重发，请检查邮箱（含垃圾邮件文件夹）'; }
                }
            } catch (e) {
                if (status) { status.style.color='#ef4444'; status.innerText = '网络错误：' + (e.message || e); }
            } finally {
                setTimeout(() => { if (btn) btn.disabled = false; }, 2500);
            }
        }

        async function forgotPassword(ev) {
            if (ev) ev.preventDefault();
            const email = document.getElementById('terminalEmail').value.trim();
            if (!email) { _showAuthErr('请先在上方输入邮箱'); return; }
            if (!/^\S+@\S+\.\S+$/.test(email)) { _showAuthErr('邮箱格式不正确'); return; }
            try {
                const { error } = await _supa.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
                if (error) { _showAuthErr('发送失败：' + error.message); }
                else { _showAuthErr('✓ 重置密码邮件已发送至 ' + email + '（请检查垃圾邮件）', true); }
            } catch (e) {
                _showAuthErr('网络错误：' + (e.message || e));
            }
        }

var _authMode = 'login';

// ====== 公告三连击逻辑 ======
var _announceStep = 0;
var _announceReactions = [
    { text: '我看到了\n牛逼！', color: '#FFD700' },
    { text: '我看到了\n屌爆！', color: '#FF4500' },
    { text: '我看到了\n跪了！！\n让我进去吧', color: '#00FFC5' },
];
var _announceBtnLabels = [
    '我看到了，进入系统 →',
    '真的假的？再看一眼 →',
    '好了好了，放我进去吧 →',
];

function announceNextStep() {
    if (_announceStep >= _announceReactions.length) {
        document.getElementById('announceModal').classList.remove('show');
        _announceStep = 0;
        var btn = document.getElementById('announceEnterBtn');
        if (btn) btn.innerText = _announceBtnLabels[0];
        return;
    }
    var step = _announceStep;
    var reaction = _announceReactions[step];
    var textEl = document.getElementById('announceReactionText');

    // 弹出大字
    textEl.style.color = reaction.color;
    textEl.style.textShadow = '0 0 80px ' + reaction.color + ', 0 0 30px ' + reaction.color;
    textEl.innerHTML = reaction.text.replace(/\n/g, '<br>');
    textEl.style.transition = 'none';
    textEl.style.opacity = '0';
    textEl.style.transform = 'scale(0.2) rotate(-8deg)';

    requestAnimationFrame(function() {
        requestAnimationFrame(function() {
            textEl.style.transition = 'opacity 0.25s ease, transform 0.4s cubic-bezier(0.175,0.885,0.32,1.275)';
            textEl.style.opacity = '1';
            textEl.style.transform = 'scale(1) rotate(0deg)';
        });
    });

    setTimeout(function() {
        textEl.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
        textEl.style.opacity = '0';
        textEl.style.transform = 'scale(1.3)';
    }, 900);

    _announceStep++;

    if (_announceStep >= _announceReactions.length) {
        // 三次完成，关闭公告，进入系统
        setTimeout(function() {
            document.getElementById('announceModal').classList.remove('show');
        }, 1100);
    } else {
        // 更新按钮文字
        var btn = document.getElementById('announceEnterBtn');
        if (btn) btn.innerText = _announceBtnLabels[_announceStep];
    }
}

// 公告只首次弹（看过一次就不再弹）
function maybeShowAnnounce() {
    if (localStorage.getItem('announce_seen_v2') === '1') return;
    localStorage.setItem('announce_seen_v2', '1');
    setTimeout(function() {
        var m = document.getElementById('announceModal');
        if (m) m.classList.add('show');
    }, 600);
}
// 模式详情只首次弹（之后靠 loadAppState 恢复上次模式，不再打扰）
function maybeShowModeModal() {
    if (localStorage.getItem('mode_modal_seen_v1') === '1') return;
    localStorage.setItem('mode_modal_seen_v1', '1');
    var m = document.getElementById('modeSelectionModal');
    if (m) m.style.display = 'flex';
}
// 页面加载：已有登录会话则自动进入（不再要求重新登录）；公告只首次弹
window.addEventListener('DOMContentLoaded', function() {
    (async function() {
        try {
            const { data: { session } } = await _supa.auth.getSession();
            if (session) {
                const ov = document.getElementById('authOverlay');
                if (ov) { ov.style.opacity = '0'; setTimeout(function() { ov.style.display = 'none'; }, 300); }
                if (typeof loadAppState === 'function') loadAppState();
                if (typeof checkNewbieStatus === 'function') checkNewbieStatus();
                if (typeof loadCredits === 'function') loadCredits();
                maybeShowModeModal();
            }
        } catch (e) {}
        maybeShowAnnounce();
    })();
});
// ====== 公告三连击逻辑结束 ======
/* ══════════════════════════════════════════════════════════════
   🔒 邀请制：自助注册已关闭，账号由站长开通
   ──────────────────────────────────────────────────────────────
   ⚠️ 前端隐藏只是门面，挡不住直接调 Supabase signUp 接口的人。
   真正的关闭必须在 Supabase 后台做：
   Authentication → Sign In / Providers → Email → 关掉 "Allow new users to sign up"
   ══════════════════════════════════════════════════════════════ */
const ALLOW_SELF_SIGNUP = false;   // 想恢复自助注册就改成 true，并在 Supabase 后台重新打开

// 有意不留联系方式：能找到这个站的人，本来就有渠道找到站长。
// 将来若要公开联系方式，填 ADMIN_CONTACT 并在下面的文案里展示即可。
const ADMIN_CONTACT = { wechat: '', email: '', note: '' };

function showContactAdmin() {
    const lines = [];
    if (ADMIN_CONTACT.wechat) lines.push(`微信：<b style="color:#fff;">${ADMIN_CONTACT.wechat}</b>`);
    if (ADMIN_CONTACT.email)  lines.push(`邮箱：<b style="color:#fff;">${ADMIN_CONTACT.email}</b>`);
    if (ADMIN_CONTACT.note)   lines.push(ADMIN_CONTACT.note);
    triggerError('账号需站长开通',
        '本工具目前为邀请制，不开放自助注册。<br><br>' +
        (lines.length
            ? lines.join('<br>') + '<br><br>拿到账号后，用邮箱 + 密码直接登录即可。'
            : '<span style="color:#FFD60A;font-size:1.05em;">联系都联系不上我，你是怎么知道这个网站的？</span>'));
}

/* ══════════════════════════════════════════════════════════════
   👀 游客模式：未登录也能浏览广告位 / 公告 / 三种模式简介与案例
   ──────────────────────────────────────────────────────────────
   只是把登录遮罩淡出，不写 hyrule_terminal_auth 授权标记 —— 所以
   真要「一键构思 / 开始生成」时，getAuthHeader() 仍拿不到 session，
   会弹登录提示，游客只能看不能用。看得到、用不了，安全。
   ══════════════════════════════════════════════════════════════ */
let _isGuest = false;

function enterGuestMode() {
    _isGuest = true;
    playZeldaSound('click');
    const ov = document.getElementById('authOverlay');
    if (ov) { ov.style.opacity = '0'; setTimeout(() => { ov.style.display = 'none'; }, 500); }
    // 顶部放一条常驻提示：如何回到登录
    showGuestBanner();
}

function showGuestBanner() {
    if (document.getElementById('guestBanner')) return;
    const b = document.createElement('div');
    b.id = 'guestBanner';
    b.innerHTML = `👀 你正在<b>预览模式</b>下浏览，生成图片需要登录账号 · <a onclick="exitGuestMode()">去登录 →</a>`;
    document.body.appendChild(b);
}

function exitGuestMode() {
    _isGuest = false;
    const b = document.getElementById('guestBanner'); if (b) b.remove();
    const ov = document.getElementById('authOverlay');
    if (ov) { ov.style.display = 'flex'; requestAnimationFrame(() => { ov.style.opacity = '1'; }); }
}

// 游客试图生成/构思时统一拦截并唤回登录；返回 true 表示已拦下
function guardGuest() {
    if (localStorage.getItem('hyrule_terminal_auth') === 'GRANTED') return false;
    // 未登录（含游客）：唤回登录框
    exitGuestMode();
    triggerError('需要登录', '预览模式可以自由查看功能和案例，但<b style="color:#FFD60A;">生成图片需要先登录</b>。<br><br>已为你打开登录框；还没有账号请点登录框里的「联系站长开通」。');
    return true;
}

function setAuthMode(mode) {
    if (!ALLOW_SELF_SIGNUP) mode = 'login';   // 邀请制下强制锁在登录态
    _authMode = mode === 'register' ? 'register' : 'login';
    const tabL = document.getElementById('authTabLogin');
    const tabR = document.getElementById('authTabRegister');
    const submitBtn = document.getElementById('authSubmitBtn');
    const pwdHint = document.getElementById('authPwdHint');
    const pwdInput = document.getElementById('terminalPwd');
    const forgotLink = document.getElementById('authForgotLink');
    if (_authMode === 'login') {
        tabL?.classList.add('active');
        tabR?.classList.remove('active');
        if (submitBtn) submitBtn.innerText = '登 录';
        if (pwdHint) pwdHint.classList.add('hidden');
        if (pwdInput) pwdInput.setAttribute('autocomplete', 'current-password');
        if (forgotLink) forgotLink.style.display = '';
    } else {
        tabR?.classList.add('active');
        tabL?.classList.remove('active');
        if (submitBtn) submitBtn.innerText = '注 册';
        if (pwdHint) pwdHint.classList.remove('hidden');
        if (pwdInput) pwdInput.setAttribute('autocomplete', 'new-password');
        if (forgotLink) forgotLink.style.display = 'none';
    }
}

window.addEventListener('DOMContentLoaded', function () {
    setAuthMode('login');
});

        // ── 模式选择 & 自动弹窗逻辑 ──
        window.addEventListener('DOMContentLoaded', function() {
            document.getElementById('generationMode').addEventListener('change', function(e) {
                const desc = document.getElementById('modeDescription');
                const self = e.target;
                const scopeEl = document.getElementById('designScope');
                if (e.target.value === 'ultra_fast') {
                    desc.innerHTML = '<b>[极速飙车模式 · 铺货专用]</b><br>整套合图一次生成，依托模型自身审美直接出图，传统亚马逊风格。<b>只适合完全不追求质量的极速铺货</b>，日常出图请切回快速或大师模式。';
                    self.style.color = '#00FFC5';
                    self.style.borderColor = 'rgba(0,255,197,0.3)';
                    scopeEl.innerHTML = '<option value="" disabled selected>\uD83D\uDC49 请选择图文输出范围...</option><option value="ultra_main_8">主副图 8张</option><option value="ultra_old_aplus_4">老A+ 4张</option><option value="ultra_premium_aplus_5">高级A+ 5张</option>';
                    const agentBtn = document.getElementById('agentBtn');
                    if (agentBtn) agentBtn.style.display = 'none';
                    const kieBtn = document.getElementById('mainBtn');
                    if (kieBtn) { kieBtn.disabled = false; kieBtn.classList.add('ready-to-fuse'); }
                } else {
                    if (e.target.value === 'fast') {
                        desc.innerHTML = '<b>[快速排版模式]</b><br>适合卖点繁杂、需要极高信息密度与文字表达的产品。';
                        self.style.color = '#ff3366';
                        self.style.borderColor = 'rgba(255,51,102,0.3)';
                    } else {
                        desc.innerHTML = '<b>[大师视觉模式]</b><br>适合高客单价产品，强调光影、质感与场景化冲击。';
                        self.style.color = 'var(--zonai-teal)';
                        self.style.borderColor = 'rgba(0,255,197,0.3)';
                    }
                    scopeEl.innerHTML = '<option value="" disabled selected>\uD83D\uDC49 请选择图文输出范围...</option><option value="main_and_6">主幅图7张</option><option value="main_6_old_aplus">主幅图7张 + 5张老A+</option><option value="main_6_premium_aplus">主幅图7张 + 5张高级A+</option><option value="old_aplus_only">纯5张老A+ 模块</option><option value="premium_aplus_only">纯5张高级A+ 模块</option><option value="thd_only">THD要求图 7张 (无字/无人物)</option><option value="custom">🎛️ 自定义方案（数量/逐张要求/参考图）</option>';
                    const agentBtn = document.getElementById('agentBtn');
                    if (agentBtn) agentBtn.style.display = '';
                    const kieBtn2 = document.getElementById('mainBtn');
                    if (kieBtn2) { kieBtn2.disabled = true; kieBtn2.classList.remove('ready-to-fuse'); }
                }
                if (e.detail && e.detail.isRestore) {
                    // programmatic trigger — don't wipe scope/gallery
                } else {
                    scopeEl.value = '';
                    saveAppState();
                }
            });
            // 初始化：同步默认模式按钮高亮
            const initMode = document.getElementById('generationMode').value || 'ultra_fast';
            document.querySelectorAll('.mode-btn').forEach(btn => {
                btn.classList.toggle('mode-active', btn.dataset.mode === initMode);
            });
            // 触发一次 change 以更新 designScope 选项列表（isRestore 避免清数据）
            const initEv = new CustomEvent('change', { detail: { isRestore: true } });
            document.getElementById('generationMode').dispatchEvent(initEv);
        });

        function checkNewbieStatus() {
            if (localStorage.getItem('hyrule_veteran') === 'true') {
                document.querySelectorAll('.newbie-ui').forEach(el => el.style.display = 'none');
                document.querySelectorAll('.tooltip-icon').forEach(el => el.classList.remove('newbie-breathe'));
            } else {
                document.querySelectorAll('.newbie-ui').forEach(el => el.style.display = 'flex');
                document.querySelectorAll('.tooltip-icon').forEach(el => el.classList.add('newbie-breathe'));
            }
        }

        function dismissNewbie() {
            playZeldaSound('click');
            localStorage.setItem('hyrule_veteran', 'true');
            document.querySelectorAll('.newbie-ui').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.tooltip-icon').forEach(el => el.classList.remove('newbie-breathe'));
            
            const toast = document.createElement('div');
            toast.className = 'fixed top-10 left-1/2 transform -translate-x-1/2 px-8 py-3.5 rounded-full z-[9999] font-bold text-base transition-all duration-500 flex items-center gap-3';
            toast.style.cssText = 'background:rgba(32,34,44,0.85);backdrop-filter:blur(30px) saturate(170%);-webkit-backdrop-filter:blur(30px) saturate(170%);border:1px solid rgba(255,255,255,0.16);color:#fff;box-shadow:0 20px 60px rgba(0,0,0,0.5);';
            toast.innerHTML = `🎉 新手引导完成，开始创作吧！`;
            document.body.appendChild(toast);
            playZeldaSound('victory');
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translate(-50%, -20px)';
                setTimeout(() => toast.remove(), 500);
            }, 3000);
        }

        let imageSlots = new Array(14).fill(null);   // 0-6 主副图，7-13 A+（自定义方案 A+ 最多 7 张；legacy scope 下 12/13 恒 null）
    let mobileSlots = [];          // 📱 手机版成图 { url, id }
    let activeMobileTasks = [];    // 📱 轮询中的手机版任务
    let __lastScopeVal = '';
    let __prevScopeBeforeCustom = '';
    window.__customLayout = null;  // 🎛️ { main, sub, aplus, aplusType, directives: { slotIdx: { req, refs:[materialId] } } }
        let globalMaterials = [];
        window.__workbenchMaterials = () => globalMaterials;
        const APP_CHANNEL = 'local';   // 本版本渠道标识(官网版)
        let lastAgentTaskId = null;   // 飞书回写用的稳定任务键
        let _archiveQueue = Promise.resolve();  // 单图归档串行队列
        window.__downvoted = window.__downvoted || {};
        let activeAgentTask = null; 
        let activeKieTasks = []; 

        // 💾 持久化 v2（2026-09-24）：刷新丢数据的根治
        //   ① 按仓库路径隔离缓存键：YIMU/NEO/TT 同在 aexmo.github.io 一个域名下，原先共用 'hyrule_state_v13' 互相覆盖、共抢 5MB 配额
        //   ② 完整状态（含素材图预览/base64、结果图提示词）存 IndexedDB（容量百 MB 级），localStorage 只做轻量镜像
        //   ③ 刷新时先用 localStorage 同步恢复，再从 IndexedDB 补回素材图；localStorage 全丢时整份从 IndexedDB 恢复
        const __APP_NS = (location.pathname.match(/ec-image-hardcore-[^/]+/) || [location.host || 'app'])[0];
        const __LS_KEY = 'hyrule_state_v13::' + __APP_NS;
        let __idbRestored = false;      // IndexedDB 恢复完成前，不允许用内存里的空素材覆盖 IndexedDB
        let __idbTimer = null;
        function __idbOpen() {
            return new Promise((resolve, reject) => {
                if (!window.indexedDB) return reject(new Error('no indexedDB'));
                const req = indexedDB.open('hyrule_persist', 1);
                req.onupgradeneeded = () => { try { req.result.createObjectStore('state'); } catch (e) {} };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }
        async function __idbGet() {
            const db = await __idbOpen();
            return await new Promise((resolve, reject) => {
                const r = db.transaction('state', 'readonly').objectStore('state').get(__APP_NS);
                r.onsuccess = () => resolve(r.result || null); r.onerror = () => reject(r.error);
            });
        }
        async function __idbPut(val) {
            const db = await __idbOpen();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(val, __APP_NS);
                tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error);
            });
        }
        function __idbSaveDebounced(state) {
            if (!__idbRestored) return;
            const snap = { ...state };   // 调用当下就拍快照：saveAppState 写 localStorage 失败时会把 state 里的素材换成轻量版，不能让 IndexedDB 存到降级后的
            clearTimeout(__idbTimer);
            __idbTimer = setTimeout(() => { try { __idbPut({ ...snap, __savedAt: Date.now() }).catch(e => console.warn('[persist] IndexedDB 保存失败', e)); } catch (e) { console.warn('[persist] IndexedDB 保存异常', e); } }, 400);
        }
        function __lsGetState() {
            try { return localStorage.getItem(__LS_KEY) || localStorage.getItem('hyrule_state_v13'); } catch (e) { return null; } // 旧键兜底迁移一次
        }
        function __mergeHeavy(full) {
            try {
                const fm = full.globalMaterials || full.materialMeta;
                if (Array.isArray(fm) && fm.some(m => m && (m.preview || m.base64))) {
                    const cur = Array.isArray(globalMaterials) ? globalMaterials : [];
                    if (cur.length < fm.length || cur.some(m => !m || !m.preview || (String(m.preview).startsWith('http') && m.base64 == null))) {
                        globalMaterials = fm.map(m => (m && !m.preview && m.base64) ? { ...m, preview: 'data:image/jpeg;base64,' + m.base64 } : m).filter(Boolean);
                        if (typeof updateFilenames === 'function') updateFilenames();
                        if (typeof renderMaterialGrid === 'function') renderMaterialGrid();
                        const _uc = document.getElementById('uploadCountIndicator'); if (_uc) _uc.innerText = globalMaterials.length + '/8';
                    }
                }
                if (Array.isArray(full.imageSlots) && Array.isArray(imageSlots)) {
                    full.imageSlots.forEach((s, i) => { const c = imageSlots[i]; if (s && c && c.url === s.url) imageSlots[i] = { ...s, ...c, finalPrompt: c.finalPrompt || s.finalPrompt }; });
                }
            } catch (e) { console.warn('[persist] IndexedDB 补全失败', e); }
        }
        function __isDegraded(lsObj, full) {
            // localStorage 那份是降级存档（缺结果图 / 素材图没有预览数据）而 IndexedDB 有完整版 → 用 IndexedDB
            if (!lsObj) return true;
            const lsSlots = Array.isArray(lsObj.imageSlots) ? lsObj.imageSlots.filter(Boolean).length : 0;
            const idbSlots = Array.isArray(full.imageSlots) ? full.imageSlots.filter(Boolean).length : 0;
            const lsM = lsObj.globalMaterials || lsObj.materialMeta || [];
            const idbM = full.globalMaterials || full.materialMeta || [];
            const lsMFull = lsM.filter(m => m && (m.preview || m.base64)).length;
            const idbMFull = idbM.filter(m => m && (m.preview || m.base64)).length;
            return idbSlots > lsSlots || idbMFull > lsMFull;
        }
        function loadAppState() {
            const ls = __lsGetState();
            let lsObj = null; try { lsObj = ls ? JSON.parse(ls) : null; } catch (e) { lsObj = null; }
            const timeout = new Promise(res => setTimeout(() => res('__timeout__'), 1500));
            Promise.race([__idbGet().catch(e => { console.warn('[persist] IndexedDB 读取失败（改用 localStorage）', e); return null; }), timeout]).then(full => {
                if (full === '__timeout__') full = null;
                // 同一件商品才用 IndexedDB 顶替（防止极端情况下拿到别的会话的旧存档）
                const sameSession = full && (!lsObj || !lsObj.prodName || lsObj.prodName === full.prodName);
                if (full && sameSession && __isDegraded(lsObj, full)) {
                    console.info('[persist] localStorage 为降级/缺失存档，改用 IndexedDB 完整恢复');
                    __loadAppStateFrom(JSON.stringify(full));
                } else if (ls) {
                    __loadAppStateFrom(ls);
                    if (full && sameSession) __mergeHeavy(full);
                } else {
                    __loadAppStateFrom(null);
                }
            }).finally(() => { __idbRestored = true; try { if (ls || document.getElementById('prodName')?.value) saveAppState(); } catch (e) {} });
        }

        // 👥 模特人种（2026-10-21 Aaron：选了美国英文，出来的模特还是亚洲人）——默认跟随目标地区，也可手动指定；
        //    发给构思工作流 model_ethnicity（英文，直接写进 Core_Outline 与 IMAGE2 提示词）
        const ETH_TEXT = {
            caucasian: 'Caucasian (white) people',
            black: 'Black (African-descent) people',
            hispanic: 'Hispanic / Latino people',
            east_asian: 'East Asian people',
            southeast_asian: 'Southeast Asian people',
            south_asian: 'South Asian (Indian subcontinent) people',
            middle_eastern: 'Middle Eastern / Arab people',
            mixed: 'a natural multi-ethnic mix (Caucasian, Black, Hispanic and Asian people)'
        };
        const ETH_BY_MARKET = {
            '美国': 'Caucasian (white American) people by default; when several people appear, a natural US mix that is mostly white and may include Black or Hispanic people',
            '加拿大': 'Caucasian (white Canadian) people by default; when several people appear, a natural Canadian mix that is mostly white',
            '墨西哥': 'Hispanic / Latino Mexican people',
            '英国': 'Caucasian (white British) people', '德国': 'Caucasian (white German) people', '法国': 'Caucasian (white French) people',
            '意大利': 'Caucasian (white Italian) people', '西班牙': 'Caucasian (white Spanish) people',
            '日本': 'Japanese (East Asian) people', '韩国': 'Korean (East Asian) people',
            '中国大陆': 'Chinese (East Asian) people', '港澳台及海外华侨': 'Chinese (East Asian) people',
            '中东地区': 'Middle Eastern / Arab people',
            '全球通用(偏欧美审美)': 'Caucasian (white Western) people'
        };
        function getModelEthnicity(market) {
            const v = document.getElementById('modelEthnicity')?.value || 'auto';
            if (v !== 'auto' && ETH_TEXT[v]) return ETH_TEXT[v];
            if (!market) { try { market = JSON.parse(document.getElementById('targetMarket').value).market; } catch (e) {} }
            return ETH_BY_MARKET[market] || 'people matching the mainstream consumers of the target market (' + (market || 'US') + ')';
        }

        function isTextDepthOn() { const el = document.getElementById('textDepth'); return !!(el && el.checked); }
        function saveAppState() {
            if (!__idbRestored) return; // Do not overwrite stored state during startup.
            const state = { 
                generationMode: document.getElementById('generationMode').value,
                designScope: document.getElementById('designScope').value,
                targetMarket: document.getElementById('targetMarket').value, 
                modelEthnicity: document.getElementById('modelEthnicity')?.value || 'auto',
                prodName: document.getElementById('prodName').value, 
                prodDesc: document.getElementById('prodDesc').value, 
                strictReq: document.getElementById('strictReq').value,
                textDepth: isTextDepthOn(),
                sopText: document.getElementById('sopText').value, 
                imageSlots: imageSlots,
                // 只存 base64 一份，preview 恢复时由 base64 重建（原先双份存储是 localStorage 爆配额的元凶）
                materialMeta: globalMaterials.map(m => ({ id: m.id, base64: m.base64, filename: m.filename, category: m.category, url: m.url })),
                activeAgentTask: activeAgentTask,
                lastAgentTaskId: lastAgentTaskId,
                activeKieTasks: activeKieTasks,
                // 👑 核心修复1：强制把暗号写入本地硬盘，刷新绝对不会丢！
                lastAgentTask: window._lastAgentTaskId || null,
                // ★ 5 控制旋钮状态
                modelChoice: (document.getElementById('modelChoice') ? document.getElementById('modelChoice').value : null),
                infoDensity: (document.getElementById('infoDensity') ? document.getElementById('infoDensity').value : null),
                sceneIntensity: (document.getElementById('sceneIntensity') ? document.getElementById('sceneIntensity').value : null),
                genChannel: (document.getElementById('genChannel') ? document.getElementById('genChannel').value : null),
                categoryChoice: (document.getElementById('categoryChoice') ? document.getElementById('categoryChoice').value : null),
                categoryState: window.__categoryState || null,
                customLayout: window.__customLayout || null,
                mobileSlots: (Array.isArray(mobileSlots) ? mobileSlots.map(s => s ? { url: s.url, id: s.id } : null) : [])
            };
            // ⛑️ localStorage 超配额兜底：存档失败绝不能抛异常掐死构思/生图流程（这正是"点一键构思没反应"的根因）。
            //    降级顺序：完整存 → 丢图片 base64 只存 url 等轻量字段 → 彻底放弃本次存档但流程照常。
            try { __idbSaveDebounced(state); } catch (_e) {}
            try {
                localStorage.setItem(__LS_KEY, JSON.stringify(state));
            } catch (quotaErr) {
                try {
                    state.materialMeta = globalMaterials.map(m => ({ id: m.id, filename: m.filename, category: m.category, url: m.url }));
                    localStorage.setItem(__LS_KEY, JSON.stringify(state));
                    console.warn('存档超配额，已降级为不含图片数据的轻量存档', quotaErr);
                } catch (quotaErr2) {
                    console.warn('存档失败（localStorage 配额），本次跳过存档', quotaErr2);
                }
            }
            const kieBtn = document.getElementById('mainBtn');
            if (document.getElementById('sopText').value.trim() !== '') { kieBtn.disabled = false; kieBtn.classList.add('ready-to-fuse'); } else { kieBtn.disabled = true; kieBtn.classList.remove('ready-to-fuse'); }
        }

        function __loadAppStateFrom(savedStr) { if (!savedStr) return;
            try {
                const state = JSON.parse(savedStr);
                // 恢复生成模式（先触发 change 更新 scope 选项再设值）
                if (state.generationMode) {
                    const modeEl = document.getElementById('generationMode');
                    modeEl.value = state.generationMode;
                    const ev = new CustomEvent('change', { detail: { isRestore: true } });
                    modeEl.dispatchEvent(ev);
                    document.querySelectorAll('.mode-btn').forEach(btn => {
                        btn.classList.toggle('mode-active', btn.dataset.mode === state.generationMode);
                    });
                }
                if (state.designScope) document.getElementById('designScope').value = state.designScope;
                if (state.targetMarket) document.getElementById('targetMarket').value = state.targetMarket;
                if (state.modelEthnicity && document.getElementById('modelEthnicity')) document.getElementById('modelEthnicity').value = state.modelEthnicity;
                if (state.modelChoice === 'gpt-image-2-image-to-image') state.modelChoice = 'gpt-image-2';
                if (state.modelChoice === 'gpt-image-2-5-sunburst-image-to-image') state.modelChoice = 'gpt-image-2.5-sunburst';
                if (state.modelChoice && document.getElementById('modelChoice')) document.getElementById('modelChoice').value = state.modelChoice;
                if (state.infoDensity && document.getElementById('infoDensity')) document.getElementById('infoDensity').value = state.infoDensity;
                if (state.sceneIntensity && document.getElementById('sceneIntensity')) document.getElementById('sceneIntensity').value = state.sceneIntensity;
                if (state.genChannel && document.getElementById('genChannel')) document.getElementById('genChannel').value = state.genChannel;
                if (state.categoryChoice && document.getElementById('categoryChoice')) document.getElementById('categoryChoice').value = state.categoryChoice;
                if (state.customLayout) window.__customLayout = state.customLayout;
                try {
                    __lastScopeVal = state.designScope || '';
                    const _ceb2 = document.getElementById('customEditBtn');
                    if (_ceb2) _ceb2.style.display = (state.designScope === 'custom') ? '' : 'none';
                } catch (_e) {}
                if (state.categoryState) window.__categoryState = state.categoryState;
                if (state.prodName) document.getElementById('prodName').value = state.prodName;
                if (state.prodDesc) document.getElementById('prodDesc').value = state.prodDesc;
                if (state.strictReq) document.getElementById('strictReq').value = state.strictReq;
                if (document.getElementById('textDepth')) document.getElementById('textDepth').checked = !!state.textDepth; 
                if (state.sopText) { document.getElementById('sopText').value = state.sopText; const kieBtn = document.getElementById('mainBtn'); kieBtn.disabled = false; kieBtn.classList.add('ready-to-fuse'); }
                
                if(typeof buildGalleryLayout === 'function') buildGalleryLayout();

                if (state.imageSlots) { imageSlots = state.imageSlots; if (state.generationMode === 'ultra_fast') { buildUltraGalleryLayout(); imageSlots.forEach((img, idx) => { if (img) renderUltraSlot(idx); }); } else { imageSlots.forEach((img, idx) => { if (img && typeof renderSlot === 'function') renderSlot(idx); }); } }
                // 📱 手机版成图恢复（否则刷新即丢，打包也带不上）
                if (Array.isArray(state.mobileSlots) && state.mobileSlots.some(Boolean)) {
                  try {
                    mobileSlots = state.mobileSlots;
                    const _t = (typeof getCurrentSlotTitles === 'function') ? (getCurrentSlotTitles() || []) : [];
                    const _src = [7, 8, 9, 10, 11].filter(i => imageSlots[i] && imageSlots[i].url);
                    buildMobileGallery(mobileSlots.map((_, k) => (_src[k] != null && _t[_src[k]]) ? _t[_src[k]] : '手机版模块'));
                    mobileSlots.forEach((m, k) => {
                        if (m) { renderMobileSlot(k); return; }
                        const el = document.getElementById('mslot-' + k);
                        if (el) { el.classList.remove('standby'); el.innerHTML = '<div class="text-xs py-10 px-4 text-center" style="color:var(--text-3)">这张上次没生成成功<br>可再点一次「生成手机版」</div>'; }
                    });
                  } catch (_e) { console.warn('[loadAppState] 手机版恢复异常，已跳过', _e); }
                }
                if (typeof updateMobileBtnVisibility === 'function') updateMobileBtnVisibility();
                if (state.lastAgentTaskId) lastAgentTaskId = state.lastAgentTaskId;
                if (state.activeAgentTask && typeof resumeAgentListener === 'function') {
                    // 狂飙模式没有 agent 构思阶段，不需要恢复 championsOverlay 等待界面。
                    // 只有 fast / master 模式才有"先构思后调和"两步，需要恢复进度监听。
                    const restoredMode = (document.getElementById('generationMode') || {}).value;
                    if (restoredMode === 'ultra_fast') {
                        activeAgentTask = null;  // 顺手清掉持久化的脏数据
                    } else {
                        activeAgentTask = state.activeAgentTask;
                        resumeAgentListener(activeAgentTask);
                    }
                }
                if (state.activeKieTasks && state.activeKieTasks.length > 0) { activeKieTasks = state.activeKieTasks; const ultra = state.generationMode === 'ultra_fast'; switchView(ultra ? 'ultra-log' : 'adventure-log', document.getElementById(ultra ? 'nav-ultra' : 'nav-notes')); activeKieTasks.forEach(task => { if (ultra) resumeUltraKieListener(task.slot, task.taskId); else resumeKieListener(task.slot, task.taskId, !!task.isInpaint); }); }
                if (state.materialMeta && state.materialMeta.length > 0) {
                    globalMaterials = state.materialMeta;
                    // 存档里不再有 preview（省一半配额），恢复时由 base64 重建；轻量存档（只有 url）则 preview 直接用 url
                    globalMaterials.forEach(m => {
                        if (!m.preview) m.preview = m.base64 ? ('data:image/jpeg;base64,' + m.base64) : (m.url || '');
                    });
                    // 关键修复：还原材料列表后必须重绘 DOM，否则图片在内存里但屏幕空白，
                    // 而 8 张上限的检查仍然在跑 → 用户会看到"无图但说超过 8 张"
                    if (typeof renderMaterialGrid === 'function') renderMaterialGrid();
                    const cntEl = document.getElementById('uploadCountIndicator');
                    if (cntEl) cntEl.innerText = globalMaterials.length + '/8';
                }

                // 👑 核心修复2：刷新网页后，第一时间恢复全局暗号！
                if (state.lastAgentTask) { window._lastAgentTaskId = state.lastAgentTask; }
                // ⛑️ 刷新后自动切到结果视图：否则恢复的图渲染在隐藏视图里，看起来“图片全消失”
                if (state.imageSlots && state.imageSlots.some(function(s){return s;}) && typeof switchView === 'function') {
                    if (state.generationMode === 'ultra_fast') switchView('ultra-log', document.getElementById('nav-ultra'));
                    else switchView('adventure-log', document.getElementById('nav-notes'));
                }
            } catch (e) { console.error("读取记忆失败", e); }
        }
        // ★ 品类选择器 handler + 弹窗辅助函数（从 YIMU 移植）
        function onCategoryChange() {
            const val = document.getElementById('categoryChoice').value;
            if (val === 'supplement_bottle') {
                // 打开提醒卡时重置配额到默认（按当前主副图张数缩放，默认 7 时即 2/2/2/1）
                const _sd = _fitAlloc({ A: 2, B: 2, C: 2, D: 1 }, getMainFlowTarget());
                document.getElementById('allocA').value = _sd.A;
                document.getElementById('allocB').value = _sd.B;
                document.getElementById('allocC').value = _sd.C;
                document.getElementById('allocD').value = _sd.D;
                document.getElementById('supplementConfirmed').checked = false;
                recalcAllocation();
                document.getElementById('supplementModal').classList.add('show');
            } else if (val === 'structural_product') {
                // 打开结构件提醒卡时重置配额到默认（按当前主副图张数缩放，默认 7 时即 2/2/2/1）
                const _st = _fitAlloc({ A: 2, B: 2, C: 2, D: 1 }, getMainFlowTarget());
                document.getElementById('stAllocA').value = _st.A;
                document.getElementById('stAllocB').value = _st.B;
                document.getElementById('stAllocC').value = _st.C;
                document.getElementById('stAllocD').value = _st.D;
                document.getElementById('structuralConfirmed').checked = false;
                document.getElementById('structureNotes').value = (window.__categoryState?.structure_notes) || '';
                recalcStructAllocation();
                document.getElementById('structuralModal').classList.add('show');
            } else {
                window.__categoryState = { category: 'general', confirmed: false, allocation: null };
                saveAppState();
            }
        }

        function recalcAllocation() {
            const a = parseInt(document.getElementById('allocA').value) || 0;
            const b = parseInt(document.getElementById('allocB').value) || 0;
            const c = parseInt(document.getElementById('allocC').value) || 0;
            const d = parseInt(document.getElementById('allocD').value) || 0;
            const total = a + b + c + d;
            const target = getMainFlowTarget();
            const el = document.getElementById('allocTotal');
            const btn = document.getElementById('supplementConfirmBtn');
            if (total === target) {
                el.textContent = `合计 ${total} / ${target} ✅`;
                el.style.color = '#4ade80';
                btn.disabled = false;
                btn.style.opacity = '1';
            } else {
                el.textContent = `合计 ${total} / ${target} ⚠️ 总数必须 = ${target}（主副图张数）`;
                el.style.color = '#f87171';
                btn.disabled = true;
                btn.style.opacity = '0.4';
            }
        }

        function confirmSupplement() {
            const a = parseInt(document.getElementById('allocA').value) || 0;
            const b = parseInt(document.getElementById('allocB').value) || 0;
            const c = parseInt(document.getElementById('allocC').value) || 0;
            const d = parseInt(document.getElementById('allocD').value) || 0;
            if (a + b + c + d !== getMainFlowTarget()) { return; } // 按钮已 disabled，此处为双保险
            const confirmed = document.getElementById('supplementConfirmed').checked;
            window.__categoryState = { category: 'supplement_bottle', confirmed: confirmed, allocation: { A: a, B: b, C: c, D: d } };
            document.getElementById('supplementModal').classList.remove('show');
            saveAppState();
        }

        function useSupplementDefault() {
            window.__categoryState = { category: 'supplement_bottle', confirmed: false, allocation: _fitAlloc({ A: 2, B: 3, C: 1, D: 1 }, getMainFlowTarget()) };
            document.getElementById('supplementModal').classList.remove('show');
            saveAppState();
        }

        function recalcStructAllocation() {
            const a = parseInt(document.getElementById('stAllocA').value) || 0;
            const b = parseInt(document.getElementById('stAllocB').value) || 0;
            const c = parseInt(document.getElementById('stAllocC').value) || 0;
            const d = parseInt(document.getElementById('stAllocD').value) || 0;
            const total = a + b + c + d;
            const target = getMainFlowTarget();
            const el = document.getElementById('stAllocTotal');
            const btn = document.getElementById('structuralConfirmBtn');
            if (total === target) {
                el.textContent = `合计 ${total} / ${target} ✅`;
                el.style.color = '#38bdf8';
                btn.disabled = false;
                btn.style.opacity = '1';
            } else {
                el.textContent = `合计 ${total} / ${target} ⚠️ 总数必须 = ${target}（主副图张数）`;
                el.style.color = '#f87171';
                btn.disabled = true;
                btn.style.opacity = '0.4';
            }
        }

        function confirmStructural() {
            const a = parseInt(document.getElementById('stAllocA').value) || 0;
            const b = parseInt(document.getElementById('stAllocB').value) || 0;
            const c = parseInt(document.getElementById('stAllocC').value) || 0;
            const d = parseInt(document.getElementById('stAllocD').value) || 0;
            if (a + b + c + d !== getMainFlowTarget()) { return; } // 按钮已 disabled，此处为双保险
            const confirmed = document.getElementById('structuralConfirmed').checked;
            const notes = (document.getElementById('structureNotes').value || '').trim();
            window.__categoryState = { category: 'structural_product', confirmed: confirmed, allocation: { A: a, B: b, C: c, D: d }, structure_notes: notes || null };
            document.getElementById('structuralModal').classList.remove('show');
            saveAppState();
        }

        function useStructuralDefault() {
            const notes = (document.getElementById('structureNotes').value || '').trim();
            window.__categoryState = { category: 'structural_product', confirmed: false, allocation: _fitAlloc({ A: 3, B: 2, C: 1, D: 1 }, getMainFlowTarget()), structure_notes: notes || null };
            document.getElementById('structuralModal').classList.remove('show');
            saveAppState();
        }

        function switchView(viewName, el) {
            playZeldaSound('click');
            const VIEW_MAP = { 'dashboard': 'view-dashboard', 'ultra-log': 'view-ultra-log', 'partners': 'view-partners', 'adventure-log': 'view-adventure-log', 'edit-studio': 'view-edit-studio' };
            Object.values(VIEW_MAP).forEach(id => { const n = document.getElementById(id); if (n) n.classList.add('hidden'); });
            const target = document.getElementById(VIEW_MAP[viewName] || 'view-adventure-log');
            if (target) target.classList.remove('hidden');
            document.querySelectorAll('.category-icon').forEach(i => i.classList.remove('active'));
            el.classList.add('active');
            if (viewName === 'partners') openPartnersView();
        }

        /* ══════════════════════════════════════════════════════════════
           合作产品 / 广告位板块
           ──────────────────────────────────────────────────────────────
           招租新增产品 = 只往 PARTNER_PRODUCTS 里加一条，不用动任何 HTML/CSS。
           视频托管换家（Firebase / R2 / 火山 TOS）= 只改 videos[].src，代码不变。
           媒体文件放 partner-media/<产品id>/ 下；视频建议走外链 CDN，不进 Git 仓库。
           ══════════════════════════════════════════════════════════════ */
        const PARTNER_PRODUCTS = [
            {
                id: 'shortdrama',
                icon: '🎬',
                name: '短剧 Agent 生成系统',
                badge: 'AUPlus 出品',
                tagline: '把「我想要那种感觉」，变成每一秒都精确的执行方案',
                desc: '你只需要用人话说清楚想要什么感觉，剩下的交给它：把模糊的方向翻译成结构、把结构拆成镜头、把镜头对上节拍和配乐、把角色锁死不跑形，最后交出一个可以直接开剪的成片包。这些事传统上要一个团队——懂节奏的编剧、写得出 Cue Sheet 的音乐总监、能把分镜和节拍对上的导演、维持角色一致的美术，每个岗位都是多年积累，还得彼此对得上话。它不是替你按下生成键，而是把这些专业判断固化成了可反复执行的流程：每一步都看得见、改得动、退得回，不满意就在那一步重来，不用整支片子推翻。',
                highlights: ['创意研讨→可执行方案', '节拍精确到 0.5 秒', 'BGM Cue Sheet', '角色一致性锁定', '情绪标签配音', '导出即可剪'],
                cta: { label: '了解详情 / 咨询合作', href: '' },

                // ⭐ 最难被替代的能力：顾问圆桌评审（真实协作过程，三步）
                roundtable: {
                    title: '核心：一支顾问团陪你把本子改到能拍',
                    lead: '下面是一次真实的剧本会诊全过程——一部 12 集竖屏丧尸短剧。<b style="color:#fff;">不是"帮你写"，是帮你看出问题在哪、并给出怎么改。</b>',
                    steps: [
                        { src: 'partner-media/shortdrama/rt-01-lineup.jpg',
                          n: 'STEP 1', h: '按你的本子配阵容，还能随时换人',
                          t: '系统读完剧本先判断类型（竖屏 1 分钟 × 12 集、丧尸恐怖 + 喜剧拌嘴），再配出六席顾问，<b>每席都写明"为什么选 TA"</b>。<br><br>真正关键的是下半张：你说了一句「台词是我们人工写的、不用改，想聊技法和镜头」，它当场<b>撤下两位台词向顾问，换成视觉／技法向</b>，并明确「五席全部聚焦技法/镜头/画面/细节，不碰台词」。<br><br><b style="color:#FFD60A;">阵容是跟着你的需求走的，不是固定套餐。</b>' },
                        { src: 'partner-media/shortdrama/rt-02-critique.jpg',
                          n: 'STEP 2', h: '每一席都给诊断、处方和分数',
                          t: '不是笼统夸一句"挺好的"。韩式人性反转引擎直接判：<b>「这场丧尸灾难里，没有『人比丧尸更可怕』的时刻」，人性反转张力 4/10</b>，然后给三条能落地的改法。<br><br>单田芳<b>逐集给钩子打星</b>：第 1 集 ★★★★★「车底下那只手动了，教科书级别」；第 10 集 ★「这是最差的扣子，情绪高潮已经释放完了才停」。<br><br>技法引擎还会检索语料库佐证，命中就给原句和配方——例如「他们穿过了三节丧尸的车厢，却穿不过人心」。' },
                        { src: 'partner-media/shortdrama/rt-03-crossview.jpg',
                          n: 'STEP 3', h: '不同流派交叉挑刺，盲区互相补',
                          t: 'Jordan Peele 视角挑出<b>「一颗没被引爆的炸弹——红姐递过的那杯咖啡」</b>，指出该被"日常恐怖化"的是咖啡杯、冲剂盒、办公室日光灯；Fincher 视角只从光线、构图、色彩说画面问题。同一个本子，不同人看见不同的洞。<br><br>还有一点值得注意：检索不到语料时它会<b>如实说「该维度无匹配语料」</b>而不是硬编——<b style="color:#FFD60A;">敢说"我这儿没有"，说"我有"的时候才可信。</b>' }
                    ]
                },


                // 🔧 回答「我们到底给它设计了什么」——每条都能在下方截图里找到对应
                designNotes: {
                    title: '为了让它真的能交付，我们在里面做了这些设计',
                    groups: [
                        {
                            icon: '🎭', h: '人物不跑形', sub: 'AI 短剧最容易翻车的地方',
                            items: [
                                '同一个角色拆成<b>两张基准图</b>：一张大头照锁脸，一张<code>全身穿搭·脖子以下不露脸</code>锁衣着体型 —— 刻意不给第二张脸，从源头掐断"多张脸对不上"',
                                '素材按 <code>S / A / B</code> 分级，主体级素材优先保真，环境级允许发挥',
                                '先<b>文生图</b>定 base，再<b>图生图</b>派生变体，所有衍生画面都挂在同一个基准上'
                            ],
                            gain: '→ 60 秒里出现十几次的角色，脸和衣服始终是同一个人'
                        },
                        {
                            icon: '📝', h: '提示词不靠碰运气', sub: '把不确定性写死',
                            items: [
                                '每段提示词强制带<b>【素材声明】</b>：这个镜头用参考图几的哪个部分，逐条写明，不让模型自己猜',
                                '全片共用一套<b>摄影基底</b>并写进每一段：<code>Photorealistic · natural light · handheld 混 locked-off · warm morning tones · Sony A7R5 · 35mm+85mm</code>',
                                '禁止项前置：不出字幕水印、不生成 Logo、画面不抖动 —— 写在提示词里而不是事后返工'
                            ],
                            gain: '→ 十几段分别生成，光线、色温、质感却像同一台机器拍的'
                        },
                        {
                            icon: '🎬', h: '镜头之间接得上', sub: '不是一堆碎片拼在一起',
                            items: [
                                '段与段之间标明<b>衔接方式</b>（硬切／叠化）与依据',
                                '写明<b>桥接逻辑</b>：上一段收在什么画面 → 下一段从什么画面起 —— 例如「S1 收在 Sarah 看着 Cooper 蹭地 → S2 开在门廊强光，硬切」',
                                '每段再拆 <code>5-6 镜</code>，逐镜标注景别与画面内容'
                            ],
                            gain: '→ 剪起来是顺的，不用靠转场特效硬圆场'
                        },
                        {
                            icon: '🥁', h: '节奏是设计出来的', sub: '不是拍完再配个音乐',
                            items: [
                                '喜剧节拍拆到 <code>0.5 秒</code>：撕开包装 [pizzicato, pp] → 舌头舔走芝士 [snare accent + woodwind gliss] → 药片弹跳 [tiny percussion]，<b>动作、音效、情绪三条线同时对齐</b>',
                                '全片 <b>Cue Sheet</b> 逐条标时间／段落／技法／意图，含 <code>Silence as Punchline</code>（把静默当笑点）这类专业处理',
                                '附<b>「禁止元素」清单</b>：不要打击乐、不要史诗弦乐、不要欢快大调收尾 —— 先说清什么不能做'
                            ],
                            gain: '→ 笑点和情绪落点是排出来的，不靠运气'
                        },
                        {
                            icon: '🔊', h: '声音各归各位', sub: '分工比堆功能更重要',
                            items: [
                                '<b>上镜对白</b>交给视频模型（口型要对上），<b>不上镜的旁白／OS</b>才走配音 —— 分工写进系统规则，不混用',
                                '每条旁白精确标注<b>叠在哪一段的哪几秒</b>，以及与前后音乐的呼吸间隔',
                                '情绪标签内嵌台词，稳定度刻意调低换取<b>更多情绪起伏</b>'
                            ],
                            gain: '→ 配音不是贴上去的，是长在画面节奏里的'
                        }
                    ]
                },

                screenshots: [
                    { src: 'partner-media/shortdrama/shot-01-assets.jpg',
                      caption: '资产先行：角色、场景、道具统一生成并锁定为 base，全片复用。同一个角色跨 60 秒不变脸——这是 AI 短剧最难的一关。' },
                    { src: 'partner-media/shortdrama/shot-02-script.jpg',
                      caption: '分镜级脚本：每段标时长、挂参考图编队、写明与上一段的衔接方式（硬切／叠化）与转场依据，不靠模型自由发挥。' },
                    { src: 'partner-media/shortdrama/shot-03-bgm.jpg',
                      caption: 'Cue Sheet 落到执行：研讨定下的音乐设计逐条变成可生成的 cue，配上关键时刻与禁止元素清单。' },
                    { src: 'partner-media/shortdrama/shot-04-voice.jpg',
                      caption: '情绪标签内嵌配音：[flatly]、[pause]、[softer] 直接写进台词，逐句还原语气停顿，不是机器朗读。' },
                    { src: 'partner-media/shortdrama/shot-05-timeline.jpg',
                      caption: '导出即可剪：画面、字幕、配音、BGM 分轨输出，落地剪辑软件直接开工，不用再倒腾素材。' }
                ],
                videos: []
            }
        ];

        // 招租位文案（设为 null 可隐藏）
        const PARTNER_RENT_SLOT = {
            title: '这个位置招租中',
            sub: '面向电商工具、AI 应用、跨境服务商开放。<br>想让你的产品出现在这里，联系 AUPlus。'
        };

        let _partnerActive = 0;
        let _vlbList = [], _vlbIdx = 0;

        function openPartnersView() {
            try { localStorage.setItem('hyrule_partners_seen', '1'); } catch (e) {}
            const dot = document.getElementById('partnerDot');
            if (dot) dot.style.display = 'none';
            renderPartners();
        }

        function renderPartners() {
            const tabs = document.getElementById('partnerTabs');
            const body = document.getElementById('partnerBody');
            if (!tabs || !body) return;

            // 只有一个产品时不显示切换 chips
            tabs.innerHTML = PARTNER_PRODUCTS.length > 1
                ? PARTNER_PRODUCTS.map((p, i) =>
                    `<div class="partner-tab ${i === _partnerActive ? 'active' : ''}" onclick="_partnerActive=${i};renderPartners();">${p.icon || ''} ${escapeHtmlP(p.name)}</div>`).join('')
                : '';

            const p = PARTNER_PRODUCTS[_partnerActive];
            if (!p) { body.innerHTML = ''; return; }

            const ctaHtml = p.cta && p.cta.label
                ? `<button class="partner-cta" onclick="${p.cta.href ? `window.open('${p.cta.href}','_blank')` : `alert('想了解「${escapeHtmlP(p.name)}」，请直接联系 AUPlus。')`}">${escapeHtmlP(p.cta.label)}</button>`
                : '';

            body.innerHTML = `
                <div class="partner-card">
                    <div class="partner-hero">
                        <div class="partner-logo">${p.icon || '📦'}</div>
                        <div style="flex:1;min-width:220px;">
                            <div class="partner-name">${escapeHtmlP(p.name)}${p.badge ? `<span class="partner-badge">${escapeHtmlP(p.badge)}</span>` : ''}</div>
                            <div class="partner-tagline">${escapeHtmlP(p.tagline || '')}</div>
                        </div>
                        ${ctaHtml}
                    </div>
                    ${p.desc ? `<div class="partner-desc">${escapeHtmlP(p.desc)}</div>` : ''}
                    ${(p.highlights || []).length ? `<div class="partner-hl">${p.highlights.map(h => `<span>${escapeHtmlP(h)}</span>`).join('')}</div>` : ''}

                    ${renderRoundtable(p)}

                    ${renderDesignNotes(p)}

                    <div class="partner-sec-title">完整生产链路</div>
                    ${renderShots(p)}

                    <div class="partner-sec-title">案例成果</div>
                    ${renderVideos(p)}
                </div>
                ${PARTNER_RENT_SLOT ? `<div class="rent-card"><div class="rent-title">${PARTNER_RENT_SLOT.title}</div><div class="rent-sub">${PARTNER_RENT_SLOT.sub}</div></div>` : ''}
            `;
        }

        // ⭐ 顾问圆桌：用三步真实过程展示「怎么跟人配合」
        function renderRoundtable(p) {
            const r = p.roundtable;
            if (!r || !(r.steps || []).length) return '';
            return `
                <div class="partner-sec-title">${escapeHtmlP(r.title)}</div>
                ${r.lead ? `<div class="rt-lead">${r.lead}</div>` : ''}
                <div class="rt-steps">
                    ${r.steps.map(s => `
                        <div class="rt-step">
                            <div class="rt-num">${escapeHtmlP(s.n || '')}</div>
                            <h5>${escapeHtmlP(s.h)}</h5>
                            <div class="rt-img" onclick="openSampleLightbox('${s.src}')">
                                <img src="${s.src}" alt="${escapeHtmlP(s.h)}" loading="lazy">
                                <div class="rt-zoom">点击放大看细节</div>
                            </div>
                            <p>${s.t}</p>
                        </div>`).join('')}
                </div>`;
        }

        // 🔧 设计说明：讲清楚「我们给它设计了什么」以及「对用户意味着什么」
        function renderDesignNotes(p) {
            const d = p.designNotes;
            if (!d || !(d.groups || []).length) return '';
            return `
                <div class="partner-sec-title">${escapeHtmlP(d.title)}</div>
                <div class="dn-grid">
                    ${d.groups.map(g => `
                        <div class="dn-card">
                            <h5>${g.icon || ''} ${escapeHtmlP(g.h)}</h5>
                            ${g.sub ? `<div class="dn-sub">${escapeHtmlP(g.sub)}</div>` : ''}
                            <ul>${(g.items || []).map(it => `<li>${it}</li>`).join('')}</ul>
                            ${g.gain ? `<div class="dn-gain">${g.gain}</div>` : ''}
                        </div>`).join('')}
                </div>`;
        }

        function renderShots(p) {
            const shots = p.screenshots || [];
            if (!shots.length) {
                return `<div class="shot-rail">${[1, 2, 3].map(() =>
                    `<div class="ph-box ph-shot"><div style="font-size:1.5rem;opacity:0.5;">🖼️</div><div>系统截图即将上线</div></div>`).join('')}</div>`;
            }
            return `<div class="shot-rail">${shots.map(s => `
                <div class="shot-item" onclick="openSampleLightbox('${s.src}')">
                    <img src="${s.src}" alt="${escapeHtmlP(s.caption || '')}" loading="lazy">
                    ${s.caption ? `<div class="shot-cap">${escapeHtmlP(s.caption)}</div>` : ''}
                </div>`).join('')}</div>`;
        }

        /* 视频来源支持两种：
             { bvid: 'BV1xx...' }  → B 站 iframe 嵌入（平台扛带宽、自适应码率、长视频无压力）
             { src : '....mp4'  }  → 直链 mp4，用原生 video 播放
           两种都只在点击后才加载播放器，不点就只有一张封面图，浏览广告位几乎不耗流量。 */
        function biliEmbedUrl(bvid, autoplay) {
            return 'https://player.bilibili.com/player.html?bvid=' + encodeURIComponent(bvid)
                 + '&page=1&high_quality=1&danmaku=0&autoplay=' + (autoplay ? 1 : 0);
        }

        function renderVideos(p) {
            const vids = p.videos || [];
            if (!vids.length) {
                return `<div class="vid-wall">${[1, 2, 3, 4].map(() =>
                    `<div class="ph-box ph-vid"><div style="font-size:1.6rem;opacity:0.5;">🎞️</div><div>案例视频即将上线</div></div>`).join('')}</div>`;
            }
            return `<div class="vid-wall">${vids.map((v, i) => {
                let cover;
                if (v.poster) {
                    cover = `<img class="vid-poster" src="${v.poster}" alt="${escapeHtmlP(v.title || '')}" loading="lazy">`;
                } else if (v.src) {
                    cover = `<video src="${v.src}" muted loop playsinline preload="none"></video>`;
                } else {
                    // B 站源且没给封面：用标题做占位，避免空白卡片
                    cover = `<div class="vid-fallback"><span>${escapeHtmlP(v.title || '案例视频')}</span></div>`;
                }
                return `
                <div class="vid-card" onclick="openVideoLightbox(${i})"
                     onmouseenter="hoverPreview(this,true)" onmouseleave="hoverPreview(this,false)">
                    ${cover}
                    <div class="vid-shade"></div>
                    <div class="vid-play"><svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg></div>
                    ${v.dur ? `<div class="vid-dur">${escapeHtmlP(v.dur)}</div>` : ''}
                    <div class="vid-meta">
                        <div class="vid-title">${escapeHtmlP(v.title || '')}</div>
                        ${v.desc ? `<div class="vid-desc">${escapeHtmlP(v.desc)}</div>` : ''}
                    </div>
                </div>`; }).join('')}</div>`;
        }

        // 悬停预览：有封面图的卡片不预加载视频，避免白白吃流量
        function hoverPreview(card, on) {
            const v = card.querySelector('video');
            if (!v) return;
            if (on) { v.play().catch(() => {}); } else { v.pause(); v.currentTime = 0; }
        }

        function openVideoLightbox(idx) {
            const p = PARTNER_PRODUCTS[_partnerActive];
            _vlbList = p.videos || [];
            if (!_vlbList.length) return;
            _vlbIdx = idx;
            const lb = document.getElementById('videoLightbox');
            lb.classList.remove('hidden');
            playVlb();
            document.addEventListener('keydown', vlbKeys);
        }

        function playVlb() {
            const v = _vlbList[_vlbIdx];
            const el = document.getElementById('vlbVideo');
            el.src = v.src;
            if (v.poster) el.poster = v.poster;
            el.play().catch(() => {});
            document.getElementById('vlbCap').textContent = [v.title, v.desc].filter(Boolean).join(' · ');
            const multi = _vlbList.length > 1;
            document.querySelectorAll('#videoLightbox .vlb-nav').forEach(n => n.style.display = multi ? 'flex' : 'none');
        }

        function stepVideoLightbox(d) {
            _vlbIdx = (_vlbIdx + d + _vlbList.length) % _vlbList.length;
            playVlb();
        }

        function closeVideoLightbox() {
            const el = document.getElementById('vlbVideo');
            el.pause(); el.removeAttribute('src'); el.load();
            document.getElementById('videoLightbox').classList.add('hidden');
            document.removeEventListener('keydown', vlbKeys);
        }

        function vlbKeys(e) {
            if (e.key === 'Escape') closeVideoLightbox();
            else if (e.key === 'ArrowLeft') stepVideoLightbox(-1);
            else if (e.key === 'ArrowRight') stepVideoLightbox(1);
        }

        function escapeHtmlP(s) {
            return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
                ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        }

        // 已看过就不再显示红点
        (function () {
            try {
                if (localStorage.getItem('hyrule_partners_seen') === '1') {
                    document.addEventListener('DOMContentLoaded', () => {
                        const d = document.getElementById('partnerDot');
                        if (d) d.style.display = 'none';
                    });
                }
            } catch (e) {}
        })();

        let currentUploadCategory = ""; 
        function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

        function openUploader(category) {
            playZeldaSound('click');
            currentUploadCategory = category;
            document.getElementById('hiddenFileInput').click();
        }

        function handleDirectUpload(inputElement) {
            processNewFiles(inputElement.files, currentUploadCategory);
            inputElement.value = ''; 
        }

        function handleDirectDrop(e, category) {
            preventDefaults(e);
            processNewFiles(e.dataTransfer.files, category);
        }

        // 入库即压缩：长边缩到 maxEdge、导出 JPEG。手机直拍的 10MB 原图也压到几百 KB，
        // 同时避开 localStorage 配额与云端多模态请求的体积上限。JPEG 无透明通道，先垫白底防 PNG 透明区变黑。
        function compressImageFile(file, maxEdge = 1600, quality = 0.85) {
            return new Promise((resolve, reject) => {
                const objUrl = URL.createObjectURL(file);
                const img = new Image();
                img.onload = () => {
                    try {
                        URL.revokeObjectURL(objUrl);
                        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
                        const w = Math.max(1, Math.round(img.width * scale));
                        const h = Math.max(1, Math.round(img.height * scale));
                        const canvas = document.createElement('canvas');
                        canvas.width = w; canvas.height = h;
                        const ctx = canvas.getContext('2d');
                        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, w, h);
                        ctx.drawImage(img, 0, 0, w, h);
                        resolve(canvas.toDataURL('image/jpeg', quality));
                    } catch (e) { reject(e); }
                };
                img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('图片解码失败')); };
                img.src = objUrl;
            });
        }

        function processNewFiles(files, category) {
            const newFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
            if(newFiles.length === 0) return;
            if(globalMaterials.length + newFiles.length > 8) { triggerError('FULL', '最多支持 8 张参考图！'); return; }

            playZeldaSound('click');
            newFiles.forEach(file => {
                // 压缩失败（如个别格式 canvas 解不了）时回退原图直读，保证图不丢
                compressImageFile(file)
                    .catch(() => new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (e) => resolve(e.target.result);
                        reader.onerror = () => reject(new Error('读取失败'));
                        reader.readAsDataURL(file);
                    }))
                    .then((dataUrl) => {
                        globalMaterials.push({
                            id: 'mat_' + Math.random().toString(36).substr(2, 9),
                            base64: dataUrl.split(',')[1],
                            preview: dataUrl,
                            category: category
                        });
                        updateFilenames();
                        renderMaterialGrid();
                        document.getElementById('uploadCountIndicator').innerText = globalMaterials.length + '/8';
                        saveAppState();
                    })
                    .catch(() => triggerError('IMPORT FAILED', '这张图片无法读取，请换一张格式常规的图片（JPG/PNG）。'));
            });
        }

        function updateFilenames() {
            const counts = {};
            globalMaterials.forEach(m => {
                counts[m.category] = (counts[m.category] || 0) + 1;
                m.filename = `${m.category}_${counts[m.category]}`;
            });
        }

        function removeMaterial(id) { 
            playZeldaSound('click'); 
            globalMaterials = globalMaterials.filter(m => m.id !== id); 
            updateFilenames();
            renderMaterialGrid(); 
            document.getElementById('uploadCountIndicator').innerText = globalMaterials.length + '/8';
        }

        function renderMaterialGrid() { 
            const grid = document.getElementById('materialPreviewGrid'); 
            grid.innerHTML = ''; 
            globalMaterials.forEach(m => { 
                const div = document.createElement('div'); 
                div.className = 'relative group aspect-square rounded-xl border border-zonai-teal/30 bg-black/50 overflow-hidden flex items-center justify-center'; 
                div.innerHTML = `
                    <img src="${m.preview}" class="w-full h-full object-cover opacity-90 transition group-hover:opacity-40">
                    <div class="absolute bottom-0 w-full bg-black/80 text-[8px] text-zonai-teal text-center py-1 font-mono break-all leading-tight">${m.filename}</div>
                    <button onclick="removeMaterial('${m.id}')" class="absolute top-1 right-1 bg-red-600/90 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition text-xs z-10">✕</button>
                `;
                grid.appendChild(div);
            });
        }

        let progressInterval = null;
        
        function abortAgentTask() {
            playZeldaSound('click');
            const pwd = prompt("警告：请确认 AGENT 运行已失败或卡死后再退回主页。\n请输入强制解除密码：");
            if (pwd === OVERRIDE_PWD) {
                playZeldaSound('error'); 
                if(progressInterval) clearInterval(progressInterval);
                document.getElementById('championsOverlay').classList.remove('show');
                if (activeAgentTask) { db.ref('agent_tasks/' + activeAgentTask).off(); activeAgentTask = null; }
                saveAppState(); alert("任务已强制停止，已安全回到工作台。");
            } else if (pwd !== null) { alert("密码错误。"); }
        }

        /* ══════════════════════════════════════════════════════════════
           ⏱️ 任务看门狗（构思 / 生图 卡死时的兜底报错）
           ──────────────────────────────────────────────────────────────
           为什么需要：前端靠监听 Firebase 的 status 字段判断成败，但如果
           n8n 工作流中途崩溃（节点报错、通道超时、实例重启），Firebase
           根本不会被写入 —— 监听回调里的 `if (!data) return` 就一直空转，
           用户看不到任何提示，只能干等。
           所以每个任务都挂一个定时器：到点还没等到 completed/failed，
           就主动判定为失败并给出可操作的提示。
           ══════════════════════════════════════════════════════════════ */
        const WATCHDOG_MS   = { agent: 10 * 60 * 1000, image: 12 * 60 * 1000 };  // 构思 10 分钟 / 生图 12 分钟
        const SLOW_HINT_MS  = { agent:  4 * 60 * 1000, image:  5 * 60 * 1000 };  // 到点先安抚一句，避免误以为卡死
        // 构思 10 分钟到点后的宽限期（2026-08-31 实测：大师模式四专家串行 + 逐张 prompt
        // 精修，正常全链路 11~17 分钟，云端没挂、结果最终都会写回 —— 不该判死）
        const AGENT_GRACE_MS = 15 * 60 * 1000;
        const _watchdogs = {};

        // 备用通道是「全部图片跑完才一次性写回」，且并发额度是账号级共享的：
        // 单个任务在 20 并发下约 2-3 分钟，但多任务并行撞限流时会退化到十几分钟。
        // 15 分钟既能覆盖退化情况，又不至于真出故障时拖太久才报错。
        function watchdogMsFor(kind) {
            if (kind !== 'image') return WATCHDOG_MS[kind];
            const ch = (document.getElementById('genChannel') || {}).value;
            return ch === 'flyfus' ? 15 * 60 * 1000 : WATCHDOG_MS.image;
        }

        function armWatchdog(key, kind, onTimeout, onSlow) {
            clearWatchdog(key);
            _watchdogs[key] = {
                slow: onSlow ? setTimeout(onSlow, SLOW_HINT_MS[kind]) : null,
                hard: setTimeout(() => { delete _watchdogs[key]; onTimeout(); }, watchdogMsFor(kind)),
                startedAt: Date.now()
            };
        }
        function clearWatchdog(key) {
            const w = _watchdogs[key];
            if (!w) return;
            if (w.slow) clearTimeout(w.slow);
            if (w.hard) clearTimeout(w.hard);
            delete _watchdogs[key];
        }
        function watchdogMins(key) {
            const w = _watchdogs[key];
            return w ? Math.round((Date.now() - w.startedAt) / 60000) : 0;
        }

        // 生图槽位的统一失败卡片（超时/失败共用）
        function renderSlotFailure(slotIdx, title, hint, isUltra) {
            const slot = document.getElementById((isUltra ? 'ultra-slot-' : 'slot-') + slotIdx);
            if (!slot) return;
            slot.classList.remove('standby');
            slot.classList.add('failed');
            slot.innerHTML = `
                <div class="text-red-500 font-black text-sm font-mono uppercase z-10 flex flex-col items-center justify-center h-full w-full px-2 text-center">
                    <svg class="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                    ${title}
                </div>
                <div class="slot-actions" style="flex-direction:column; gap:8px; padding:10px;">
                    <div class="text-[10px] text-zonai-yellow font-mono text-center leading-relaxed mb-1">${hint}</div>
                    <div class="action-mini-btn" onclick="triggerGeneration(${slotIdx})">🔄 重新生图</div>
                </div>`;
            playZeldaSound('error');
        }

        function resumeAgentListener(taskId) {
            const overlay = document.getElementById('championsOverlay'); const progressBar = document.getElementById('shrineProgressBar'); const statusText = document.getElementById('shrineStatusText'); const kieBtn = document.getElementById('mainBtn');
            overlay.classList.add('show'); overlay.classList.remove('finished'); progressBar.style.width = '0%'; statusText.innerText = "正在恢复任务进度…"; 
            let progress = 0; clearInterval(progressInterval);
            progressInterval = setInterval(() => { if(progress < 99) { progress++; progressBar.style.width = progress + '%'; } }, 6000); 
            
            const ref = db.ref('agent_tasks/' + taskId);

            // ⏱️ 构思看门狗（两段式，2026-08-31 改）：
            //    实测大师模式全链路正常也要 11~17 分钟，10 分钟到点时云端多半还在跑、
            //    结果最终会写回 Firebase —— 直接判死等于把马上出炉的结果扔掉，用户
            //    重点一次还要整轮重跑（双倍烧 token）。所以第一段到点只提示 + 续命，
            //    再宽限 AGENT_GRACE_MS（总计 25 分钟）仍无任何写回才判真故障。
            const wdKey = 'agent:' + taskId;
            const failAgentTimeout = () => {
                requestRefund(taskId, '构思超时');
                ref.off(); clearInterval(progressInterval);
                overlay.classList.remove('show', 'finished'); progressBar.style.width = '0%';
                kieBtn.disabled = false;
                activeAgentTask = null; saveAppState();
                playZeldaSound('error');
                triggerError('构思超时',
                    '等待云端返回超过 25 分钟，判定为链路故障（多半是通道抽风或节点报错）。<br><br>' +
                    '商品资料仍保留。请先查看任务状态，避免重复提交。<br>' +
                    '页面测试点数不代表实际费用，模型费用以服务商记录为准。');
            };
            armWatchdog(wdKey, 'agent',
                () => {   // 第一段 10 分钟到点：不判死，安抚并续命继续等写回
                    statusText.innerText = "☁️ 云端仍在构思中…复杂产品全链路可达 20 分钟，结果一到会自动展示，请勿关闭页面";
                    _watchdogs[wdKey] = {
                        slow: null,
                        hard: setTimeout(() => { delete _watchdogs[wdKey]; failAgentTimeout(); }, AGENT_GRACE_MS),
                        startedAt: Date.now()
                    };
                },
                () => { statusText.innerText = "仍在生成中…（已等待 4 分钟，复杂产品属正常）"; }
            );

            ref.on('value', (snapshot) => {
                const data = snapshot.val(); if (!data) return;
                if (data.status === 'completed' && data.result) {
                    clearWatchdog('agent:' + taskId);
                    clearInterval(progressInterval); progressBar.style.width = '100%'; window._lastAgentTaskId = taskId;
                    activeAgentTask = null; saveAppState(); 
                    playZeldaSound('victory'); overlay.classList.add('finished');
                    setTimeout(() => { overlay.classList.remove('show', 'finished'); progressBar.style.width = '0%'; kieBtn.disabled = false; kieBtn.classList.add('ready-to-fuse'); }, 2500); ref.off();
               } else if (data.status === 'failed') {
                    // ⛑️ 这里原先是从生图监听器误粘过来的代码，引用了构思流程里并不存在的
                    //    slotIdx / slot，一旦构思失败就抛 ReferenceError —— 遮罩不关、进度条空转，
                    //    用户只能干等。现改为构思该有的失败处理。
                    clearWatchdog('agent:' + taskId);
                    requestRefund(taskId, '构思失败');
                    ref.off(); clearInterval(progressInterval);
                    overlay.classList.remove('show', 'finished'); progressBar.style.width = '0%';
                    kieBtn.disabled = false;
                    activeAgentTask = null; saveAppState();
                    playZeldaSound('error');
                    triggerError('构思失败',
                        (data.error ? ('构思未完成：' + String(data.error).slice(0, 500).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) + '<br><br>') : '构思服务在生成设计方案时中断了。<br><br>') +
                        '商品资料仍保留，没有自动重复提交。请根据上面的原因处理后再重试。<br>' +
                        '页面测试点数不代表实际费用，模型费用以服务商记录为准。');
                }
            });
        }

        async function summonAgent() {
            if (guardGuest()) return;   // 游客/未登录：唤回登录框，不进入构思
            const mode = document.getElementById('generationMode').value;

            // 极速飙车模式：跳过构思 overlay，直接发射 webhook，让图片 slots 进入等待状态
            if (mode === 'ultra_fast') {
                const name = document.getElementById('prodName').value; 
                const desc = document.getElementById('prodDesc').value; 
                const strictReq = document.getElementById('strictReq').value;
                const marketData = JSON.parse(document.getElementById('targetMarket').value);
                const scope = document.getElementById('designScope').value;
            // 🎛️ 自定义方案：极速不支持；未确认方案先弹窗；品类配额必须等于自定义主副图张数
            if (scope === 'custom') {
                if (mode === 'ultra_fast') { triggerError('CUSTOM UNSUPPORTED', '极速飙车模式暂不支持自定义方案，请切换到快速/大师模式。'); return; }
                if (!window.__customLayout) { openCustomModal(); return; }
                const _t = getMainFlowTarget();
                const _cs = window.__categoryState;
                if (_cs && _cs.category !== 'general' && _cs.allocation && _t > 0) {
                    const _sum = (_cs.allocation.A|0) + (_cs.allocation.B|0) + (_cs.allocation.C|0) + (_cs.allocation.D|0);
                    if (_sum !== _t) { triggerError('配额不一致', `品类配额合计 ${_sum} 张 ≠ 自定义主副图 ${_t} 张。<br><br>已为你拉起品类弹窗，请重新确认配额。`); onCategoryChange(); return; }
                }
            }

                if (!scope) { triggerError('SCOPE MISSING', '请先在上方选择 [图文输出范围]！'); document.getElementById('designScope').focus(); return; }
                if (!name || !desc || globalMaterials.length === 0) { triggerError('MISSING INTEL', '情报不足！请填写文案并上传图片。'); return; }
                
                const hasMainImage = globalMaterials.some(m => m.category === '产品主体图');
                if (!hasMainImage) { triggerError('MISSING MAIN IMAGE', '非法操作！图片库中必须包含至少一张【产品主体图】才能派发任务！'); return; }

                playZeldaSound('click');
                const agentTaskId = 'agent_' + Date.now(); activeAgentTask = agentTaskId; lastAgentTaskId = agentTaskId; saveAppState();

                try {
                    // 先上传图片到 Firebase 获取 URL
                    document.getElementById('ultraLogContent').innerHTML = '⚡ 正在上传素材至云端...';
                    // 🩺 探活 + 自动重传：存档里的旧 URL 可能已失效，死链接会让整批生图报废
                    const _mat = await ensureMaterialUrls(globalMaterials);
                    if (_mat.lost.length) {
                        triggerError('素材已失效', '以下素材的云端文件已不存在，且本地没有副本可重传：<br><b style="color:#FFD60A;">' +
                            _mat.lost.join('、') + '</b><br><br>请重新上传这几张图后再发车。<br>（本次未提交，不扣点数）');
                        return;
                    }
                    if (_mat.revived) document.getElementById('ultraLogContent').innerHTML =
                        `⚡ 检测到 ${_mat.revived} 张素材链接已过期，已自动重传，继续…`;
                    saveAppState();

                    const batchId = Date.now();
                    const titles = getCurrentSlotTitles();
                    let generatedTasks = [];

                    switchView('ultra-log', document.getElementById('nav-ultra'));
                    document.getElementById('ultraLogContent').innerHTML = '⚡ 极速模式已启动，正在云端生成…';
                    const ultraBtn = document.getElementById('mainBtn');
                    ultraBtn.disabled = true; ultraBtn.classList.remove('ready-to-fuse'); ultraBtn.innerHTML = '生成中…';

                    // 在极速图库容器里构建 slots
                    buildUltraGalleryLayout();
                    for (let i = 0; i < 14; i++) {
                        if (titles[i] !== null) {
                            imageSlots[i] = null;
                            const taskId = `task_${batchId}_${i}`;
                            generatedTasks.push({ slot: i, taskId: taskId });
                            activeKieTasks.push({ slot: i, taskId: taskId });
                            resumeUltraKieListener(i, taskId);
                        }
                    }
                    saveAppState();

                    const fallbackSopText = `【极速模式】\n产品：${name}\n描述：${desc}\n需求：${strictReq}`;

                    const payload = {
                        mode: mode,
                        sop_text: fallbackSopText,
                        product_name: name,
                        product_desc: desc,
                        strict_requirements: strictReq,
                        text_depth: isTextDepthOn(),
                        images: globalMaterials.map(m => m.url),
                        categorized_images: globalMaterials.map(m => ({ filename: m.filename, url: m.url })),
                        agent_task_id: agentTaskId,
                    app_channel: APP_CHANNEL,
                        batch_id: String(batchId),
                        target_market: marketData.market,
                        target_lang: marketData.lang,
                        model_ethnicity: getModelEthnicity(marketData.market),
                        design_scope: scope,
                        firebase_tasks: generatedTasks
                    };
                    const headers = await getAuthHeader();
                    if (!headers) { ultraBtn.disabled = false; ultraBtn.innerHTML = `<img src="totk-what-were-your-favorite-ultrahand-creations-v0-c6lyir7oo06e1.png" class="ultrahand-icon-fixed"><span>开始生成</span>`; return; }
                    const response = await fetch('/api/ultra_generate', { method: 'POST', headers: headers, body: JSON.stringify(payload) });
                    // 扣费流水号只有下单后才拿得到，所以在这里统一给本批次任务记账（失败时凭它退款）
                    const _chargeId = response.headers.get('X-Request-Id');
                    generatedTasks.forEach(t => rememberChargeId(t.taskId, _chargeId));
                    if (response.status === 402) { ultraBtn.disabled = false; ultraBtn.classList.add('ready-to-fuse'); ultraBtn.innerHTML = `<img src="totk-what-were-your-favorite-ultrahand-creations-v0-c6lyir7oo06e1.png" class="ultrahand-icon-fixed"><span>开始生成</span>`; activeAgentTask = null; saveAppState(); triggerError('点数不足', '剩余点数不够用了，请充值后继续。'); return; }
                    if (!response.ok) throw new Error(`HTTP 错误: ${response.status}`);
                    ultraBtn.disabled = false; ultraBtn.innerHTML = `<img src="totk-what-were-your-favorite-ultrahand-creations-v0-c6lyir7oo06e1.png" class="ultrahand-icon-fixed"><span>开始生成</span>`;
                    // 狂飙模式没有"构思 → 等待 → 调和"两步流程，发完就结束。
                    // 必须立刻清掉 activeAgentTask，否则刷新/重登后 loadAppState 会把它当成
                    // 进行中的 agent 任务，错误弹出 championsOverlay 设计中等待界面。
                    activeAgentTask = null; saveAppState();
                } catch (err) {
                    const ultraBtn = document.getElementById('mainBtn');
                    ultraBtn.disabled = false; ultraBtn.classList.add('ready-to-fuse'); ultraBtn.innerHTML = `<img src="totk-what-were-your-favorite-ultrahand-creations-v0-c6lyir7oo06e1.png" class="ultrahand-icon-fixed"><span>开始生成</span>`;
                    activeAgentTask = null; saveAppState();
                    triggerError('NETWORK ERROR', '无法连接到极速飙车引擎。');
                }
                return;
            }

            const name = document.getElementById('prodName').value;
            const desc = document.getElementById('prodDesc').value;
            const strictReq = document.getElementById('strictReq').value;
            const marketData = JSON.parse(document.getElementById('targetMarket').value);
            const scope = document.getElementById('designScope').value;
            // 🎛️ 自定义方案：极速不支持；未确认方案先弹窗；品类配额必须等于自定义主副图张数
            if (scope === 'custom') {
                if (mode === 'ultra_fast') { triggerError('CUSTOM UNSUPPORTED', '极速飙车模式暂不支持自定义方案，请切换到快速/大师模式。'); return; }
                if (!window.__customLayout) { openCustomModal(); return; }
                const _t = getMainFlowTarget();
                const _cs = window.__categoryState;
                if (_cs && _cs.category !== 'general' && _cs.allocation && _t > 0) {
                    const _sum = (_cs.allocation.A|0) + (_cs.allocation.B|0) + (_cs.allocation.C|0) + (_cs.allocation.D|0);
                    if (_sum !== _t) { triggerError('配额不一致', `品类配额合计 ${_sum} 张 ≠ 自定义主副图 ${_t} 张。<br><br>已为你拉起品类弹窗，请重新确认配额。`); onCategoryChange(); return; }
                }
            }

            if (!scope) { triggerError('SCOPE MISSING', '请先在上方选择 [图文输出范围]！'); document.getElementById('designScope').focus(); return; }
            if (!name || !desc || globalMaterials.length === 0) { triggerError('MISSING INTEL', '情报不足！请填写文案并上传图片。'); return; }
            
            const hasMainImage = globalMaterials.some(m => m.category === '产品主体图');
            if (!hasMainImage) { triggerError('MISSING MAIN IMAGE', '非法操作！图片库中必须包含至少一张【产品主体图】才能派发任务！'); return; }
            const confirmed = await new Promise(resolve => {
                const modal = document.getElementById('agentConfirmModal');
                modal.style.display = 'flex';
                const onOk = () => { modal.style.display = 'none'; resolve(true); cleanup(); };
                const onCancel = () => { modal.style.display = 'none'; resolve(false); cleanup(); };
                const cleanup = () => {
                    document.getElementById('agentConfirmOk').removeEventListener('click', onOk);
                    document.getElementById('agentConfirmCancel').removeEventListener('click', onCancel);
                };
                document.getElementById('agentConfirmOk').addEventListener('click', onOk);
                document.getElementById('agentConfirmCancel').addEventListener('click', onCancel);
            });
            if (!confirmed) return;
            playZeldaSound('click');
            const agentTaskId = 'agent_' + Date.now(); activeAgentTask = agentTaskId; lastAgentTaskId = agentTaskId; saveAppState(); resumeAgentListener(agentTaskId);

            try {
                // === 改造开始：先上传图片，再组装 Payload ===
document.getElementById('shrineStatusText').innerText = "正在将视觉素材上载至云端... ☁️"; // 更新UI提示

let uploadedMaterials = [];
try {
    // 并发上传所有图片到 Firebase (如果已有链接则跳过)
    // 🩺 先探活：存档里的旧 URL 可能已失效，死链接会让整批生成报废
    const _mat = await ensureMaterialUrls(globalMaterials);
    if (_mat.lost.length) {
        triggerError('素材已失效', '以下素材的云端文件已不存在，且本地没有副本可重传：<br><b style="color:#FFD60A;">' +
            _mat.lost.join('、') + '</b><br><br>请在左侧素材区把这几张图重新上传一次，再点「一键构思」。');
        clearInterval(progressInterval); document.getElementById('championsOverlay').classList.remove('show');
        activeAgentTask = null; saveAppState(); db.ref('agent_tasks/' + agentTaskId).off();
        return;
    }
    if (_mat.revived) document.getElementById('shrineStatusText').innerText = `检测到 ${_mat.revived} 张素材链接已过期，已自动重新上传 ☁️`;
    uploadedMaterials = globalMaterials.map(m => ({ filename: m.filename, url: m.url }));
    saveAppState(); // 存入本地记忆
} catch (e) {
    triggerError('UPLOAD FAILED', '图片上传云端失败，请检查网络。');
    clearInterval(progressInterval); document.getElementById('championsOverlay').classList.remove('show'); activeAgentTask = null; saveAppState(); db.ref('agent_tasks/' + agentTaskId).off();
    return;
}
document.getElementById('shrineStatusText').innerText = "素材上载完毕，正在唤醒云端智脑...";

// 现在 payload 里装的都是纯文本 URL，体积只有几百字节！
const payloadImages = uploadedMaterials.map(m => m.url); 
const categorizedImages = uploadedMaterials;
// === 改造结束 ===

                const payload = {
                    generation_mode: mode,
                    product_name: name,
                    product_desc: desc,
                    strict_requirements: strictReq,
                    text_depth: isTextDepthOn(),
                    images: payloadImages,
                    categorized_images: categorizedImages,
                    agent_task_id: agentTaskId,
                    app_channel: APP_CHANNEL,
                    target_market: marketData.market,
                    target_lang: marketData.lang,
                    model_ethnicity: getModelEthnicity(marketData.market),
                    design_scope: getEffectiveScope(),   // 🎛️ 自定义方案映射回后端认识的 legacy 值，路由零改动
                    custom_layout: (scope === 'custom' && window.__customLayout) ? { main: window.__customLayout.main|0, sub: window.__customLayout.sub|0, aplus: window.__customLayout.aplus|0, aplus_type: window.__customLayout.aplusType || 'premium' } : null,
                    slot_directives: buildSlotDirectives(),
                    // ★ 5 控制旋钮（与 YIMU 字段名对齐）
                    info_density: (document.getElementById('infoDensity') ? document.getElementById('infoDensity').value : 'high') || 'high',
                    scene_intensity: (document.getElementById('sceneIntensity') ? document.getElementById('sceneIntensity').value : 'original') || 'original',
                    category: (window.__categoryState && window.__categoryState.category) || 'general',
                    category_confirmed: !!(window.__categoryState && window.__categoryState.confirmed),
                    image_allocation: (window.__categoryState && window.__categoryState.allocation) || null,
                    structure_notes: (window.__categoryState && window.__categoryState.structure_notes) || null
                };
                const headers = await getAuthHeader()
if (!headers) return
const response = await fetch('/api/agent', { method: 'POST', headers: headers, body: JSON.stringify(payload) });
rememberChargeId(agentTaskId, response.headers.get('X-Request-Id'));   // 构思失败时凭它退款
if (response.status === 402) { clearInterval(progressInterval); document.getElementById('championsOverlay').classList.remove('show'); activeAgentTask = null; saveAppState(); triggerError('点数不足', '剩余点数不够用了，请充值后继续。'); return; }
if (!response.ok) throw new Error(`HTTP 错误: ${response.status}`);
            } catch (err) { clearInterval(progressInterval); document.getElementById('championsOverlay').classList.remove('show'); activeAgentTask = null; saveAppState(); db.ref('agent_tasks/' + agentTaskId).off(); triggerError('NETWORK ERROR', '无法连接到远端智脑节点。'); }
        }

        // 各槽位的画幅（重绘/加工时随任务带上，避免比例丢失变方图；与内部版一致）
        function _aspectForTitle(t) {
            if (!t) return '1:1';
            if (t.includes('老版A+')) return '16:9';
            if (t.includes('高级A+')) return '21:9';
            return '1:1';
        }

        function getCurrentSlotTitles() {
            const scope = document.getElementById('designScope').value;
            let titles = new Array(14).fill(null); 
            if (!scope) return titles;

            // ── 极速飙车模式专属 scope（三条N8N路线，后端返回的是一张合并大图，UI只需一个slot）──
            if (scope === 'ultra_main_8' || scope === 'ultra_old_aplus_4' || scope === 'ultra_premium_aplus_5') {
                titles[0] = '【极速合图】';
                return titles; // 提前返回，不走下方普通模式的title填充
            }

            if (scope === 'ultra_main_8') {
                titles[0] = '【主图】';
                for(let i=1; i<=7; i++) titles[i] = `【副图${i}】`;
            }
            if (scope === 'ultra_old_aplus_4') {
                titles[7] = '【老版A+模块1: 顶部品牌画册横幅 (Hero Banner)】';
                titles[8] = '【老版A+模块2: 隐性痛点的高级拆解】';
                titles[9] = '【老版A+模块3: Cosmo 终极生活方式共鸣】';
                titles[10] = '【老版A+模块4: 空间环境重构与生活方式】';
            }
            if (scope === 'ultra_premium_aplus_5') {
                titles[7] = '【高级A+模块1: 全宽幅沉浸式海报 (Editorial Hero)】';
                titles[8] = '【高级A+模块2: Hormozi 极致价值感知特写】';
                titles[9] = '【高级A+模块3: Cosmo 终极生活方式共鸣】';
                titles[10] = '【高级A+模块4: 空间环境重构 (Environmental Storytelling)】';
                titles[11] = '【高级A+模块5: 品牌心智收尾 (The Legacy)】';
            }

            // ── 🎛️ 自定义方案：数量与构成完全由 __customLayout 决定 ──
            if (scope === 'custom') {
                return _customTitlesFrom(window.__customLayout);
            }

            // ── 快速 / 大师模式 scope ──
            if (scope.includes('main')) {
                titles[0] = '【主图】';
                for(let i=1; i<=6; i++) titles[i] = `【卖点图${i}】`;
            }

            if (scope.includes('thd')) {
                titles[0] = '【THD白底图1: 纯净主图】';
                titles[1] = '【THD白底图2: 多角度展示】';
                titles[2] = '【THD白底图3: 产品尺寸图】';
                titles[3] = '【THD场景图4: 空间环境】';
                titles[4] = '【THD场景图5: 空间环境】';
                titles[5] = '【THD场景图6: 空间环境】';
                titles[6] = '【THD场景图7: 空间环境】';
            }

            if (scope.includes('old_aplus')) {
                titles[7] = '【老版A+模块1: 顶部品牌画册横幅 (Hero Banner)】';
                titles[8] = '【老版A+模块2: 隐性痛点的高级拆解】';
                titles[9] = '【老版A+模块3: Cosmo 终极生活方式共鸣】';
                titles[10] = '【老版A+模块4: 空间环境重构与生活方式】';
                titles[11] = '【老版A+模块5: Rufus FAQ 极简收尾】';
            }
            if (scope.includes('premium_aplus')) {
                titles[7] = '【高级A+模块1: 全宽幅沉浸式海报 (Editorial Hero)】';
                titles[8] = '【高级A+模块2: Hormozi 极致价值感知特写】';
                titles[9] = '【高级A+模块3: Cosmo 终极生活方式共鸣】';
                titles[10] = '【高级A+模块4: 空间环境重构 (Environmental Storytelling)】';
                titles[11] = '【高级A+模块5: 品牌心智收尾 (The Legacy)】';
            }
            return titles;
        }

        // ═══════════ 🎛️ 自定义方案（与内部版 2026-08-31 对齐；后端 n8n 已注入 custom_layout/slot_directives）═══════════
        const OLD_APLUS_TITLES = [
            '【老版A+模块1: 顶部品牌画册横幅 (Hero Banner)】',
            '【老版A+模块2: 隐性痛点的高级拆解】',
            '【老版A+模块3: Cosmo 终极生活方式共鸣】',
            '【老版A+模块4: 空间环境重构与生活方式】',
            '【老版A+模块5: Rufus FAQ 极简收尾】',
            '【老版A+模块6: 补充卖点模块一 (Extra Module 1)】',
            '【老版A+模块7: 补充卖点模块二 (Extra Module 2)】'
        ];
        const PREMIUM_APLUS_TITLES = [
            '【高级A+模块1: 全宽幅沉浸式海报 (Editorial Hero)】',
            '【高级A+模块2: Hormozi 极致价值感知特写】',
            '【高级A+模块3: Cosmo 终极生活方式共鸣】',
            '【高级A+模块4: 空间环境重构 (Environmental Storytelling)】',
            '【高级A+模块5: 品牌心智收尾 (The Legacy)】',
            '【高级A+模块6: 补充卖点模块一 (Extra Module 1)】',
            '【高级A+模块7: 补充卖点模块二 (Extra Module 2)】'
        ];
        let __customDraft = null;       // 弹窗内的工作副本，确认才提交

        function _fitAlloc(def, target) {
            const alloc = { A: def.A|0, B: def.B|0, C: def.C|0, D: def.D|0 };
            let total = alloc.A + alloc.B + alloc.C + alloc.D;
            for (const key of ['D', 'C', 'B', 'A']) {
                while (total > target && alloc[key] > 0) { alloc[key]--; total--; }
            }
            while (total < target) { alloc.B++; total++; }
            return alloc;
        }

        function _customTitlesFrom(cl) {
            const titles = new Array(14).fill(null);
            if (!cl) return titles;
            if ((cl.main|0) >= 1) titles[0] = '【主图】';
            for (let i = 1; i <= Math.min(cl.sub|0, 6); i++) titles[i] = `【卖点图${i}】`;
            const mods = cl.aplusType === 'old' ? OLD_APLUS_TITLES : PREMIUM_APLUS_TITLES;
            for (let i = 0; i < Math.min(cl.aplus|0, 7); i++) titles[7 + i] = mods[i];
            return titles;
        }

        function getEffectiveScope() {
            const scope = document.getElementById('designScope')?.value;
            if (scope !== 'custom' || !window.__customLayout) return scope;
            const cl = window.__customLayout;
            const hasMainFlow = ((cl.main|0) + (cl.sub|0)) > 0, hasAplus = (cl.aplus|0) > 0;
            if (hasMainFlow && hasAplus) return cl.aplusType === 'old' ? 'main_6_old_aplus' : 'main_6_premium_aplus';
            if (hasAplus) return cl.aplusType === 'old' ? 'old_aplus_only' : 'premium_aplus_only';
            return 'main_and_6';
        }

        function getMainFlowTarget() {
            const scope = document.getElementById('designScope')?.value;
            if (scope === 'custom' && window.__customLayout) return (window.__customLayout.main|0) + (window.__customLayout.sub|0);
            return 7;
        }

        function buildSlotDirectives() {
            const scope = document.getElementById('designScope')?.value;
            if (scope !== 'custom' || !window.__customLayout) return null;
            const titles = getCurrentSlotTitles();
            const dirs = [];
            for (let i = 0; i < 14; i++) {
                if (!titles[i]) continue;
                const d = (window.__customLayout.directives || {})[i] || {};
                const refs = (d.refs || [])
                    .map(id => (globalMaterials.find(m => m.id === id) || {}).filename)
                    .filter(Boolean);
                dirs.push({ slot: i, title: titles[i], requirement: (d.req || '').trim() || null, ref_images: refs });
            }
            return dirs;
        }

        function openCustomModal() {
            playZeldaSound('click');
            const src = window.__customLayout;
            __customDraft = src ? JSON.parse(JSON.stringify(src))
                                : { main: 1, sub: 6, aplus: 0, aplusType: 'premium', directives: {} };
            document.getElementById('clMain').value = __customDraft.main;
            document.getElementById('clSub').value = __customDraft.sub;
            document.getElementById('clAplus').value = __customDraft.aplus;
            document.getElementById('clAplusType').value = __customDraft.aplusType;
            onCustomCountChange();
            document.getElementById('customLayoutModal').classList.add('show');
        }

        function renderCustomCards() {
            const box = document.getElementById('customSlotCards');
            if (!box || !__customDraft) return;
            const titles = _customTitlesFrom(__customDraft);
            let html = '';
            for (let i = 0; i < 14; i++) {
                if (!titles[i]) continue;
                const d = (__customDraft.directives || {})[i] || {};
                const refs = d.refs || [];
                let refHtml;
                if (globalMaterials.length === 0) {
                    refHtml = `<div class="text-[10px] font-mono" style="color:#64748b;">（还没上传素材图——可先确认数量，上传后再回来勾参考图）</div>`;
                } else {
                    refHtml = `<div class="flex flex-wrap gap-2">` + globalMaterials.map(m => {
                        const order = refs.indexOf(m.id);
                        const sel = order >= 0;
                        return `
                        <div onclick="toggleCustomRef(${i}, '${m.id}')" title="${_escHtml(m.filename)}" style="position:relative; width:52px; height:52px; border-radius:8px; overflow:hidden; cursor:pointer; border:2px solid ${sel ? '#c084fc' : 'rgba(255,255,255,0.15)'}; ${sel ? 'box-shadow:0 0 10px rgba(192,132,252,0.5);' : 'opacity:0.75;'}">
                            <img src="${m.preview}" style="width:100%; height:100%; object-fit:cover;">
                            ${sel ? `<div style="position:absolute; top:2px; right:2px; background:#c084fc; color:#000; font-size:9px; font-weight:900; width:15px; height:15px; border-radius:50%; display:flex; align-items:center; justify-content:center;">${order + 1}</div>` : ''}
                        </div>`;
                    }).join('') + `</div>`;
                }
                html += `
                <div class="mb-3" style="background:rgba(255,255,255,0.03); border:1px solid rgba(192,132,252,0.18); border-radius:0.7rem; padding:0.8rem;">
                    <div class="text-xs font-mono font-bold mb-2" style="color:#e9d5ff;">${_escHtml(titles[i])}</div>
                    <textarea rows="2" placeholder="这张图的内容要求/卖点（选填）" oninput="_setCustomReq(${i}, this.value)" class="sheikah-input w-full text-xs font-mono custom-scrollbar mb-2" style="color:#e9d5ff; border-color:rgba(192,132,252,0.3); background:rgba(0,0,0,0.55); resize:vertical;">${_escHtml(d.req || '')}</textarea>
                    <div class="text-[10px] font-mono mb-1" style="color:#94a3b8;">📎 强制参考图（点选，可多张，编号=垫图顺序；不勾=自动匹配）</div>
                    ${refHtml}
                </div>`;
            }
            box.innerHTML = html;
        }

        function onCustomCountChange() {
            if (!__customDraft) return;
            __customDraft.main = Math.max(0, Math.min(1, parseInt(document.getElementById('clMain').value) || 0));
            __customDraft.sub = Math.max(0, Math.min(6, parseInt(document.getElementById('clSub').value) || 0));
            __customDraft.aplus = Math.max(0, Math.min(7, parseInt(document.getElementById('clAplus').value) || 0));
            __customDraft.aplusType = document.getElementById('clAplusType').value || 'premium';
            const total = __customDraft.main + __customDraft.sub + __customDraft.aplus;
            const line = document.getElementById('clTotalLine');
            const btn = document.getElementById('customConfirmBtn');
            if (total < 1) {
                line.textContent = '合计 0 张 ⚠️ 至少要 1 张';
                line.style.color = '#f87171'; btn.disabled = true; btn.style.opacity = '0.4';
            } else {
                line.textContent = `合计 ${total} 张（主图${__customDraft.main} + 副图${__customDraft.sub} + A+${__customDraft.aplus}）`;
                line.style.color = '#c084fc'; btn.disabled = false; btn.style.opacity = '1';
            }
            renderCustomCards();
        }

        function toggleCustomRef(slotIdx, matId) {
            if (!__customDraft) return;
            playZeldaSound('click');
            const d = (__customDraft.directives[slotIdx] = __customDraft.directives[slotIdx] || {});
            d.refs = d.refs || [];
            const pos = d.refs.indexOf(matId);
            if (pos >= 0) d.refs.splice(pos, 1); else d.refs.push(matId);
            renderCustomCards();
        }

        function _setCustomReq(slotIdx, val) {
            if (!__customDraft) return;
            (__customDraft.directives[slotIdx] = __customDraft.directives[slotIdx] || {}).req = val;
        }

        function confirmCustomLayout() {
            if (!__customDraft) return;
            const total = __customDraft.main + __customDraft.sub + __customDraft.aplus;
            if (total < 1) return;
            // 只保留仍激活槽位的指令
            const titles = _customTitlesFrom(__customDraft);
            const pruned = {};
            for (let i = 0; i < 14; i++) {
                if (titles[i] && __customDraft.directives[i]) pruned[i] = __customDraft.directives[i];
            }
            __customDraft.directives = pruned;
            window.__customLayout = JSON.parse(JSON.stringify(__customDraft));
            document.getElementById('customLayoutModal').classList.remove('show');
            const ceb = document.getElementById('customEditBtn'); if (ceb) ceb.style.display = '';
            playZeldaSound('click');
            imageSlots = new Array(14).fill(null);
            buildGalleryLayout();
            saveAppState();
            // 品类配额与新主副图数不一致时，拉起对应品类弹窗重新确认
            const cs = window.__categoryState;
            const target = getMainFlowTarget();
            if (cs && cs.category !== 'general' && cs.allocation && target > 0) {
                const sum = (cs.allocation.A|0) + (cs.allocation.B|0) + (cs.allocation.C|0) + (cs.allocation.D|0);
                if (sum !== target) {
                    if (typeof _showSimpleToast === 'function') _showSimpleToast('⚠️ 品类配额合计与主副图张数不一致，请重新确认配额', '#FFD700');
                    onCategoryChange();
                }
            }
            if (typeof renderCostBill === 'function') renderCostBill();   // 官网：自定义张数变了，账单跟着变
        }

        function cancelCustomLayout() {
            playZeldaSound('click');
            document.getElementById('customLayoutModal').classList.remove('show');
            __customDraft = null;
            // 从未确认过自定义方案 → 回退到进入前的 scope
            if (!window.__customLayout) {
                const sel = document.getElementById('designScope');
                sel.value = __prevScopeBeforeCustom || '';
                __lastScopeVal = sel.value;
                const ceb = document.getElementById('customEditBtn'); if (ceb) ceb.style.display = 'none';
                buildGalleryLayout();
                saveAppState();
            }
        }

        function _escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

        // ═══════════ 📱 手机版 A+ 重排（与内部版对齐；官网走 /api/generate mobile_reformat 分支，1 点/张，失败按张退）═══════════
        function updateMobileBtnVisibility() {
            const btn = document.getElementById('mobileReformatBtn');
            if (!btn) return;
            const scope = document.getElementById('designScope').value || '';
            const isPremium = scope.includes('premium_aplus') && !scope.includes('ultra');
            const hasImg = isPremium && [7,8,9,10,11].some(i => imageSlots[i] && imageSlots[i].url);
            btn.classList.toggle('hidden', !hasImg);
        }

        async function generateMobileReformat() {
            if (guardGuest()) return;   // 游客/未登录：唤回登录框
            const scope = document.getElementById('designScope').value || '';
            if (!scope.includes('premium_aplus') || scope.includes('ultra')) return;
            const sources = [7,8,9,10,11]
                .map(i => ({ i, data: imageSlots[i] }))
                .filter(s => s.data && s.data.url);
            if (sources.length === 0) { playZeldaSound('error'); return; }

            playZeldaSound('click');
            // 二次生成：上一轮若还在跑，先明说"改为重新生成"，并把旧监听 + 旧看门狗一起清掉
            // （此前只关监听不清看门狗，旧定时器到点会用旧 mIdx 误删新一轮任务并报"超时"）
            if (activeMobileTasks.length > 0 && window.aquaNotify) aquaNotify('重新生成手机版', '上一轮还有 ' + activeMobileTasks.length + ' 张在生成，已改为重新生成这一轮', '📱');
            const batchId = Date.now();
            const titles = getCurrentSlotTitles();
            const name = document.getElementById('prodName') ? document.getElementById('prodName').value : '';
            const desc = document.getElementById('prodDesc') ? document.getElementById('prodDesc').value : '';
            let marketData = { market: 'US', lang: 'en' };
            try { marketData = JSON.parse(document.getElementById('targetMarket').value); } catch(e) {}

            // 重置手机版展示区
            mobileSlots = new Array(sources.length).fill(null);
            activeMobileTasks.forEach(t => { db.ref('hyrule_tasks/' + t.taskId).off(); clearWatchdog('img:' + t.taskId); });
            activeMobileTasks = [];
            buildMobileGallery(sources.map(s => (titles[s.i] || '手机版模块')));

            const tasks = sources.map((s, mIdx) => {
                const taskId = `mobile_${batchId}_${mIdx}`;
                activeMobileTasks.push({ mIdx, taskId });
                resumeMobileListener(mIdx, taskId);
                return { taskId, source_image_url: s.data.url, title: (titles[s.i] || '').replace(/【|】/g, '') };
            });

            const payload = {
                batch_id: String(batchId),
                product_name: name, product_desc: desc,
                target_market: marketData.market, target_lang: marketData.lang,
                tasks
            };
            try {
                // 官网：经 /api/generate 的手机版分支（登录 + 白名单 + 每张 1 点），不直连 n8n
                const headers = await getAuthHeader();
                if (!headers) throw new Error('请先登录');
                const res = await fetch('/api/generate', { method: 'POST', headers: headers, body: JSON.stringify({ ...payload, mobile_reformat: true, generation_mode: 'mobile_reformat', app_channel: APP_CHANNEL }) });
                if (res.status === 402) throw new Error('剩余点数不够用了（手机版每张 1 点），请充值后继续。');
                if (res.status === 403) throw new Error('账号未激活，请联系站长开通。');
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const _reqId = res.headers.get('X-Request-Id');
                tasks.forEach(t => rememberChargeId(t.taskId, _reqId));   // 失败/超时按张退 1 点
                if (typeof loadCredits === 'function') loadCredits();
                document.getElementById('logContent').innerHTML = `<span class='text-zonai-teal animate-pulse'>📱 手机版已下发 ${tasks.length} 张，云端生成中（每张约 3–6 分钟）…</span>`;
                saveAppState();
            } catch (err) {
                activeMobileTasks.forEach(t => { db.ref('hyrule_tasks/' + t.taskId).off(); clearWatchdog('img:' + t.taskId); });
                activeMobileTasks = [];
                mobileSlots = [];
                const mSec = document.getElementById('mobileGallerySection'); if (mSec) mSec.remove();
                triggerError('NETWORK ERROR', '手机版重排服务没有响应（' + (err && err.message ? err.message : '网络错误') + '）。请等 1 分钟再点一次「生成手机版」；反复失败请检查网络或联系管理员。');
            }
        }

        function resumeMobileListener(mIdx, taskId) {
            const ref = db.ref('hyrule_tasks/' + taskId);
            // ⏱️ 手机版重排看门狗
            armWatchdog('img:' + taskId, 'image', () => {
                ref.off();
                requestRefund(taskId, '手机版超时');
                activeMobileTasks = activeMobileTasks.filter(t => t.mIdx !== mIdx);
                const el = document.getElementById('logContent');
                if (el) el.innerHTML = "<span class='text-red-400'>📱 手机版重排超时（超过 12 分钟无响应），可重新发起。</span>";
            });
            ref.on('value', (snap) => {
                const data = snap.val();
                if (!data) return;
                if (data.status === 'completed' && data.imageUrl) {
                    clearWatchdog('img:' + taskId);
                    mobileSlots[mIdx] = { url: data.imageUrl, id: taskId };
                    activeMobileTasks = activeMobileTasks.filter(t => t.mIdx !== mIdx);
                    renderMobileSlot(mIdx);
                    ref.off();
                    saveAppState();   // 手机版成图也进缓存，刷新后仍在、打包也能带上
                    if (activeMobileTasks.length === 0) {
                        const okN = mobileSlots.filter(Boolean).length, all = mobileSlots.length;
                        document.getElementById('logContent').innerHTML = okN === all
                            ? "<span class='text-zonai-teal'>📱 手机版 (1200×900) 全部生成完毕。</span>"
                            : `<span class='text-red-400'>📱 手机版重排结束：成功 ${okN} / ${all} 张，失败 ${all - okN} 张，失败的可重新发起。</span>`;
                    }
                } else if (data.status === 'failed') {
                    requestRefund(taskId, '手机版生成失败');
                    // 失败必须让人看得见：槽位显示原因，日志给出汇总（此前静默吞掉，表现为"点了不执行"）
                    clearWatchdog('img:' + taskId);
                    activeMobileTasks = activeMobileTasks.filter(t => t.mIdx !== mIdx);
                    ref.off();
                    const reason = String(data.errorMsg || '生图服务无返回').replace(/[<>&]/g, '').slice(0, 160);
                    const slot = document.getElementById(`mslot-${mIdx}`);
                    if (slot) slot.innerHTML = `<div class="text-red-400 text-xs font-mono py-12 px-4 text-center">📱 手机版生成失败<br><span class="text-[10px] opacity-80">${reason}</span><br><span class="text-[10px] opacity-60">可再点一次「生成手机版」重试</span></div>`;
                    if (activeMobileTasks.length === 0) {
                        const okN = mobileSlots.filter(Boolean).length, all = mobileSlots.length;
                        const el = document.getElementById('logContent');
                        if (el) el.innerHTML = `<span class='text-red-400'>📱 手机版重排结束：成功 ${okN} / ${all} 张，失败 ${all - okN} 张（${reason}）。可重新发起。</span>`;
                        playZeldaSound('error');
                    }
                }
            });
        }

        function buildMobileGallery(titleArr) {
            const gc = document.getElementById('galleryContainer');
            if (!gc) return;
            const old = document.getElementById('mobileGallerySection');
            if (old) old.remove();
            let inner = '';
            for (let i = 0; i < titleArr.length; i++) {
                const t = (titleArr[i] || '').replace(/【|】/g, '');
                inner += `<div class="quest-slot standby" id="mslot-${i}"><div class="opacity-30 text-zonai-teal italic text-xs font-mono py-16 px-4 text-center">${t}<br><span class="text-[10px] uppercase">Mobile Slot ${i} 生成中...</span></div></div>`;
            }
            const html = `<div id="mobileGallerySection"><div class="text-zonai-teal font-bold tracking-widest mt-8 mb-3 font-mono text-sm uppercase">📱 Mobile A+ (1200×900)</div><div class="aplus-images-section">${inner}</div></div>`;
            const wrapper = gc.querySelector('.gallery-wrapper');
            if (wrapper) {
                const holder = document.createElement('div');
                holder.innerHTML = html;
                wrapper.appendChild(holder.firstChild);
            } else {
                gc.insertAdjacentHTML('beforeend', html);
            }
        }

        function renderMobileSlot(mIdx) {
            const slot = document.getElementById(`mslot-${mIdx}`);
            if (!slot) return;
            const data = mobileSlots[mIdx];
            if (!data) return;
            slot.classList.remove('standby');
            slot.innerHTML = `
                <img src="${cnImg(data.url, 1200)}" data-o="${data.url}" referrerpolicy="no-referrer" onerror="if(cnFallback(this)) return; this.parentElement.innerHTML='<div class=\\'text-red-500 text-xs font-mono p-4\\'>手机版加载失败</div>'">
                <div class="slot-actions" style="flex-direction: column; gap: 8px; padding: 10px;">
                    <button onclick="downloadMobile(${mIdx})" class="flex-1 py-1.5 border border-[#00D4FF] text-[#00D4FF] bg-transparent rounded-md font-black tracking-widest uppercase text-[10px] hover:bg-[#00D4FF]/20 transition-all duration-200 flex items-center justify-center gap-1">下载 1200×900</button>
                </div>`;
        }

        async function downloadMobile(mIdx) {
            const data = mobileSlots[mIdx];
            if (!data) return;
            try {
                const blob = await fetchImageBlobBypassCORS(data.url);
                const bmp = await createImageBitmap(blob);
                const canvas = document.createElement('canvas');
                canvas.width = 1200; canvas.height = 900;
                canvas.getContext('2d').drawImage(bmp, 0, 0, 1200, 900);
                canvas.toBlob((outBlob) => {
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = URL.createObjectURL(outBlob);
                    a.download = `mobile_aplus_${mIdx}_${Date.now()}.jpg`;
                    document.body.appendChild(a); a.click();
                    setTimeout(() => { URL.revokeObjectURL(a.href); document.body.removeChild(a); }, 500);
                }, 'image/jpeg', 0.95);
            } catch (e) { window.open(data.url, '_blank'); }
        }

        function handleScopeChange() {
            playZeldaSound('click');
            const _newScope = document.getElementById('designScope').value;
            const _ceb = document.getElementById('customEditBtn');
            if (_ceb) _ceb.style.display = (_newScope === 'custom') ? '' : 'none';
            if (_newScope === 'custom' && __lastScopeVal !== 'custom') {
                __prevScopeBeforeCustom = __lastScopeVal;
                openCustomModal();   // 未确认前 cancelCustomLayout 会回退 scope
            }
            __lastScopeVal = _newScope;
            imageSlots = new Array(14).fill(null);
            buildGalleryLayout();
            saveAppState();
            // 切换输出范围时重置手机版：关监听、隐藏按钮、清展示区
            if (typeof activeMobileTasks !== 'undefined') {
                activeMobileTasks.forEach(t => { db.ref('hyrule_tasks/' + t.taskId).off(); clearWatchdog('img:' + t.taskId); });
                activeMobileTasks = [];
                mobileSlots = [];
            }
            const mSec = document.getElementById('mobileGallerySection');
            if (mSec) mSec.remove();
            updateMobileBtnVisibility();
            // 💰 扣费账单跟着范围走（快速/大师：构思按次 7 点 + 每张 2 点 × 张数；极速：整套 5 点）
            renderCostBill();
        }

        // 💰 分步扣费账单：讲清「一共多少、什么时候在哪扣、每步多少、余额够不够」
        // 数字与后端 api/agent.js + api/generate.js + api/ultra_generate.js 完全对应
        const COST_TABLE = {
  'main_and_6'           : { pieces: 7,  think: 7,  draw: 14 },
  'main_6_old_aplus'     : { pieces: 12, think: 7,  draw: 24 },
  'main_6_premium_aplus' : { pieces: 12, think: 7,  draw: 24 },
  'old_aplus_only'       : { pieces: 5,  think: 7,  draw: 10 },
  'premium_aplus_only'   : { pieces: 5,  think: 7,  draw: 10 },
  'thd_only'             : { pieces: 7,  think: 7,  draw: 12 },
  'ultra_main_8'         : { pieces: 8,  ultra: 5 },
  'ultra_old_aplus'      : { pieces: 5,  ultra: 5 },
  'ultra_premium'        : { pieces: 5,  ultra: 5 },
  'ultra_old_aplus_4'    : { pieces: 4,  ultra: 5 },
  'ultra_premium_aplus_5': { pieces: 5,  ultra: 5 }
};
const REDRAW_PER_IMG = 1;   // 单张重绘：快速/大师 1 点（极速 5 点，账单里单独注明）

function currentBalance() {
  const t = (document.getElementById('creditDisplay') || {}).innerText || '';
  const m = t.match(/(\d+)/);
  return m ? parseInt(m[1]) : null;
}

function renderCostBill() {
  const el = document.getElementById('scopeCostDisplay');
  if (!el) return;
  const scope = (document.getElementById('designScope') || {}).value;
  let c = COST_TABLE[scope];
  if (scope === 'custom') {
    const cl = window.__customLayout;
    const n = cl ? ((cl.main|0) + (cl.sub|0) + (cl.aplus|0)) : 0;
    c = n > 0 ? { pieces: n, think: 7, draw: 2 * n } : null;   // 构思按次 7 点、出图每张 2 点，与 api/agent.js、api/generate.js 一致
  }
  if (!c) { el.classList.add('hidden'); return; }

  const bal = currentBalance();
  let rows = '';
  let total = 0;

  if (c.ultra != null) {
    // 极速：一步出图
    total = c.ultra;
    rows += billRow('①', '一键发车（直接出图）', c.ultra + ' 点', '点「一键发车」时扣');
    rows += billNote(`极速模式跳过构思，${c.pieces} 张一次成型。单张重绘 5 点。`);
  } else {
    total = c.think + c.draw;
    rows += billRow('①', '一键构思（生成设计方案 · 按次计）', c.think + ' 点', '点「一键构思」时扣');
    rows += billRow('②', `一键生成（出图 ${c.pieces} 张）`, c.draw + ' 点', '点「开始生成」时扣');
    rows += billNote(`每张 2 点 × ${c.pieces} 张 = ${c.draw} 点。单张重绘 ${REDRAW_PER_IMG} 点。`);
  }

  let balLine = '';
  if (bal != null) {
    const enough = bal >= total;
    balLine = `<div class="bill-bal ${enough ? 'ok' : 'no'}">
        当前余额 ${bal} 点 · ${enough
          ? `做完这套还剩 <b>${bal - total}</b> 点`
          : `<b>不足，还差 ${total - bal} 点</b>`}
      </div>`;
  }

  el.innerHTML = `
    <div class="bill-head">💰 这套图预计花 <b>${total}</b> 点 · 分两步扣，失败会退</div>
    <div class="bill-rows">${rows}</div>
    ${balLine}`;
  el.classList.remove('hidden');
}
function billRow(n, name, amount, when) {
  return `<div class="bill-row">
      <span class="bill-n">${n}</span>
      <span class="bill-name">${name}<span class="bill-when">${when}</span></span>
      <span class="bill-amt">${amount}</span>
    </div>`;
}
function billNote(t) { return `<div class="bill-sub">${t}</div>`; }

        function buildGalleryLayout() {
            const scope = document.getElementById('designScope').value;
            const container = document.getElementById('galleryContainer');
            if(!scope) { container.innerHTML = ''; return; }

            // 极速飙车模式：单独路由到极速图库
            if (scope.startsWith('ultra_')) { buildUltraGalleryLayout(); return; }

            const titles = getCurrentSlotTitles();
            let html = '<div class="gallery-wrapper custom-scrollbar">';

            if (scope.includes('main') || scope.includes('thd') || (scope === 'custom' && titles.slice(0, 7).some(Boolean))) {
                html += `<div class="text-sheikah-blue font-bold tracking-widest mb-3 font-mono text-sm uppercase">Main Flow (1:1)</div>`;
                html += `<div class="main-images-section">`;
                for(let i=0; i<7; i++) if(titles[i]) html += buildSlotHtml(i, titles[i]);
                html += `</div>`;
            }

            if (scope.includes('aplus') || (scope === 'custom' && titles.slice(7).some(Boolean))) {
                html += `<div class="text-zonai-teal font-bold tracking-widest mt-8 mb-3 font-mono text-sm uppercase">A+ Assets (Wide)</div>`;
                html += `<div class="aplus-images-section">`;
                for(let i=7; i<14; i++) if(titles[i]) html += buildSlotHtml(i, titles[i]); 
                html += `</div>`;
            }

            html += `</div>`;
            container.innerHTML = html;
        }

        function buildSlotHtml(idx, titleName) {
            return `
            <div class="quest-slot standby" id="slot-${idx}">
                <div class="opacity-30 text-sheikah-blue italic text-xs font-mono py-16 px-4 text-center">
                    ${titleName}<br><span class="text-[10px] uppercase">Slot ${idx} Standby</span>
                </div>
            </div>`;
        }

        let currentEditingSlotIdx = -1;

        function closeEditModal() { 
            playZeldaSound('click'); 
            document.getElementById('promptModal').classList.remove('show'); 
        }

        function openEditModal(idx) {
            playZeldaSound('click'); 
            const fullText = document.getElementById('sopText').value;
            const titles = getCurrentSlotTitles();
            if (!fullText) { triggerError('NO SOP DATA', '全局文本框中没有设计指令，无法提取指令。'); return; }

            currentEditingSlotIdx = idx;
            const targetTitle = titles[idx];
            if(!targetTitle) return;

            document.getElementById('modalSlotTitle').innerText = `[ ${targetTitle.replace(/【|】/g, '')} ]`;

            const coreMatch = targetTitle.match(/(主图|卖点图\d|老版A\+模块\d|高级A\+模块\d|THD白底图\d|THD场景图\d)/);
            const coreKeyword = coreMatch ? coreMatch[0].replace('+', '\\+') : '未知';
            
            const regex = new RegExp('【[^】]*' + coreKeyword + '[^】]*】');
            const match = fullText.match(regex);

            if (!match) { 
                triggerError('PARSE ERROR', `在全文中找不到包含【${coreMatch[0]}】的核心标签！\n请检查文案。`); 
                return; 
            }

            let startIdx = match.index;
            let endIdx = fullText.indexOf('【', startIdx + match[0].length);
            if (endIdx === -1) endIdx = fullText.length; 

            const extractedBlock = fullText.substring(startIdx, endIdx).trim();
            document.getElementById('modalTextarea').value = extractedBlock;
            document.getElementById('promptModal').classList.add('show');
        }

        function saveAndRedrawSingle() {
            playZeldaSound('click'); 
            const editedText = document.getElementById('modalTextarea').value; 
            let fullText = document.getElementById('sopText').value;
            const titles = getCurrentSlotTitles();
            const targetTitle = titles[currentEditingSlotIdx];

            const coreMatch = targetTitle.match(/(主图|卖点图\d|老版A\+模块\d|高级A\+模块\d|THD白底图\d|THD场景图\d)/);
            const coreKeyword = coreMatch ? coreMatch[0].replace('+', '\\+') : '未知';
            
            const regex = new RegExp('【[^】]*' + coreKeyword + '[^】]*】');
            const match = fullText.match(regex);

            if (match) {
                let startIdx = match.index;
                let endIdx = fullText.indexOf('【', startIdx + match[0].length);
                if (endIdx === -1) endIdx = fullText.length;
                
                const newFullText = fullText.substring(0, startIdx) + editedText + "\n\n" + fullText.substring(endIdx);
                document.getElementById('sopText').value = newFullText;
            }

            saveAppState(); 
            closeEditModal(); 
            triggerGeneration(currentEditingSlotIdx);
        }

        // 健壮取图：直连(图床带CORS时) → wsrv → weserv → allorigins，逐个带 12s 超时 + 内容校验。
        // 任一命中即返回有效 image blob；全挂才抛错。
        async function fetchImageBlobBypassCORS(url) {
            const clean = url.replace(/^https?:\/\//, '');
            const attempts = [
                ...(CN_IMG_HOSTS.test(url) ? [cnImg(url, 0)] : []), // 加速节点原图（国内可达、带 CORS、有缓存）
                url, // 直连：若图床返 CORS 头（如 Firebase Storage）直接成功，最快
                `https://wsrv.nl/?url=${encodeURIComponent(clean)}&output=jpg`,          // redpanda 图：压缩jpg快
                `/api/imgproxy?url=${encodeURIComponent(url)}&fmt=jpg`,                  // aiquickdraw 图 + 兜底：同源代理压缩jpg(两个图床都支持,wsrv对aiquickdraw返400)
                `https://images.weserv.nl/?url=${encodeURIComponent(clean)}&output=jpg`
            ];
            for (const u of attempts) {
                const ctrl = new AbortController();
                // ⛑️ 2026-09-24：整张硬超时 → "卡住才超时"。GPT Image2 原图 5–6MB，慢网在固定秒数内下不完会被误杀、再落到必 400 的代理 → 漏图又慢
                let timer = setTimeout(() => ctrl.abort(), 15000);              // 15s 拿不到响应头 → 换下一个源
                const bump = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), 20000); }; // 下载中连续 20s 无新数据才放弃
                try {
                    const res = await fetch(u, { signal: ctrl.signal, mode: 'cors', cache: 'no-store' });
                    if (!res.ok) continue;
                    bump();
                    let blob;
                    if (res.body && res.body.getReader) {
                        const reader = res.body.getReader(); const chunks = [];
                        for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); bump(); }
                        blob = new Blob(chunks, { type: res.headers.get('content-type') || '' });
                    } else { blob = await res.blob(); }
                    if (blob && blob.size > 100 && blob.type.startsWith('image')) return blob;
                } catch (e) { /* 试下一个代理 */ }
                finally { clearTimeout(timer); }
            }
            throw new Error("CORS Blocked / 所有代理均失败");
        }

        // ⛑️ 结果图永久化：KIE图床(tempfile.redpandaai.co)约1天过期，隔天刷新会裂图。
        // 生成完成后 best-effort 把图转存 Firebase Storage 永久地址；失败则保留KIE临时链接，不影响当前显示。
        async function persistImagePermanent(slotIdx, kieUrl) {
            try {
                if (!kieUrl || kieUrl.startsWith('/media/') || /firebasestorage|googleusercontent|\/hyrule_persisted\//.test(kieUrl)) return;
                if (typeof firebase === 'undefined' || !firebase.storage) return;
                const blob = await fetchImageBlobBypassCORS(kieUrl);
                if (!blob || blob.size < 100) return;
                const ref = firebase.storage().ref().child('hyrule_persisted/' + Date.now() + '_' + slotIdx + '_' + Math.floor(Math.random() * 1e6) + '.jpg');
                await ref.put(blob);
                const permUrl = await ref.getDownloadURL();
                if (permUrl && imageSlots[slotIdx] && imageSlots[slotIdx].url === kieUrl) {
                    imageSlots[slotIdx].url = permUrl;
                    if (typeof saveAppState === 'function') saveAppState();
                }
            } catch (e) { console.warn('[persist] 结果图转存Firebase失败，保留KIE临时链接:', e && e.message); }
        }

        async function performMasterSwordSlash() { const sword = document.getElementById('staticSword'); playZeldaSound('slash'); sword.classList.remove('master-sword-swing'); void sword.offsetWidth; sword.classList.add('master-sword-swing'); return new Promise(r => setTimeout(() => r(), 500)); }

        function resumeKieListener(slotIdx, taskId, isInpaint = false) {
            const slot = document.getElementById(`slot-${slotIdx}`); slot.classList.remove('failed'); slot.classList.add('standby'); slot.innerHTML = `<div class="animate-pulse text-sheikah-blue italic text-xs tracking-widest font-mono py-16">重新生成中…</div>`;
            const ref = db.ref('hyrule_tasks/' + taskId);

            // ⏱️ 生图看门狗：通道卡住或 n8n 中断时不会写 Firebase，靠它把槽位置为失败而不是无限转圈
            armWatchdog('img:' + taskId, 'image', () => {
                ref.off();
                requestRefund(taskId, '生成超时');
                activeKieTasks = activeKieTasks.filter(t => t.slot !== slotIdx); saveAppState();
                renderSlotFailure(slotIdx, '生成超时', `等待超过 ${Math.round(watchdogMsFor('image')/60000)} 分钟无响应<br>超时不消耗点数，可直接重试`, false);
                if (!isInpaint && activeKieTasks.length === 0) {
                    document.getElementById('logContent').innerHTML = "<span class='text-red-400'>本批次已结束（含超时槽位）。超时不扣点数，点槽位内的「重新生图」即可重试。</span>";
                }
            });

            ref.on('value', (snapshot) => {
                const data = snapshot.val(); if (!data) return;
                if (data.status === 'completed' && data.imageUrl) {
                    clearWatchdog('img:' + taskId);
                    imageSlots[slotIdx] = { url: data.imageUrl, id: taskId }; archiveImage(slotIdx, data.imageUrl, data.prompt || ''); persistImagePermanent(slotIdx, data.imageUrl); activeKieTasks = activeKieTasks.filter(t => t.slot !== slotIdx); saveAppState();
                    renderSlot(slotIdx); slot.classList.remove('failed'); playZeldaSound('success'); ref.off();

                    // ⛑️ Bug D 修复：inpaint 单张完成不应自动截图（污染记录），只有正常 batch 全部完成才截图
                    if (!isInpaint && activeKieTasks.length === 0) {
                        document.getElementById('logContent').innerHTML = "<span class='text-zonai-yellow animate-pulse'>全部生成完成！正在自动归档记录… 📸</span>"; if (window.aquaNotify) aquaNotify('生成完成', '所有图片已生成完毕，正在自动归档', '🎉');
                        // ⛑️ Bug D 修复：删除 1500ms 延时（_preloadImagesAsBlobs 内部自己 await 图加载完）
                        if (!(window.maybeStartResultTour && window.maybeStartResultTour())) setTimeout(showRatingModal, 800);
                    }
                } else if (data.status === 'failed') {
                    clearWatchdog('img:' + taskId);
                    requestRefund(taskId, '生成失败');
                    activeKieTasks = activeKieTasks.filter(t => t.slot !== slotIdx); saveAppState();
                    renderSlotFailure(slotIdx, '生成失败', '⚡ 接口抽风导致的失败不消耗点数', false); ref.off();

                    // ⛑️ Bug E 修复：失败也算"这一槽完成了"——本批次全部 settled 时也要触发自动截图，否则一批里最后一张失败永远卡死
                    if (!isInpaint && activeKieTasks.length === 0) {
                        document.getElementById('logContent').innerHTML = "<span class='text-zonai-yellow animate-pulse'>本批次全部结束（含失败槽位），归档记录… 📸</span>";
                        if (!(window.maybeStartResultTour && window.maybeStartResultTour())) setTimeout(showRatingModal, 800);
                    }
                }
            });
        }

    // ⛑️ 截图缺图/裂图根治（2026-07-28 重写）：
    // 旧方案直接改写页面真实 <img>.src，代理并发被限流/失败时兜底又挂上失败链接 → 真实页面当场全裂。
    // 新方案：绝不碰页面真实图。先把每张图并发（限4路防限流）拉成 same-origin blob，建 src→blobUrl 映射；
    // 再交给 html2canvas 的 onclone，只在克隆副本里把 img.src 换成 blob。页面本体永远不变，代理挂了顶多某张图在截图里空着，页面不裂。
    // blob → data:base64（html2canvas 只认 data:，blob: 在其 iframe 里加载不出）
    function _blobToDataURL(blob) {
        return new Promise((resolve) => {
            try {
                const fr = new FileReader();
                fr.onload = () => resolve(fr.result);
                fr.onerror = () => resolve(null);
                fr.readAsDataURL(blob);
            } catch (e) { resolve(null); }
        });
    }

    async function _buildImageBlobMap(rootEl) {
        const seen = new Set();
        const targets = [];
        rootEl.querySelectorAll('img').forEach((img) => {
            const src = img.src;
            if (!src || seen.has(src)) return;
            if (src.startsWith('blob:') || src.startsWith('data:')) return;
            if (!/^https?:\/\//.test(src)) return;
            seen.add(src);
            targets.push(src);
        });
        const map = new Map();
        const queue = targets.slice();
        const DEADLINE = Date.now() + 15000; // 全局15s上限：绝不让"准备截图"阶段卡死后续(html2canvas/上传/飞书归档)
        async function worker() {
            while (queue.length && Date.now() < DEADLINE) {
                const src = queue.shift();
                try {
                    const blob = await fetchImageBlobBypassCORS(src);
                    const dataUrl = await _blobToDataURL(blob);   // ⛑️ 用 data: base64 而非 blob:，否则 html2canvas 的内部 iframe 加载不出→截图空白
                    if (dataUrl) map.set(src, dataUrl);
                } catch (e) {
                    console.warn('[capture] 该图代理失败，截图中留空（不影响页面）:', src);
                }
            }
        }
        const workers = Array.from({ length: 4 }, () => worker()); // 限并发4路
        // ⛑️ 硬超时兜底：最多等16s，到点带着已拿到的图继续截图，保证流程绝不卡死、飞书能收到记录
        await Promise.race([ Promise.all(workers), new Promise((res) => setTimeout(res, 16000)) ]);
        return map;
    }

    function _revokeBlobMap(map) {
        if (!map) return;
        map.forEach((blobUrl) => { try { URL.revokeObjectURL(blobUrl); } catch (_) {} });
    }

    // ⛑️ Bug I 修复：带指数退避 + 15s 超时的重试 fetch，解决 n8n webhook 偶发超时/拒绝导致截图丢失
    async function _fetchWithRetry(url, options, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000);
                const resp = await fetch(url, { ...options, signal: controller.signal });
                clearTimeout(timeoutId);
                if (resp.ok) return resp;
                if (attempt < maxRetries) {
                    const delay = 1000 * Math.pow(2, attempt - 1);
                    console.warn(`[_fetchWithRetry] 第${attempt}次HTTP ${resp.status}，${delay}ms后重试...`);
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    throw new Error(`飞书归档 ${maxRetries} 次均失败，最终状态码: ${resp.status}`);
                }
            } catch (err) {
                if (err.name === 'AbortError') err = new Error('请求超时(15s)');
                if (attempt >= maxRetries) throw err;
                const delay = 1000 * Math.pow(2, attempt - 1);
                console.warn(`[_fetchWithRetry] 第${attempt}次异常: ${err.message}，${delay}ms后重试...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }

    let _isSyncingToFeishu = false;
    let _syncWatchdogTimer = null;
    async function autoCaptureAndSyncToFeishu() {
            // ⛑️ Bug F 修复：补 NEO/YIMU 的锁 + 60s 看门狗，防重复触发 / 防卡死
            if (_isSyncingToFeishu) return;
            _isSyncingToFeishu = true;
            if (_syncWatchdogTimer) clearTimeout(_syncWatchdogTimer);
            _syncWatchdogTimer = setTimeout(() => {
                console.warn('[autoSync] watchdog 触发：60s 未完成，强制释放锁');
                _isSyncingToFeishu = false;
            }, 60000);

            const logEl = document.getElementById('logContent');
            const prodName = (document.getElementById('prodName').value || "未命名产品").trim();

            try {
                const targetEl = document.getElementById('view-adventure-log');
                const galleryWrapper = document.querySelector('.gallery-wrapper');
                const pad = document.querySelector('.purah-pad');

                const oldPadHeight = pad.style.height;
                const oldTargetHeight = targetEl.style.height;
                const oldGalleryHeight = galleryWrapper ? galleryWrapper.style.height : '';
                const oldGalleryOverflow = galleryWrapper ? galleryWrapper.style.overflow : '';

                pad.style.height = 'max-content';
                targetEl.style.height = 'max-content';
                targetEl.style.overflow = 'visible';
                if (galleryWrapper) {
                    galleryWrapper.style.height = 'max-content';
                    galleryWrapper.style.overflow = 'visible';
                }

                // 布局恢复保险：截图无论成败都必须调用，否则页面会卡在展开态、body overflow:hidden 下彻底无法滚动
                var restoreLayout = () => {
                    pad.style.height = oldPadHeight;
                    targetEl.style.height = oldTargetHeight;
                    targetEl.style.overflow = '';
                    if (galleryWrapper) {
                        galleryWrapper.style.height = oldGalleryHeight;
                        galleryWrapper.style.overflow = oldGalleryOverflow;
                    }
                };

                // ⛑️ Bug D 修复：截图前 await 所有图加载完（用 wsrv.nl 代理转 blob URL，避免 canvas tainted）
                logEl.innerHTML = "<span class='text-zonai-yellow'>📸 正在准备截图（拉取所有图片到本地）...</span>";
                const blobMap = await _buildImageBlobMap(targetEl);
                await new Promise(r => setTimeout(r, 100));

                let canvas;
                try {
                    canvas = await html2canvas(targetEl, {
                        useCORS: true,
                        imageTimeout: 8000, // ⛑️ 单图加载上限8s，防止个别图卡死整个截图
                        allowTaint: true,
                        scale: 1.5,
                        backgroundColor: '#1A1614',
                        logging: false,
                        windowHeight: targetEl.scrollHeight,
                        // 只在克隆的 DOM 里把图换成 same-origin blob，真实页面不受任何影响
                        onclone: (clonedDoc) => {
                            clonedDoc.querySelectorAll('img').forEach((img) => {
                                const blobUrl = blobMap.get(img.src);
                                if (blobUrl) { img.removeAttribute('onerror'); img.removeAttribute('crossorigin'); img.removeAttribute('loading'); img.src = blobUrl; }
                            });
                        }
                    });
                } finally {
                    // 不论截图成功失败，都要先恢复 src，再恢复布局（防止页面卡死在展开态）
                    _revokeBlobMap(blobMap);
                    restoreLayout();
                }

                // ⛑️ Bug G 修复：把 canvas.toBlob 内联回调改成 Promise，让里面的错误能被外层 catch 捕获
                const blob = await new Promise((resolve, reject) => {
                    canvas.toBlob((b) => {
                        if (!b) reject(new Error("画布 toBlob 返回空，截图失败"));
                        else resolve(b);
                    }, 'image/jpeg', 0.8);
                });

                logEl.innerHTML = "<span class='text-zonai-yellow'>记录捕获成功！正在归档至云端节点... ☁️</span>";

                const reportId = `report_${Date.now()}`;
                const storageRef = firebase.storage().ref();
                const reportRef = storageRef.child(`hyrule_reports/${reportId}.jpg`);
                await reportRef.put(blob);
                const reportImageUrl = await reportRef.getDownloadURL();

                // ⛑️ Bug C 修复：校验 Firebase Storage 真的拿到了有效 URL，否则不要把 undefined 推给 n8n
                if (!reportImageUrl || typeof reportImageUrl !== 'string' || !reportImageUrl.startsWith('http')) {
                    throw new Error('Firebase Storage getDownloadURL 返回无效值: ' + reportImageUrl);
                }

                logEl.innerHTML = "<span class='text-zonai-yellow'>云端同步完成，正在推送飞书自动化节点归档... 📡</span>";

                const payload = {
                    product_name: prodName,
                    report_url: reportImageUrl,
                    timestamp: new Date().toISOString(),
                    mission_type: document.getElementById('designScope').value,
                    mode: document.getElementById('generationMode') ? document.getElementById('generationMode').value : 'master',
                    generation_mode: document.getElementById('generationMode') ? document.getElementById('generationMode').value : 'master',
                    "模式": document.getElementById('generationMode') ? document.getElementById('generationMode').value : 'master',
                    prod_desc: document.getElementById('prodDesc').value,
                    strict_requirements: document.getElementById('strictReq').value
                };

                const response = await _fetchWithRetry(N8N_FEISHU_REPORT_WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(Object.assign({ action: 'report' }, payload))
                }, 3);

                playZeldaSound('victory');
                logEl.innerHTML = "<span class='text-zonai-teal'>✅ 生成记录已自动归档至飞书多维表格！</span>"; if (window.aquaNotify) aquaNotify('已归档', '生成记录已同步到飞书多维表格', '📁');
                setTimeout(() => { logEl.innerHTML = "等待新任务输入…"; }, 5000);

            } catch (err) {
                console.error("自动记录归档失败:", err);
                if (typeof restoreLayout === 'function') { try { restoreLayout(); } catch (_) {} }
                logEl.innerHTML = `<span class='text-red-500'>❌ 记录归档失败: ${err.message}</span>`;
            } finally {
                if (_syncWatchdogTimer) { clearTimeout(_syncWatchdogTimer); _syncWatchdogTimer = null; }
                _isSyncingToFeishu = false;
            }
        }

      // ====== triggerGeneration ======
        async function triggerGeneration(targetIdx = null) {
            if (guardGuest()) return;   // 游客/未登录：唤回登录框，不进入生成
            const text = document.getElementById('sopText').value;
            const strictReq = document.getElementById('strictReq').value;
            const scope = document.getElementById('designScope').value;
            const generationMode = document.getElementById('generationMode').value;

            // 🚀 极速狂飙模式：跳过"一键构思"步骤，主按钮直接走 ultra 路径生图
            // (满版生成走 summonAgent 的 ultra 分支；单图重绘继续走下方 /api/generate
            //  路由——api/generate 在 mode==='ultra_fast' 时会路由到 ultra-fast webhook)
            if (generationMode === 'ultra_fast' && targetIdx === null) {
                return summonAgent();
            }

            if (!scope) { triggerError('SCOPE MISSING', '请在左侧面板选择输出范围。'); return; }
            if (targetIdx === null) {
                if (globalMaterials.length === 0) { triggerError('CONNECTION REFUSED', '要素不全。如果刚刷新了网页，请重新拖入参考图片。'); return; }
                const hasMainImage = globalMaterials.some(m => m.category === '产品主体图');
                if (!hasMainImage) { triggerError('MISSING MAIN IMAGE', '非法操作！图片库中必须包含至少一张【产品主体图】才能派发作画任务！'); return; }
            }

            // 抓取一键构思生成的任务档案 ID。狂飙模式不走构思步骤，因此跳过此校验。
            const currentTaskId = window._lastAgentTaskId || activeAgentTask;
            if (generationMode !== 'ultra_fast' && !currentTaskId) {
                triggerError('NO TASK ID', '请先完整执行一次“一键构思”，生成有效任务档案后再重绘！');
                return;
            }

            const agentCost = 7;   // 构思按次收 7 点（快速/大师同价，与 api/agent.js 一致）
            if (targetIdx === null) {
                const confirmed = confirm(`将提交当前方案的图片生成任务，使用图片服务额度。\n\n确认开始生成？`);
                if (!confirmed) return;
            }

            playZeldaSound('click'); const btn = document.getElementById('mainBtn'); btn.disabled = true; btn.classList.remove('ready-to-fuse'); btn.innerHTML = `正在下发任务…`;
            switchView('adventure-log', document.getElementById('nav-notes')); document.getElementById('logContent').innerHTML = "正在向云端派发生成任务…";

            let generatedTasks = []; const batchId = Date.now();
            const titles = getCurrentSlotTitles();

            if(targetIdx === null) {
                for(let i=0; i<14; i++) { 
                    if(titles[i] !== null) {
                        imageSlots[i] = null; const taskId = `task_${batchId}_${i}`; 
                        generatedTasks.push({ slot: i, taskId: taskId, aspect_ratio: _aspectForTitle(titles[i]) }); activeKieTasks.push({ slot: i, taskId: taskId }); resumeKieListener(i, taskId); 
                    }
                }
            } else { 
                const taskId = `task_${batchId}_${targetIdx}`; generatedTasks.push({ slot: targetIdx, taskId: taskId, aspect_ratio: _aspectForTitle(titles[targetIdx]) }); activeKieTasks.push({ slot: targetIdx, taskId: taskId }); resumeKieListener(targetIdx, taskId); 
            }
            saveAppState(); 

            try {
                // 确保生图前，所有的图片都拥有【有效的】URL —— 存档里的旧链接可能已失效（Storage 文件被清理），
                // 死链接会让通道下载参考图 404，整批生图报废，所以这里探活 + 自动重传
                const _mat = await ensureMaterialUrls(globalMaterials);
                if (_mat.lost.length) {
                    triggerError('素材已失效', '以下素材的云端文件已不存在，且本地没有副本可重传：<br><b style="color:#FFD60A;">' +
                        _mat.lost.join('、') + '</b><br><br>请在左侧素材区重新上传这几张图后再生成。<br>（本次未提交，不扣点数）');
                    return;
                }
                if (_mat.revived) document.getElementById('logContent').innerHTML =
                    `<span class="text-zonai-yellow">检测到 ${_mat.revived} 张素材链接已过期，已自动重新上传，继续生成…</span>`;
                saveAppState();

                // 👑 核心修复4：只发送 URL 给 n8n，彻底解决参考图丢失问题！
                const payloadImages = globalMaterials.map(m => m.url); 
                const categorizedImages = globalMaterials.map(m => ({ filename: m.filename, url: m.url }));

                const payload = {
                    generation_mode: document.getElementById('generationMode').value,
                    sop_text: text,
                    strict_requirements: strictReq,
                    local_images_base64: [],
                    categorized_images: categorizedImages,
                    redraw_index: targetIdx,
                    firebase_tasks: generatedTasks,
                    // 输出范围（映射回 legacy 值）：后端 generate.js 按它算每张 2 点 × 张数；此前官网漏送，始终按 14 点兜底
                    design_scope: getEffectiveScope(),
                    custom_layout: (scope === 'custom' && window.__customLayout) ? { main: window.__customLayout.main|0, sub: window.__customLayout.sub|0, aplus: window.__customLayout.aplus|0, aplus_type: window.__customLayout.aplusType || 'premium' } : null,
                    slot_directives: buildSlotDirectives(),
                    // 发送我们死死咬住的暗号
                    agent_task_id: currentTaskId,
                    // ★ 5 控制旋钮（与 YIMU 字段名对齐）
                    model: document.getElementById('modelChoice')?.value,
                    channel: (document.getElementById('genChannel') ? document.getElementById('genChannel').value : 'kie') || 'kie',
                    info_density: (document.getElementById('infoDensity') ? document.getElementById('infoDensity').value : 'high') || 'high',
                    scene_intensity: (document.getElementById('sceneIntensity') ? document.getElementById('sceneIntensity').value : 'original') || 'original',
                    category: (window.__categoryState && window.__categoryState.category) || 'general',
                    category_confirmed: !!(window.__categoryState && window.__categoryState.confirmed),
                    image_allocation: (window.__categoryState && window.__categoryState.allocation) || null,
                    structure_notes: (window.__categoryState && window.__categoryState.structure_notes) || null
                };
                
                const headers = await getAuthHeader()
                if (!headers) return
                const response = await fetch('/api/generate', { method: 'POST', headers: headers, body: JSON.stringify(payload) });
                // 扣费流水号只有下单后才拿得到，所以在这里统一给本批次任务记账（失败时凭它退款）
                const _chargeId = response.headers.get('X-Request-Id');
                generatedTasks.forEach(t => rememberChargeId(t.taskId, _chargeId));
                if (response.status === 402) { btn.disabled = false; btn.classList.add('ready-to-fuse'); btn.innerHTML = `<img src="totk-what-were-your-favorite-ultrahand-creations-v0-c6lyir7oo06e1.png" class="ultrahand-icon-fixed"><span>开始生成</span>`; triggerError('点数不足', '剩余点数不够用了，请充值后继续。'); return; }
                if (!response.ok) throw new Error("HTTP 错误");
                
                btn.disabled = false; btn.innerHTML = `<img src="totk-what-were-your-favorite-ultrahand-creations-v0-c6lyir7oo06e1.png" class="ultrahand-icon-fixed"><span>开始生成</span>`;
                // 备用通道是「全部跑完一次性写回」，中途槽位不会有任何变化 —— 必须提前说清楚，
                // 否则用户会以为卡死了（默认通道则是一张张点亮）
                document.getElementById('logContent').innerHTML =
                    (payload.channel === 'flyfus')
                        ? "任务已下发（备用通道）。<span class='text-zonai-yellow'>本通道会等整套图全部生成完毕后一起显示，中途槽位没有变化是正常的</span>，请耐心等待，正常约 2-3 分钟。"
                        : "任务已下发，云端正在生成，出图会自动出现在右侧…";
            } catch (error) { 
                btn.disabled = false; btn.innerHTML = `任务已下发 (慢通道确认中)`;
                document.getElementById('logContent').innerHTML = "⚠️ 通道确认超时：任务大概率已抵达云端并在生成中，Firebase 监听保持在线，图片完成后会自动点亮。若 5 分钟后毫无动静，请重新点击生成。"; saveAppState();
            }
        }
        // ===== 评分 / 单图归档 / 单图差评 =====
function _showSimpleToast(msg, color) {
            color = color || '#30D158';
            const t = document.createElement('div');
            t.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:rgba(32,34,44,0.85);backdrop-filter:blur(30px) saturate(170%);-webkit-backdrop-filter:blur(30px) saturate(170%);border:1px solid color-mix(in srgb, '+color+' 55%, transparent);border-radius:14px;padding:14px 28px;color:#fff;font-family:inherit;font-size:13px;font-weight:700;z-index:99999;box-shadow:0 20px 60px rgba(0,0,0,0.5);transition:opacity 0.3s;';
            t.textContent = msg;
            document.body.appendChild(t);
            setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 2800);
        }

        function archiveImage(slotIdx, imageUrl, prompt) {
            if (!lastAgentTaskId || !imageUrl) return;
            const task_id = lastAgentTaskId;
            const product_name = (document.getElementById('prodName') || {}).value || '';
            const mode = (document.getElementById('generationMode') || {}).value || '';
            _archiveQueue = _archiveQueue.then(function() {
                return fetch('/api/feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'archive', task_id: task_id, slot: slotIdx, image_url: imageUrl, prompt: prompt || '', product_name: product_name, mode: mode, app_channel: APP_CHANNEL })
                }).then(function(r) {
                    if (!r.ok) console.warn('[archive] slot', slotIdx, 'HTTP', r.status);
                }).catch(function(e) {
                    console.warn('[archive] slot', slotIdx, '失败:', e && e.message);
                });
            }).catch(function() {});
            return _archiveQueue;   // 返回队列，调用方可 await 归档完成
        }

        function showRatingModal() {
            if (!lastAgentTaskId) { _showSimpleToast('⚠️ 本次没有可评价的任务', '#FFD700'); return; }
            if (document.getElementById('_ratingModalOverlay')) return; // 防重复
            let _score = 0;
            const overlay = document.createElement('div');
            overlay.id = '_ratingModalOverlay';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(8,9,14,0.5);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);z-index:10000;display:flex;align-items:center;justify-content:center;';
            const box = document.createElement('div');
            box.style.cssText = 'background:linear-gradient(160deg,rgba(56,60,80,0.62),rgba(30,32,44,0.72));backdrop-filter:blur(60px) saturate(200%) brightness(1.12);-webkit-backdrop-filter:blur(60px) saturate(200%) brightness(1.12);border:1px solid rgba(255,255,255,0.16);border-radius:22px;padding:32px 36px;min-width:340px;max-width:90vw;font-family:inherit;color:#fff;box-shadow:0 40px 100px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.12);animation:materialize 0.4s var(--spring);';
            box.innerHTML = `
                <div style="font-size:16px;font-weight:800;color:#fff;margin-bottom:20px;text-align:center;">本次生成整体评价</div>
                <div id="_ratingStars" style="display:flex;justify-content:center;gap:10px;margin-bottom:20px;cursor:pointer;">
                    ${[1,2,3,4,5].map(n=>`<svg id="_star${n}" data-v="${n}" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="1.5" style="transition:all 0.15s;"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`).join('')}
                </div>
                <textarea id="_ratingComment" placeholder="可不填（补充评语）" style="width:100%;height:72px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:12px;color:#fff;font-family:inherit;font-size:12px;padding:10px;resize:none;outline:none;box-sizing:border-box;margin-bottom:18px;"></textarea>
                <div style="display:flex;gap:12px;justify-content:center;">
                    <button id="_ratingSubmit" class="modal-btn modal-btn-confirm" style="flex:1;padding:10px 0;font-size:13px;">提交评价</button>
                    <button id="_ratingSkip" class="modal-btn modal-btn-cancel" style="flex:1;padding:10px 0;font-size:13px;">稍后再说</button>
                </div>`;
            overlay.appendChild(box);
            document.body.appendChild(overlay);

            // 星星点击高亮
            const starsEl = document.getElementById('_ratingStars');
            starsEl.addEventListener('click', function(e) {
                const sv = e.target.closest('svg');
                if (!sv) return;
                _score = parseInt(sv.getAttribute('data-v'), 10);
                for (let i = 1; i <= 5; i++) {
                    const s = document.getElementById('_star' + i);
                    if (i <= _score) { s.setAttribute('fill','#FFD700'); s.setAttribute('stroke','#FFD700'); }
                    else { s.setAttribute('fill','none'); s.setAttribute('stroke','#555'); }
                }
            });

            document.getElementById('_ratingSkip').addEventListener('click', function() {
                overlay.remove();
            });

            document.getElementById('_ratingSubmit').addEventListener('click', function() {
                if (_score < 1) { _showSimpleToast('请先点击星星打分 ⭐', '#FFD700'); return; }
                const comment = (document.getElementById('_ratingComment').value || '').trim();
                const task_id = lastAgentTaskId;
                const btn = document.getElementById('_ratingSubmit');
                btn.disabled = true; btn.textContent = '提交中...';
                fetch('/api/feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'rating', task_id: task_id, score: _score, comment: comment, app_channel: APP_CHANNEL })
                }).then(function(r) {
                    if (r.ok) {
                        overlay.remove();
                        _showSimpleToast('✅ 评价已保存在本机', '#00FFC5');
                    } else {
                        btn.disabled = false; btn.textContent = '提交评价';
                        _showSimpleToast('❌ 提交失败 HTTP ' + r.status, '#ef4444');
                    }
                }).catch(function(e) {
                    btn.disabled = false; btn.textContent = '提交评价';
                    _showSimpleToast('❌ 网络错误: ' + (e && e.message), '#ef4444');
                });
            });

            // 点击遮罩关闭
            overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
        }

        async function downvoteImage(slotIdx, btnEl) {
            if (!lastAgentTaskId) { _showSimpleToast('⚠️ 本次没有可评价的任务', '#FFD700'); return; }
            try { await _archiveQueue; } catch (e) {}   // 等待该图归档完成，否则飞书里还没这行，差评会静默丢失
            const newState = !window.__downvoted[slotIdx];
            window.__downvoted[slotIdx] = newState;
            try {
                const r = await fetch('/api/feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'downvote', task_id: lastAgentTaskId, slot: slotIdx, downvote: newState, app_channel: APP_CHANNEL })
                });
                if (r.ok) {
                    if (!btnEl) { /* 无按钮引用(程序化调用)，跳过样式切换 */ }
                    else if (newState) {
                        btnEl.style.color = '#ef4444'; btnEl.style.borderColor = '#ef4444';
                        btnEl.style.background = 'rgba(239,68,68,0.15)';
                        btnEl.title = '取消差评';
                    } else {
                        btnEl.style.color = ''; btnEl.style.borderColor = '';
                        btnEl.style.background = '';
                        btnEl.title = '差评此图';
                    }

                } else {
                    window.__downvoted[slotIdx] = !newState; // 回滚
                    _showSimpleToast('❌ 差评失败 HTTP ' + r.status, '#ef4444');
                }
            } catch (e) {
                window.__downvoted[slotIdx] = !newState;
                console.warn('[downvote]', e && e.message);
            }
        }

        function renderSlot(idx) {
            const slot = document.getElementById(`slot-${idx}`); 
            if(!slot) return; 
            slot.classList.remove('standby'); const data = imageSlots[idx];
            
            const displayUrl = data.history ? data.history[data.currentIndex] : data.url;

            slot.innerHTML = `
                <img src="${cnImg(displayUrl, 1200)}" data-o="${displayUrl}" referrerpolicy="no-referrer" loading="lazy" onerror="if(cnFallback(this)) return; const r=+(this.dataset.r||0); if(r<2){ this.dataset.r=r+1; const s=this.src.split('?_r=')[0]; setTimeout(()=>{ this.src=s+'?_r='+(r+1); }, 1500*(r+1)); } else { this.parentElement.innerHTML='<div class=\\'text-red-500 text-xs font-mono p-4\\'>图片加载失败，请点击 RETRY 或刷新</div>'; }">
                <div class="slot-actions" style="flex-direction: column; gap: 8px; padding: 10px;">
                    <div class="flex items-center justify-between gap-2 w-full">
                        
                        <div class="relative group flex-1">
                            <button onclick="openInpaintModal(${idx})" class="w-full py-1.5 border border-[#00D4FF] text-[#00D4FF] bg-transparent rounded-md font-black tracking-widest uppercase text-[10px] hover:bg-[#00D4FF]/20 transition-all duration-200">
                                INPAINT
                            </button>
                            <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-[140px] bg-black/95 text-[#00D4FF] text-[10px] text-center py-2 px-2 rounded-lg border border-[#00D4FF]/40 z-50 font-['PingFang SC'] leading-relaxed shadow-[0_0_15px_rgba(0,212,255,0.3)]">
                                在图片的基础上画圈写文字修复细节重新绘图
                            </div>
                        </div>
                        
                        <div class="relative group flex-1">
                            <button onclick="triggerGeneration(${idx})" class="w-full py-1.5 border border-[#00D4FF] text-[#00D4FF] bg-transparent rounded-md font-black tracking-widest uppercase text-[10px] hover:bg-[#00D4FF]/20 transition-all duration-200">
                                REDRAW
                            </button>
                            <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-[140px] bg-black/95 text-[#00D4FF] text-[10px] text-center py-2 px-2 rounded-lg border border-[#00D4FF]/40 z-50 font-['PingFang SC'] leading-relaxed shadow-[0_0_15px_rgba(0,212,255,0.3)]">
                                总体没问题！氪金大佬直接抽卡
                            </div>
                        </div>
                    </div>
                    <div class="w-full flex items-center gap-2">
                        <div class="relative group shrink-0">
                            <button id="dv-btn-${idx}" onclick="downvoteImage(${idx}, this)" class="py-1.5 px-2.5 border border-[#00D4FF] text-[#00D4FF] bg-transparent rounded-md text-[13px] leading-none hover:bg-red-500/20 hover:border-red-400 hover:text-red-400 transition-all duration-200">👎</button>
                            <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-[150px] bg-black/95 text-[#00D4FF] text-[10px] text-center py-2 px-2 rounded-lg border border-[#00D4FF]/40 z-50 font-['PingFang SC'] leading-relaxed shadow-[0_0_15px_rgba(0,212,255,0.3)]">
                                这张不满意，记入飞书用于分析问题提示词
                            </div>
                        </div>
                        <button onclick="downloadSingle(${idx})" class="flex-1 py-1.5 border border-[#00D4FF] text-[#00D4FF] bg-transparent rounded-md font-black tracking-widest uppercase text-[10px] hover:bg-[#00D4FF]/20 transition-all duration-200 flex items-center justify-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            DOWNLOAD
                        </button>
                    </div>
                </div>`;
            if (typeof updateMobileBtnVisibility === 'function') updateMobileBtnVisibility();
        }

        async function downloadSingle(idx) { const img = imageSlots[idx]; if(!img) return; await performMasterSwordSlash(); try { const blob = await fetchImageBlobBypassCORS(img.url); const blobUrl = window.URL.createObjectURL(blob); const a = document.createElement('a'); a.style.display = 'none'; a.href = blobUrl; a.download = `artifact_${idx}_${Date.now()}.jpg`; document.body.appendChild(a); a.click(); setTimeout(() => { window.URL.revokeObjectURL(blobUrl); document.body.removeChild(a); }, 500); } catch (e) { window.open(img.url, '_blank'); } }
        // ── 一键打包下载（2026-09-23 与内部版对齐，保留官网 triggerSuccess 反馈）──
        // 修的问题：①单张拉取失败只 console.warn，用户拿到少图的 zip 却不知情 ②文件名 artifact_N 看不出是哪张
        // 做法：桌面图（+ 若有手机版图）一起收；失败的图隔 1.5s 再试一轮；文件名带序号 + 模块名；
        //       打包完给明确汇总（成功几张 / 哪几张漏了 / 该怎么办）；还有图在生成中也会提前说明。
        function _safeFileName(s) { return String(s || '').replace(/【|】/g, '').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40); }
        async function _fetchBlobWithRetry(url, rounds) {
            let lastErr = null;
            for (let r = 0; r < rounds; r++) {
                try { return await fetchImageBlobBypassCORS(url); }
                catch (e) { lastErr = e; if (r < rounds - 1) await new Promise(res => setTimeout(res, 1500)); }
            }
            throw lastErr || new Error('fetch failed');
        }
        async function _normalizeMobileBlob(blob) {
            const bmp = await createImageBitmap(blob);
            const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 900;
            canvas.getContext('2d').drawImage(bmp, 0, 0, 1200, 900);
            return await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob null')), 'image/jpeg', 0.95));
        }
        async function batchDownloadAll() {
            const ultraC = document.getElementById('ultraBatchBtnContainer');
            const container = (ultraC && ultraC.offsetParent) ? ultraC : document.getElementById('batchBtnContainer');
            const subtitle = container ? container.querySelector('.btn-split-bottom') : null;
            const subtitleOrig = subtitle ? subtitle.textContent : '';
            const titles = (typeof getCurrentSlotTitles === 'function') ? (getCurrentSlotTitles() || []) : [];
            const items = [];
            (imageSlots || []).forEach((img, i) => { if (img && img.url) items.push({ url: img.url, name: `${String(i + 1).padStart(2, '0')}_${_safeFileName(titles[i]) || 'image'}.jpg`, mobile: false }); });
            (typeof mobileSlots !== 'undefined' && Array.isArray(mobileSlots) ? mobileSlots : []).forEach((img, i) => { if (img && img.url) items.push({ url: img.url, name: `mobile_${String(i + 1).padStart(2, '0')}_1200x900.jpg`, mobile: true }); });
            if (items.length === 0) { playZeldaSound('error'); if (window.aquaNotify) aquaNotify('还没有可打包的图', '等图片生成完成后再点打包', '📦'); return; }
            const pendingN = (typeof activeKieTasks !== 'undefined' && activeKieTasks) ? activeKieTasks.length : 0;
            if (pendingN > 0 && window.aquaNotify) aquaNotify('还有图在生成中', `本次只打包已完成的 ${items.length} 张；剩下 ${pendingN} 张生成完后可再打包一次`, '⏳');
            await performMasterSwordSlash();
            if (container) container.classList.add('slashed');
            let done = 0; const failed = [];
            const setProgress = () => { if (subtitle) subtitle.textContent = `📦 正在打包 ${done}/${items.length}… 图较大需时间，请耐心等待`; };
            setProgress();
            try {
                const zip = new JSZip();
                const queue = items.slice();
                async function worker() {
                    while (queue.length) {
                        const it = queue.shift();
                        try {
                            let blob = await _fetchBlobWithRetry(it.url, 2);
                            if (it.mobile) { try { blob = await _normalizeMobileBlob(blob); } catch (_e) { /* 归一失败就放原图 */ } }
                            zip.file(it.name, blob);
                        } catch (e) { failed.push(it); console.warn('[batch] 拉取失败:', it.name, it.url, e && e.message); }
                        done++; setProgress();
                    }
                }
                await Promise.all(Array.from({ length: 6 }, () => worker()));
                const okN = items.length - failed.length;
                if (okN === 0) {
                    triggerError('ARCHIVE FAILED', '所有图片都拉取失败，链接可能已过期。请先硬刷新页面再试；仍失败的图请点「重新生图」后再打包。');
                    return;
                }
                const content = await zip.generateAsync({ type: 'blob' });
                const zipUrl = URL.createObjectURL(content);
                const a = document.createElement('a'); a.style.display = 'none'; a.href = zipUrl;
                a.download = `AUPlus_${new Date().toISOString().slice(0, 10)}_${okN}pics.zip`;
                document.body.appendChild(a); a.click();
                setTimeout(() => { URL.revokeObjectURL(zipUrl); document.body.removeChild(a); }, 500);
                if (failed.length === 0) {
                    triggerSuccess('打包完成 🎉', '<b style="color:#fff;">全部 ' + okN + ' 张</b>成品已打包，已开始下载，请查看浏览器下载文件夹。');
                } else {
                    const names = failed.map(f => f.name.replace(/\.jpg$/, '')).join('、');
                    triggerSuccess('打包完成，但漏了 ' + failed.length + ' 张', 'zip 里有 <b style="color:#fff;">' + okN + '</b> 张，已开始下载。<br><br>拉取失败：<b style="color:#FFD60A;">' + names + '</b><br>这几张的链接可能已过期，对它们单独「重新生图」后再打包一次即可。');
                }
            } catch (e) {
                console.error('[batch]', e);
                triggerError('ARCHIVE FAILED', '打包过程出错：' + (e && e.message ? e.message : '未知错误') + '。请刷新后重试。');
            } finally {
                if (subtitle) subtitle.textContent = subtitleOrig;
                setTimeout(() => { if (container) container.classList.remove('slashed'); }, 800);
            }
        }

        // ⚡ 极速飙车专属 gallery 构建
        function buildUltraGalleryLayout() {
            const scope = document.getElementById('designScope').value;
            const container = document.getElementById('ultraGalleryContainer');
            if (!scope) { container.innerHTML = ''; return; }
            const titles = getCurrentSlotTitles();
            let slots = [];
            if (scope === 'ultra_main_8' || scope === 'ultra_old_aplus_4' || scope === 'ultra_premium_aplus_5') {
                if (titles[0]) slots.push({ idx: 0, title: titles[0] });
            }
            let html = '<div class="ultra-single-col custom-scrollbar">';
            slots.forEach(({ idx, title }) => { html += buildUltraSlotHtml(idx, title); });
            html += '</div>';
            container.innerHTML = html;
        }

        function buildUltraSlotHtml(idx, titleName) {
            const cleanTitle = titleName.replace(/【|】/g, '');
            return `
            <div class="ultra-card" id="ultra-slot-${idx}">
                <div class="ultra-card-label font-mono text-[10px] uppercase tracking-widest opacity-50" style="color:#00FFC5;">
                    SLOT ${idx} · ${cleanTitle}
                </div>
                <div class="ultra-card-img-wrap">
                    <div class="opacity-20 italic text-xs tracking-widest font-mono text-center pt-10" style="color:#00FFC5;">STANDBY...</div>
                </div>
            </div>`;
        }

        // ⚡ 极速专属监听器：写入 ultra-slot-{idx}
        function resumeUltraKieListener(slotIdx, taskId) {
            const slot = document.getElementById(`ultra-slot-${slotIdx}`);
            if (!slot) return;
            const imgWrap = slot.querySelector('.ultra-card-img-wrap');
            if (imgWrap) imgWrap.innerHTML = `<div class="animate-pulse italic text-xs tracking-widest font-mono text-center pt-10" style="color:#00FFC5;">生成中…</div>`;
            const ref = db.ref('hyrule_tasks/' + taskId);

            // ⏱️ 极速看门狗：同上，避免通道卡住时无限转圈
            armWatchdog('img:' + taskId, 'image', () => {
                ref.off();
                requestRefund(taskId, '生成超时');
                activeKieTasks = activeKieTasks.filter(t => t.slot !== slotIdx); saveAppState();
                renderSlotFailure(slotIdx, '生成超时', `等待超过 ${Math.round(watchdogMsFor('image')/60000)} 分钟无响应<br>超时不消耗点数，可直接重试`, true);
                if (activeKieTasks.length === 0) {
                    const el = document.getElementById('ultraLogContent');
                    if (el) el.innerHTML = "<span style='color:#f87171;'>本批次已结束（含超时槽位）。超时不扣点数，可直接重试。</span>";
                }
            });

            ref.on('value', (snapshot) => {
                const data = snapshot.val(); if (!data) return;
                if (data.status === 'completed' && data.imageUrl) {
                    clearWatchdog('img:' + taskId);
                    imageSlots[slotIdx] = { url: data.imageUrl, id: taskId, finalPrompt: data.prompt || '无Prompt数据' }; archiveImage(slotIdx, data.imageUrl, data.prompt || ''); persistImagePermanent(slotIdx, data.imageUrl);
                    activeKieTasks = activeKieTasks.filter(t => t.slot !== slotIdx); saveAppState();
                    renderUltraSlot(slotIdx); slot.classList.remove('failed'); playZeldaSound('success'); ref.off();
                    if (activeKieTasks.length === 0) {
                        document.getElementById('ultraLogContent').innerHTML = "<span style='color:#FFD700;' class='animate-pulse'>所有极速任务已完成🎉</span>";
                    }
                } else if (data.status === 'failed') {
                    clearWatchdog('img:' + taskId);
                    requestRefund(taskId, '生成失败');
                    activeKieTasks = activeKieTasks.filter(t => t.slot !== slotIdx); saveAppState();
                    renderSlotFailure(slotIdx, '生成失败', '⚡ 接口抽风导致的失败不消耗点数', true); ref.off();
                }
            });
        }

        // ⚡ 极速 slot 渲染：全宽大图，带裁切/下载按钮
        function renderUltraSlot(idx) {
            const data = imageSlots[idx]; if (!data) return;
            const slot = document.getElementById(`ultra-slot-${idx}`); if (!slot) return;
            slot.classList.remove('standby', 'failed');
            const imgWrap = slot.querySelector('.ultra-card-img-wrap');
            if (imgWrap) {
                imgWrap.innerHTML = `<img src="${cnImg(data.url, 1200)}" data-o="${data.url}" class="ultra-card-img" loading="lazy" referrerpolicy="no-referrer" onerror="if(cnFallback(this)) return; this.parentElement.innerHTML='<div class=\\'text-red-500 text-xs font-mono p-4\\'>图片加载失败</div>'">`;
                const card = imgWrap.parentElement;
                let actionsEl = card.querySelector('.ultra-card-actions');
                if (!actionsEl) {
                    actionsEl = document.createElement('div');
                    actionsEl.className = 'ultra-card-actions';
                    card.appendChild(actionsEl);
                }
                actionsEl.innerHTML = `<button onclick="openCropModalFromSlot(${idx})" class="ultra-action-btn border-zonai-yellow text-zonai-yellow">✂️ 裁切</button>
                    <button onclick="downloadSingleImage(${idx})" class="ultra-action-btn" style="border-color:#00FFC5;color:#00FFC5;">⬇ 下载</button>
                    <button onclick="openInpaintModal(${idx})" class="ultra-action-btn" style="border-color:#FFD700;color:#FFD700;">⚡ INPAINT</button>`;
            }
            saveAppState();
        }

        function downloadSingleImage(idx) {
            const data = imageSlots[idx]; if (!data) return;
            const a = document.createElement('a'); a.href = data.url; a.download = `ultra_artifact_${idx}_${Date.now()}.jpg`; a.target = '_blank'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
        }

        // ===== 裁切工具 =====
        let currentCropIdx = -1;
        let cropMode = 'smart';

        function openCropModalFromSlot(idx) {
            playZeldaSound('click');
            const data = imageSlots[idx];
            if (!data) return;
            currentCropIdx = idx;
            const img = document.getElementById('cropBaseImg');
            img.src = data.url.startsWith("/media/") ? data.url : "/api/imgproxy?url=" + encodeURIComponent(data.url);
            document.getElementById('cropResultsGrid').innerHTML = '';
            document.getElementById('cropResultCount').innerText = 'READY';
            manualBoxPos = { x: 0, y: 0 };
            document.getElementById('cropModal').style.display = 'flex';
            img.onload = () => {
                if (cropMode === 'smart') executeSmartCrop();
                else updateManualBox();
            };
        }

        function closeCropModal() {
            playZeldaSound('click');
            document.getElementById('cropModal').style.display = 'none';
        }

        function switchCropMode(mode) {
            playZeldaSound('click');
            cropMode = mode;
            document.getElementById('btnModeSmart').className = mode === 'smart' ? 'flex-1 py-2 text-xs font-bold rounded-lg transition-all crop-btn-active' : 'flex-1 py-2 text-xs font-bold rounded-lg transition-all text-gray-500';
            document.getElementById('btnModeManual').className = mode === 'manual' ? 'flex-1 py-2 text-xs font-bold rounded-lg transition-all crop-btn-active' : 'flex-1 py-2 text-xs font-bold rounded-lg transition-all text-gray-500';
            document.getElementById('panelSmart').classList.toggle('hidden', mode !== 'smart');
            document.getElementById('panelManual').classList.toggle('hidden', mode !== 'manual');
            document.getElementById('manualBox').classList.toggle('hidden', mode !== 'manual');
            if (mode === 'manual') updateManualBox();
        }

        function executeSmartCrop() {
            const img = document.getElementById('cropBaseImg');
            if (!img || !img.naturalWidth) return;
            const tolerance = parseInt(document.getElementById('cropTolerance').value);
            const canvas = document.createElement('canvas');
            const w = img.naturalWidth, h = img.naturalHeight;
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, w, h);
            const imgData = ctx.getImageData(0, 0, w, h).data;
            const isRowBg = (y) => { let c=0; for(let x=0;x<w;x++){const i=(y*w+x)*4; if(imgData[i]>=tolerance&&imgData[i+1]>=tolerance&&imgData[i+2]>=tolerance)c++;} return c>w*0.98; };
            const isColBg = (x) => { let c=0; for(let y=0;y<h;y++){const i=(y*w+x)*4; if(imgData[i]>=tolerance&&imgData[i+1]>=tolerance&&imgData[i+2]>=tolerance)c++;} return c>h*0.98; };
            const findSegs = (len, fn) => { const s=[]; let inC=false,st=0; for(let i=0;i<len;i++){if(!fn(i)&&!inC){st=i;inC=true;}else if(fn(i)&&inC){s.push({start:st,end:i-1});inC=false;}} if(inC)s.push({start:st,end:len-1}); return s; };
            const rowSegs = findSegs(h, isRowBg), colSegs = findSegs(w, isColBg);
            const grid = document.getElementById('cropResultsGrid'); grid.innerHTML='';
            const overlay = document.getElementById('smartBoxesOverlay'); overlay.innerHTML='';
            let count = 0;
            rowSegs.forEach((row) => { colSegs.forEach((col) => {
                const cropW=col.end-col.start, cropH=row.end-row.start;
                if(cropW<w*0.05||cropH<h*0.05) return;
                const boxDiv=document.createElement('div'); boxDiv.className='smart-box';
                boxDiv.style.cssText=`left:${(col.start/w)*100}%;top:${(row.start/h)*100}%;width:${(cropW/w)*100}%;height:${(cropH/h)*100}%;`;
                const label=document.createElement('span'); label.style.cssText='position:absolute;top:-20px;left:0;background:#ff4444;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;font-weight:900;'; label.textContent=`区域 ${count+1}`; boxDiv.appendChild(label); overlay.appendChild(boxDiv);
                const cropCanvas=document.createElement('canvas'); cropCanvas.width=cropW; cropCanvas.height=cropH;
                cropCanvas.getContext('2d').drawImage(img,col.start,row.start,cropW,cropH,0,0,cropW,cropH);
                const dataUrl=cropCanvas.toDataURL('image/jpeg',1.0);
                const thumb=document.createElement('div'); thumb.className='bg-black/40 border border-zonai-teal/30 rounded-lg overflow-hidden relative';
                const dlBtn=document.createElement('a'); dlBtn.href=dataUrl; dlBtn.download=`smart_crop_${count+1}.jpg`; dlBtn.title='下载'; dlBtn.style.cssText='position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.7);color:#00FFC5;padding:3px 7px;border-radius:6px;font-size:11px;text-decoration:none;z-index:10;border:1px solid rgba(0,255,197,0.4);'; dlBtn.textContent='↓';
                thumb.innerHTML=`<img src="${dataUrl}" class="w-full h-auto"><span style="position:absolute;top:4px;left:4px;background:rgba(0,0,0,0.6);color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;">图${count+1}</span>`;
                thumb.appendChild(dlBtn); grid.appendChild(thumb); count++;
            }); });
            if(count===0){triggerError('CROP FAILED','未检测到内容区域，请尝试降低容差值');return;}
            document.getElementById('cropResultCount').innerText=`DETECTED: ${count}`;
        }

        let manualBoxPos = { x: 0, y: 0 };
        let manualBoxWidthPercent = 50;
        let manualIsDragging = false;
        let manualDragRef = { startX: 0, startY: 0, initialX: 0, initialY: 0 };

        const manualConfigs = {
            old: { w: 970, h: 600, slices: 4 },
            premium: { w: 1464, h: 600, slices: 5 }
        };

        function updateManualBox() {
            const img = document.getElementById('cropBaseImg');
            const box = document.getElementById('manualBox');
            if (!img || !box) return;
            const type = document.querySelector('input[name="cropType"]:checked').value;
            manualBoxWidthPercent = parseInt(document.getElementById('cropWidthPercent').value);
            const ratio = manualConfigs[type].w / manualConfigs[type].h;
            const slices = manualConfigs[type].slices;
            const clientImgW = img.clientWidth, clientImgH = img.clientHeight;
            let currentBoxW = (clientImgW * manualBoxWidthPercent) / 100;
            let currentBoxH = currentBoxW / ratio;
            let totalBoxH = currentBoxH * slices;
            if (totalBoxH > clientImgH) { totalBoxH=clientImgH; currentBoxH=totalBoxH/slices; currentBoxW=currentBoxH*ratio; }
            const maxX=clientImgW-currentBoxW, maxY=clientImgH-totalBoxH;
            manualBoxPos.x=Math.max(0,Math.min(manualBoxPos.x,maxX)); manualBoxPos.y=Math.max(0,Math.min(manualBoxPos.y,maxY));
            box.style.width=currentBoxW+'px'; box.style.height=totalBoxH+'px'; box.style.left=manualBoxPos.x+'px'; box.style.top=manualBoxPos.y+'px';
            box.innerHTML='';
            for(let i=0;i<slices;i++){const row=document.createElement('div'); row.style.cssText=`position:relative;width:100%;height:${currentBoxH}px;${i<slices-1?'border-bottom:1px dashed rgba(0,212,255,0.5);':''}background:rgba(0,212,255,0.05);`; const label=document.createElement('div'); label.style.cssText='position:absolute;left:4px;top:4px;background:#4f46e5;color:#fff;font-size:10px;font-weight:900;width:18px;height:18px;border-radius:3px;display:flex;align-items:center;justify-content:center;'; label.textContent=i+1; row.appendChild(label); box.appendChild(row);}
        }

        function executeManualCrop() {
            const img = document.getElementById('cropBaseImg');
            const box = document.getElementById('manualBox');
            if (!img || !box) return;
            const type = document.querySelector('input[name="cropType"]:checked').value;
            const slices = manualConfigs[type].slices;
            const scaleX = img.naturalWidth / img.clientWidth;
            const scaleY = img.naturalHeight / img.clientHeight;
            const boxL=parseFloat(box.style.left)||0, boxT=parseFloat(box.style.top)||0;
            const boxW=parseFloat(box.style.width)||0, boxH=parseFloat(box.style.height)||0;
            const sliceH = boxH / slices;
            const grid = document.getElementById('cropResultsGrid'); grid.innerHTML='';
            for(let i=0;i<slices;i++){
                const sx=Math.round(boxL*scaleX), sy=Math.round((boxT+sliceH*i)*scaleY);
                const sw=Math.round(boxW*scaleX), sh=Math.round(sliceH*scaleY);
                const cropCanvas=document.createElement('canvas'); cropCanvas.width=sw; cropCanvas.height=sh;
                cropCanvas.getContext('2d').drawImage(img,sx,sy,sw,sh,0,0,sw,sh);
                const dataUrl=cropCanvas.toDataURL('image/jpeg',1.0);
                const thumb=document.createElement('div'); thumb.className='bg-black/40 border border-zonai-teal/30 rounded-lg overflow-hidden relative';
                const dlBtn=document.createElement('a'); dlBtn.href=dataUrl; dlBtn.download=`manual_crop_${i+1}.jpg`; dlBtn.title='下载'; dlBtn.style.cssText='position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.7);color:#00FFC5;padding:3px 7px;border-radius:6px;font-size:11px;text-decoration:none;z-index:10;border:1px solid rgba(0,255,197,0.4);'; dlBtn.textContent='↓';
                thumb.innerHTML=`<img src="${dataUrl}" class="w-full h-auto"><span style="position:absolute;top:4px;left:4px;background:rgba(0,0,0,0.6);color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;">切片${i+1}</span>`;
                thumb.appendChild(dlBtn); grid.appendChild(thumb);
            }
            document.getElementById('cropResultCount').innerText=`SLICED: ${slices}`;
        }

        // 手动框拖拽事件
        (function setupManualDrag() {
            document.addEventListener('DOMContentLoaded', () => {
                const box = document.getElementById('manualBox');
                if (!box) return;
                box.addEventListener('mousedown', (e) => {
                    manualIsDragging=true; manualDragRef={startX:e.clientX,startY:e.clientY,initialX:manualBoxPos.x,initialY:manualBoxPos.y};
                    e.preventDefault();
                });
                document.addEventListener('mousemove', (e) => {
                    if(!manualIsDragging) return;
                    manualBoxPos.x=manualDragRef.initialX+(e.clientX-manualDragRef.startX);
                    manualBoxPos.y=manualDragRef.initialY+(e.clientY-manualDragRef.startY);
                    updateManualBox();
                });
                document.addEventListener('mouseup', () => { manualIsDragging=false; });
            });
        })();

        function downloadAllCrops() {
            const imgs = document.querySelectorAll('#cropResultsGrid img');
            if (imgs.length === 0) return;
            imgs.forEach((img, i) => {
                setTimeout(() => {
                    const a = document.createElement('a');
                    a.href = img.src;
                    a.download = `crop_${currentCropIdx}_${i + 1}.jpg`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                }, i * 300);
            });
        }

        let inpaintSlotIdx = -1;
        let isDrawing = false;
        let canvasPaths = []; 
        let currentPath = [];
        let currentBrushColor = '#FF3333'; 

        const inpaintCanvas = document.getElementById('inpaintCanvas');
        const inpaintCtx = inpaintCanvas.getContext('2d', { willReadFrequently: true });
        const inpaintImg = document.getElementById('inpaintBaseImg');

        function changeBrushColor(color) { playZeldaSound('click'); currentBrushColor = color; }

        function openInpaintModal(idx) {
            playZeldaSound('click');
            inpaintSlotIdx = idx;
            const data = imageSlots[idx];
            if(!data) return;

            if(!data.history) { data.history = [data.url]; data.currentIndex = 0; }
            document.getElementById('inpaintSlotTitle').innerText = `[ Slot ${idx} ]`;
            document.getElementById('inpaintPrompt').value = ''; 
            loadInpaintImage(data.history[data.currentIndex]); updateHistoryUI(data);
            document.getElementById('inpaintModal').classList.add('show');
        }

        function loadInpaintImage(url) {
            // 🛡️ 自建同源代理：支持 KIE 两个图床(redpanda + aiquickdraw)且带 CORS 头，画布不污染。
            //    原来直连 wsrv.nl 对 aiquickdraw 的图返 400 → 画布空白看不见图。wsrv(去协议)降级为后备。
            const proxyUrl = CN_IMG_HOSTS.test(url) ? cnImg(url, 0) : "/api/imgproxy?url=" + encodeURIComponent(url);
            inpaintImg.crossOrigin = "anonymous";
            inpaintImg.src = proxyUrl;

            inpaintImg.onload = () => {
                inpaintCanvas.width = inpaintImg.clientWidth;
                inpaintCanvas.height = inpaintImg.clientHeight;
                clearCanvas();
            };
            inpaintImg.onerror = () => { inpaintImg.src = "https://wsrv.nl/?url=" + encodeURIComponent(url.replace(/^https?:\/\//, '')) + "&output=jpg"; };
        }

        function closeInpaintModal() { playZeldaSound('click'); document.getElementById('inpaintModal').classList.remove('show'); }

        function getMousePos(evt) { const rect = inpaintCanvas.getBoundingClientRect(); return { x: evt.clientX - rect.left, y: evt.clientY - rect.top }; }
        inpaintCanvas.addEventListener('mousedown', (e) => { isDrawing = true; currentPath = [{ x: getMousePos(e).x, y: getMousePos(e).y }]; });
        inpaintCanvas.addEventListener('mousemove', (e) => { if (!isDrawing) return; currentPath.push({ x: getMousePos(e).x, y: getMousePos(e).y }); redrawCanvas(); });
        inpaintCanvas.addEventListener('mouseup', () => { if(!isDrawing) return; isDrawing = false; if (currentPath.length > 0) { canvasPaths.push({ path: currentPath, size: document.getElementById('brushSize').value, color: currentBrushColor }); } currentPath = []; });
        inpaintCanvas.addEventListener('mouseout', () => { isDrawing = false; });

        function redrawCanvas() {
            inpaintCtx.clearRect(0, 0, inpaintCanvas.width, inpaintCanvas.height);
            inpaintCtx.lineCap = 'round'; inpaintCtx.lineJoin = 'round';
            canvasPaths.forEach(stroke => {
                inpaintCtx.lineWidth = stroke.size; inpaintCtx.strokeStyle = stroke.color;
                inpaintCtx.beginPath(); inpaintCtx.moveTo(stroke.path[0].x, stroke.path[0].y);
                stroke.path.forEach(point => inpaintCtx.lineTo(point.x, point.y)); inpaintCtx.stroke();
            });
            if (currentPath.length > 0) {
                inpaintCtx.lineWidth = document.getElementById('brushSize').value; inpaintCtx.strokeStyle = currentBrushColor;
                inpaintCtx.beginPath(); inpaintCtx.moveTo(currentPath[0].x, currentPath[0].y);
                currentPath.forEach(point => inpaintCtx.lineTo(point.x, point.y)); inpaintCtx.stroke();
            }
        }

        function clearCanvas() { canvasPaths = []; currentPath = []; inpaintCtx.clearRect(0, 0, inpaintCanvas.width, inpaintCanvas.height); }
        function undoBrush() { canvasPaths.pop(); redrawCanvas(); }

        function updateHistoryUI(data) {
            const controls = document.getElementById('historyControls');
            if(data.history.length > 1) { controls.classList.remove('hidden'); document.getElementById('historyIndicator').innerText = `V.${data.currentIndex + 1} / ${data.history.length}`; } else { controls.classList.add('hidden'); }
        }

        function prevHistory() { playZeldaSound('click'); const data = imageSlots[inpaintSlotIdx]; if(data.currentIndex > 0) { data.currentIndex--; loadInpaintImage(data.history[data.currentIndex]); updateHistoryUI(data); renderSlot(inpaintSlotIdx); } }
        function nextHistory() { playZeldaSound('click'); const data = imageSlots[inpaintSlotIdx]; if(data.currentIndex < data.history.length - 1) { data.currentIndex++; loadInpaintImage(data.history[data.currentIndex]); updateHistoryUI(data); renderSlot(inpaintSlotIdx); } }

        async function sendInpaintTask() {
            const prompt = document.getElementById('inpaintPrompt').value.trim();
            if (!prompt) { triggerError('MISSING DIRECTIVE', '请填写重绘指令！'); return; }
            if (canvasPaths.length === 0) { triggerError('NO ANNOTATION', '请在图片上涂抹标注区域！'); return; }

            playZeldaSound('click');
            const titles = getCurrentSlotTitles();
            const targetTitle = titles[inpaintSlotIdx] || "";
            let aspectRatio = "1:1";
            if (targetTitle.includes("老版A+")) aspectRatio = "16:9";
            if (targetTitle.includes("高级A+")) aspectRatio = "21:9";

            const mergeCanvas = document.createElement('canvas');
            mergeCanvas.width = inpaintImg.naturalWidth || inpaintCanvas.width; mergeCanvas.height = inpaintImg.naturalHeight || inpaintCanvas.height; // 按原图分辨率合成，避免重绘后分辨率下降
            const mCtx = mergeCanvas.getContext('2d');
            mCtx.drawImage(inpaintImg, 0, 0, mergeCanvas.width, mergeCanvas.height);
            mCtx.drawImage(inpaintCanvas, 0, 0, mergeCanvas.width, mergeCanvas.height);

            closeInpaintModal();
            const slot = document.getElementById(`slot-${inpaintSlotIdx}`);
            slot.classList.add('standby');
            slot.innerHTML = `<div class="animate-pulse text-zonai-yellow italic text-xs tracking-widest font-mono py-16">UPLOADING & OVERWRITING...</div>`;

            const taskId = `inpaint_${Date.now()}_${inpaintSlotIdx}`;

            // 优先 base64 直发（浏览器直传 Firebase Storage 在部分网络环境不通会卡死）；画布跨域污染时回退旧的 Storage 上传
            let mergedB64 = null;
            try { mergedB64 = mergeCanvas.toDataURL('image/jpeg', 0.95); } catch (e) { mergedB64 = null; }
            if (mergedB64) {
                try {
                    const payload = { task_id: taskId, slot_idx: inpaintSlotIdx, prompt: prompt, aspect_ratio: aspectRatio, annotated_image_url: '', base_image_b64: mergedB64 };
                    const headers = await getAuthHeader();
                    if (!headers) { renderSlot(inpaintSlotIdx); return; }
                    const response = await fetch(N8N_INPAINT_WEBHOOK, { method: 'POST', headers: headers, body: JSON.stringify(payload) });
                    if (response.status === 402) { triggerError('点数不足', '剩余点数不够用了，请充值后继续。'); renderSlot(inpaintSlotIdx); return; }
                    if(!response.ok) throw new Error("图片任务未受理，请查看通道状态和错误提示");
                    activeKieTasks.push({ slot: inpaintSlotIdx, taskId: taskId, isInpaint: true });
                    resumeKieListener(inpaintSlotIdx, taskId, true);
                } catch (error) { triggerError('CONNECTION ERROR', '与云端仓库断开连接或 n8n 拒绝访问。'); renderSlot(inpaintSlotIdx); }
                return;
            }
            mergeCanvas.toBlob(async (blob) => {
                if (!blob) { triggerError('RENDER ERROR', '图层合并失败，无法生成文件。'); renderSlot(inpaintSlotIdx); return; }
                try {
                    let uploadedImageUrl;
                    try { uploadedImageUrl = await cnUpload(blob); }   // 2026-10-21：先传加速节点（国内可达），失败再走 Firebase
                    catch (_cnErr) {
                        const storageRef = firebase.storage().ref();
                        const maskRef = storageRef.child(`hyrule_masks/${taskId}.jpg`);
                        await maskRef.put(blob);
                        uploadedImageUrl = await maskRef.getDownloadURL();
                    }

                    const payload = { task_id: taskId, slot_idx: inpaintSlotIdx, prompt: prompt, aspect_ratio: aspectRatio, annotated_image_url: uploadedImageUrl };
                    const headers = await getAuthHeader();
if (!headers) { renderSlot(inpaintSlotIdx); return; }
const response = await fetch(N8N_INPAINT_WEBHOOK, { method: 'POST', headers: headers, body: JSON.stringify(payload) });
if (response.status === 402) { triggerError('点数不足', '剩余点数不够用了，请充值后继续。'); renderSlot(inpaintSlotIdx); return; }
                    if(!response.ok) throw new Error("图片任务未受理，请查看通道状态和错误提示");

                    activeKieTasks.push({ slot: inpaintSlotIdx, taskId: taskId, isInpaint: true });
                    // ⛑️ Bug D 修复：inpaint 单张完成后不应自动截图发飞书（污染记录），传 isInpaint=true 跳过触发
                    resumeKieListener(inpaintSlotIdx, taskId, true);
                } catch (error) { triggerError('CONNECTION ERROR', '与云端仓库断开连接或 n8n 拒绝访问。'); renderSlot(inpaintSlotIdx); }
            }, 'image/jpeg', 0.95);
        }

        // ===== 🔄 编辑模式（独立页面：产品替换 / 自由编辑 双模式）=====
        let editStudioMode = 'replace'; // 'replace' 产品替换（底图+素材） | 'free' 自由编辑（不分底图素材，图随便扔）
        let editBase = null;        // { url } 或 { dataUrl }（仅产品替换模式使用）
        let editMaterials = [];     // { dataUrl, name }
        let editHistory = [];       // 结果图 URL
        let editCurrentIdx = -1;
        let editBusy = false;
        let editListenerRef = null;
        let editWatchdogTimer = null;

        const EDIT_MAT_CAP = { replace: 4, free: 8 };

        function __setEditStudioModeCore(mode) {
            if (mode !== 'replace' && mode !== 'free') return;
            if (editStudioMode === mode) return;
            playZeldaSound('click');
            editStudioMode = mode;
            const isFree = mode === 'free';
            document.getElementById('editReplaceCol').classList.toggle('hidden', isFree);
            document.getElementById('editPresetBtn').classList.toggle('hidden', isFree);
            const actClasses = ['border-zonai-yellow', 'text-zonai-yellow', 'bg-zonai-yellow/10'];
            const idleClasses = ['border-white/20', 'text-white/40'];
            const tabR = document.getElementById('editTabReplace');
            const tabF = document.getElementById('editTabFree');
            [tabR, tabF].forEach(t => { t.classList.remove(...actClasses, ...idleClasses); });
            (isFree ? tabF : tabR).classList.add(...actClasses);
            (isFree ? tabR : tabF).classList.add(...idleClasses);
            document.getElementById('editModeDesc').innerHTML = isFree
                ? '不区分底图和素材：把图<strong class="text-white">随便扔进来（1 张也行，最多 8 张）</strong>，编辑指令完全自己写——合成、改风格、换背景、抽元素重组，想怎么生成都行。全部图片会一视同仁喂给模型。📏 <strong class="text-white">产品大小不对？</strong>点缩略图上的 🖊 圈注：红笔圈产品、青绿色笔画目标大小的圈，再点指令区「📏 大小修正」。生成使用图片服务额度；本地测试点数仅用于流程记录。'
                : '风格、排版都满意，但产品画错/漂移了？把那张图放这里当底图，再喂正确的产品素材图——<strong class="text-white">只换产品，其他全保留</strong>。📏 <strong class="text-white">只是大小不对？</strong>点「🖊️ 圈注底图」：红笔圈产品、青绿色笔画目标大小的圈，再点指令区「📏 大小修正」。想随便扔图自由生成？切「🎨 自由编辑」。';
            document.getElementById('editMatLabel').innerHTML = isFree
                ? '① 图片素材 / IMAGES <span class="text-white/40">(1 张起步，最多 8 张，不分底图素材)</span>'
                : '① 产品素材图 / MATERIALS <span class="text-white/40">(最多4张，产品替换必备)</span>';
            document.getElementById('editMatAddBtn').textContent = isFree
                ? '📎 添加图片（想放几张放几张）'
                : '📎 添加正确的产品素材图（多角度更稳）';
            document.getElementById('editPrompt').placeholder = isFree
                ? '完全自由编写：描述你想拿这些图怎么生成——比如「把图1的产品放进图2的场景」「按这几张素材做一张对比排版图」…'
                : '点右上「🔄 产品替换预设」自动填入替换指令；也可以完全自己写：有底图 = 在底图上改；只有素材图 = 按你的提示词自由生成。';
            document.getElementById('editUseResultBtn').textContent = isFree
                ? '⤴️ 加入素材继续改'
                : '⤴️ 设为底图继续改';
        }

        // ===== 📱 快速生成手机版 A+（编辑模式第三个标签，2026-09-24）=====
        // 复用「生成手机版」同一条后端（MOBILE_REFORMAT_URL：逐张派发 + 失败自动重试 + 结果写 Firebase hyrule_tasks/{taskId}）
        // 与主工作台的 mobileSlots 完全独立：不依赖当前任务，拖进来的任意 A+ 图都能批量转手机版。
        const QM_MAX = 20;
        const QM_KEY = 'hyrule_quickmobile::' + ((location.pathname.match(/ec-image-hardcore-[^/]+/) || [location.host || 'app'])[0]);
        let qmItems = [];            // { id, title, url, preview, status: uploading|ready|pending|done|failed, taskId, result, err }
        let __qmMobileOn = false, __qmRestored = false;
        function qmSave() {
            try { localStorage.setItem(QM_KEY, JSON.stringify(qmItems.map(({ preview, ...rest }) => ({ ...rest, preview: (preview && !String(preview).startsWith('data:')) ? preview : null })))); } catch (e) { console.warn('[快速手机版] 列表保存失败', e); }
        }
        function qmEsc(s) { return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
        function qmRender() {
            const list = document.getElementById('qmList'); if (!list) return;
            list.innerHTML = qmItems.map((it, i) => {
                const src = it.preview || it.url || '';
                let right;
                if (it.status === 'done' && it.result) right = `<img src="${qmEsc(cnImg(it.result, 800))}" data-o="${qmEsc(it.result)}" onerror="cnFallback(this)" referrerpolicy="no-referrer" class="w-full h-full object-contain cursor-zoom-in" onclick="openSampleLightbox(cnBig(this.src))">`;
                else if (it.status === 'pending') right = `<div class="animate-pulse text-zonai-teal text-[11px] px-2 text-center">生成中…<br>每张约 3–6 分钟</div>`;
                else if (it.status === 'failed') right = `<div class="text-red-400 text-[11px] px-2 text-center">生成失败<br><span class="text-white/40">${qmEsc(it.err || '')}</span></div>`;
                else if (it.status === 'uploading') right = `<div class="animate-pulse text-white/40 text-[11px]">上传中…</div>`;
                else right = `<div class="text-white/30 text-[11px]">待生成</div>`;
                const busy = it.status === 'pending' || it.status === 'uploading';
                return `<div class="p-3 bg-black/40 border ${it.status === 'failed' ? 'border-red-400/40' : it.status === 'done' ? 'border-zonai-teal/50' : 'border-white/15'} rounded-xl flex flex-col gap-2">
                    <div class="flex gap-2 items-stretch" style="height:110px;">
                        <div class="flex-1 bg-black/50 rounded-lg overflow-hidden flex items-center justify-center"><img src="${qmEsc(cnImg(src, 800))}" data-o="${qmEsc(src)}" onerror="cnFallback(this)" referrerpolicy="no-referrer" class="max-w-full max-h-full object-contain"></div>
                        <div class="text-white/30 self-center text-xs">→</div>
                        <div class="flex-1 bg-black/50 rounded-lg overflow-hidden flex items-center justify-center">${right}</div>
                    </div>
                    <div class="flex gap-2 items-center">
                        <span class="text-[10px] text-white/40 font-mono">${String(i + 1).padStart(2, '0')}</span>
                        <input value="${qmEsc(it.title)}" onchange="qmItems[${i}].title=this.value; qmSave()" ${busy ? 'disabled' : ''} class="sheikah-input text-[11px] flex-1 py-1 px-2" placeholder="模块标题（可选，帮助模型理解版面）">
                        ${it.status === 'done' ? `<button onclick="qmDownloadOne(${i})" class="action-mini-btn px-2 py-1 text-[11px] text-zonai-teal border-zonai-teal" title="下载 1200×900 手机版">💾</button>` : ''}
                        ${it.status === 'failed' ? `<button onclick="qmRun([${i}])" class="action-mini-btn px-2 py-1 text-[11px] text-zonai-yellow border-zonai-yellow" title="只重试这一张">↻</button>` : ''}
                        ${!busy ? `<button onclick="qmRemove(${i})" class="action-mini-btn px-2 py-1 text-[11px]" title="移出列表">✕</button>` : ''}
                    </div>
                </div>`;
            }).join('');
            const done = qmItems.filter(x => x.status === 'done').length;
            const zip = document.getElementById('qmZipBtn'); if (zip) zip.classList.toggle('hidden', done === 0);
            const btn = document.getElementById('qmRunBtn');
            if (btn) {
                const todo = qmItems.filter(x => x.status === 'ready' || x.status === 'failed').length;
                btn.disabled = todo === 0 && !qmItems.some(x => x.status === 'uploading');
                btn.style.opacity = btn.disabled ? '0.4' : '1';
                btn.textContent = todo ? `📱 一键生成全部手机版（${todo} 张）` : '📱 一键生成全部手机版';
            }
        }
        async function qmUpload(it, blob) {
            // 2026-10-21：先传加速节点（国内可达）；不通再走 Firebase Storage（谷歌，国内基本传不上）
            try { it.url = await cnUpload(blob); it.status = 'ready'; it.err = ''; qmSave(); qmRender(); return; }
            catch (e) { console.warn('[快速手机版] 加速节点上传失败，改走 Firebase', e && e.message); }
            try {
                const ref = firebase.storage().ref().child('hyrule_persisted/quickmobile_' + Date.now() + '_' + Math.floor(Math.random() * 1e6) + '.jpg');
                await ref.put(blob, { contentType: blob.type || 'image/jpeg' });
                it.url = await ref.getDownloadURL();
                it.status = 'ready';
            } catch (e) { it.status = 'failed'; it.err = '上传失败：' + (e && e.message ? e.message : e); }
            qmSave(); qmRender();
        }
        async function qmAddFiles(files) {
            const arr = Array.from(files || []).filter(f => f && /^image\//.test(f.type));
            if (!arr.length) return;
            const room = QM_MAX - qmItems.length;
            if (room <= 0) { triggerError('LIST FULL', `一次最多 ${QM_MAX} 张，请先生成或清掉一些再加。`); return; }
            if (arr.length > room) { if (window.aquaNotify) aquaNotify('超出上限', `只加入前 ${room} 张（一次最多 ${QM_MAX} 张）`, '⚠️'); }
            playZeldaSound('click');
            for (const f of arr.slice(0, room)) {
                // 高质量压缩：长边 2400、质量 0.92（A+ 横幅要保住文字清晰度）
                let dataUrl; try { dataUrl = await compressImageFile(f, 2400, 0.92); } catch (e) { dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }); }
                const it = { id: 'qm' + Date.now() + Math.floor(Math.random() * 1e4), title: f.name.replace(/\.[^.]+$/, ''), preview: dataUrl, url: '', status: 'uploading' };
                qmItems.push(it); qmRender();
                const blob = await (await fetch(dataUrl)).blob();
                qmUpload(it, blob);
            }
        }
        function qmImportCurrent() {
            const titles = (typeof getCurrentSlotTitles === 'function') ? (getCurrentSlotTitles() || []) : [];
            const src = [7, 8, 9, 10, 11].filter(i => imageSlots[i] && imageSlots[i].url);
            if (!src.length) { triggerError('NO A+', '当前任务里没有已生成的高级 A+ 图。可以直接把图拖进上方框里。'); return; }
            let added = 0;
            src.forEach(i => {
                if (qmItems.length >= QM_MAX || qmItems.some(x => x.url === imageSlots[i].url)) return;
                qmItems.push({ id: 'qm' + Date.now() + i, title: (titles[i] || '高级A+模块').replace(/【|】/g, ''), preview: imageSlots[i].url, url: imageSlots[i].url, status: 'ready' });
                added++;
            });
            playZeldaSound('click'); qmSave(); qmRender();
            if (window.aquaNotify) aquaNotify('已导入', `加入 ${added} 张高级 A+ 图`, '⤵️');
        }
        function qmRemove(i) { const it = qmItems[i]; if (!it || it.status === 'pending') return; if (it.taskId) { try { db.ref('hyrule_tasks/' + it.taskId).off(); } catch (e) {} } qmItems.splice(i, 1); qmSave(); qmRender(); }
        function qmClearAll() {
            if (qmItems.some(x => x.status === 'pending') && !confirm('还有图在生成中，清空后将不再接收它们的结果。确定清空？')) return;
            qmItems.forEach(it => { if (it.taskId) { try { db.ref('hyrule_tasks/' + it.taskId).off(); clearWatchdog('img:' + it.taskId); } catch (e) {} } });
            qmItems = []; qmSave(); qmRender(); document.getElementById('qmStatus').textContent = '';
        }
        function qmListen(it) {
            const ref = db.ref('hyrule_tasks/' + it.taskId);
            const refund = (why) => { if (it.chargeId && typeof requestRefund === 'function') { rememberChargeId(it.taskId, it.chargeId); requestRefund(it.taskId, why); } };
            armWatchdog('img:' + it.taskId, 'image', () => { ref.off(); if (it.status === 'pending') { it.status = 'failed'; it.err = '超过 12 分钟无响应（已自动退回 1 点）'; refund('手机版生成超时'); qmSave(); qmRender(); qmSummary(); } });
            ref.on('value', snap => {
                const d = snap.val(); if (!d) return;
                if (d.status === 'completed' && d.imageUrl) { clearWatchdog('img:' + it.taskId); ref.off(); it.status = 'done'; it.result = d.imageUrl; it.err = ''; qmSave(); qmRender(); qmSummary(); }
                else if (d.status === 'failed') { clearWatchdog('img:' + it.taskId); ref.off(); it.status = 'failed'; it.err = (d.errorMsg || d.error || '云端生成失败') + '（已自动退回 1 点）'; refund('手机版生成失败'); qmSave(); qmRender(); qmSummary(); }
            });
        }
        function qmSummary() {
            const st = document.getElementById('qmStatus'); if (!st) return;
            const p = qmItems.filter(x => x.status === 'pending').length, ok = qmItems.filter(x => x.status === 'done').length, bad = qmItems.filter(x => x.status === 'failed').length;
            st.innerHTML = p ? `<span class="text-zonai-teal animate-pulse">📱 生成中：已完成 ${ok}，进行中 ${p}${bad ? `，失败 ${bad}` : ''}</span>`
                : (ok || bad) ? (bad ? `<span class="text-red-400">完成 ${ok} 张，失败 ${bad} 张——失败的点卡片上的 ↻ 单独重试</span>` : `<span class="text-zonai-teal">📱 全部 ${ok} 张手机版已生成，可逐张下载或打包下载</span>`) : '';
            if (!p && ok && typeof playZeldaSound === 'function') { try { playZeldaSound(bad ? 'error' : 'success'); } catch (e) {} }
        }
        async function qmRun(onlyIdx) {
            const headers = (typeof getAuthHeader === 'function') ? await getAuthHeader() : null;
            if (!headers) { triggerError('LOGIN', '请先登录账号再生成手机版。'); return; }
            if (qmItems.some(x => x.status === 'uploading')) { if (window.aquaNotify) aquaNotify('还在上传', '图片上传完成后会自动可点，稍等几秒', '⏳'); return; }
            const idxs = Array.isArray(onlyIdx) ? onlyIdx : qmItems.map((x, i) => i).filter(i => qmItems[i].status === 'ready' || qmItems[i].status === 'failed');
            const targets = idxs.map(i => qmItems[i]).filter(it => it && it.url);
            if (!targets.length) { triggerError('EMPTY', '列表里没有待生成的图。先把 A+ 图拖进来。'); return; }
            if (!confirm(`本次生成 ${targets.length} 张手机版，使用图片服务额度。测试点数仅用于记录。继续？`)) return;
            playZeldaSound('click');
            const batchId = Date.now();
            let marketData = { market: 'US', lang: 'en' }; try { marketData = JSON.parse(document.getElementById('targetMarket').value); } catch (e) {}
            const tasks = targets.map((it, k) => {
                it.taskId = `mobile_qm_${batchId}_${k}`; it.status = 'pending'; it.err = ''; it.result = '';
                return { taskId: it.taskId, source_image_url: it.url, title: String(it.title || '').replace(/【|】/g, '') };
            });
            qmSave(); qmRender(); qmSummary();
            const payload = { batch_id: 'qm_' + batchId, product_name: document.getElementById('prodName')?.value || '', product_desc: document.getElementById('prodDesc')?.value || '', target_market: marketData.market, target_lang: marketData.lang, tasks };
            try {
                // 官网：经 /api/generate 手机版分支（登录 + 每张 1 点），不直连 n8n；扣费单号跟任务一起存，刷新后失败也能退
                const res = await fetch('/api/generate', { method: 'POST', headers, body: JSON.stringify({ ...payload, mobile_reformat: true, generation_mode: 'mobile_reformat', app_channel: APP_CHANNEL }) });
                const reqId = res.headers.get('X-Request-Id');
                if (reqId) targets.forEach(it => { it.chargeId = reqId; rememberChargeId(it.taskId, reqId); });
                if (res.status === 402) throw new Error('剩余点数不够用了（手机版每张 1 点），请充值后继续。');
                if (res.status === 403) throw new Error('账号未激活，请联系站长开通。');
                if (!res.ok) { targets.forEach(it => { if (it.chargeId) requestRefund(it.taskId, '手机版下发失败'); }); throw new Error('HTTP ' + res.status); }
                if (typeof loadCredits === 'function') loadCredits();
                qmSave();
                targets.forEach(qmListen);
            } catch (err) {
                targets.forEach(it => { it.status = 'failed'; it.err = '下发失败：' + (err && err.message ? err.message : '网络错误'); });
                qmSave(); qmRender(); qmSummary();
                triggerError('MOBILE FAILED', (err && err.message) ? err.message : '手机版服务没有响应，请等 1 分钟再点一次。');
            }
        }
        async function qmBlob(it) { let b = await _fetchBlobWithRetry(it.result, 2); try { b = await _normalizeMobileBlob(b); } catch (e) {} return b; }
        function qmName(it, i) { return `${String(i + 1).padStart(2, '0')}_${_safeFileName(it.title) || 'aplus'}_mobile_1200x900.jpg`; }
        async function qmDownloadOne(i) {
            const it = qmItems[i]; if (!it || !it.result) return;
            try { const b = await qmBlob(it); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = qmName(it, i); document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(u); a.remove(); }, 500); }
            catch (e) { triggerError('DOWNLOAD FAILED', '这张下载失败，链接可能已过期：' + (e && e.message ? e.message : '')); }
        }
        async function qmDownloadAll() {
            const done = qmItems.map((it, i) => ({ it, i })).filter(x => x.it.status === 'done' && x.it.result);
            if (!done.length) return;
            const st = document.getElementById('qmStatus'); const zip = new JSZip(); const failed = []; let n = 0;
            const q = done.slice();
            async function w() { while (q.length) { const { it, i } = q.shift(); try { zip.file(qmName(it, i), await qmBlob(it)); } catch (e) { failed.push(qmName(it, i)); } n++; if (st) st.textContent = `正在打包 ${n}/${done.length}…`; } }
            await Promise.all(Array.from({ length: 4 }, w));
            if (failed.length === done.length) { triggerError('ARCHIVE FAILED', '所有手机版图都拉取失败，链接可能已过期。'); return; }
            const blob = await zip.generateAsync({ type: 'blob' }); const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = `Mobile_APlus_${new Date().toISOString().slice(0, 10)}_${done.length - failed.length}pics.zip`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(u); a.remove(); }, 500);
            if (st) st.innerHTML = failed.length ? `<span class="text-red-400">打包完成，但漏了 ${failed.length} 张：${failed.join('、')}</span>` : `<span class="text-zonai-teal">📦 已打包 ${done.length} 张手机版</span>`;
        }
        function qmRestore() {
            if (__qmRestored) return; __qmRestored = true;
            try { qmItems = JSON.parse(localStorage.getItem(QM_KEY) || '[]') || []; } catch (e) { qmItems = []; }
            qmItems.forEach(it => { if (!it.preview) it.preview = it.url; if (it.status === 'uploading') { it.status = 'failed'; it.err = '上传被刷新打断，请移除后重新拖入'; } });
            qmItems.filter(it => it.status === 'pending' && it.taskId).forEach(qmListen);   // 刷新前还在生成的，继续等结果
            qmRender(); qmSummary();
        }
        window.addEventListener('load', () => setTimeout(() => { try { qmRestore(); } catch (e) { console.warn('[快速手机版] 恢复失败', e); } }, 1200));

        function setEditStudioMode(mode) {
            const row = document.getElementById('editMainRow'), mob = document.getElementById('editMobileCol'), tM = document.getElementById('editTabMobile');
            const act = ['border-zonai-yellow', 'text-zonai-yellow', 'bg-zonai-yellow/10'], idle = ['border-white/20', 'text-white/40'];
            if (mode === 'mobile') {
                if (__qmMobileOn) return;
                playZeldaSound('click'); __qmMobileOn = true;
                row.classList.add('hidden'); mob.classList.remove('hidden');
                ['editTabReplace', 'editTabFree'].forEach(id => { const t = document.getElementById(id); t.classList.remove(...act); t.classList.add(...idle); });
                tM.classList.remove(...idle); tM.classList.add(...act);
                document.getElementById('editModeDesc').innerHTML = '刷图刷丢了、或者不是当前任务的 A+ 图？把要改的图<strong class="text-white">一次性全部拖进来</strong>，点一次就在同一个任务里给<strong class="text-white">每一张</strong>生成对应的 1200×900 手机版 A+。';
                qmRestore(); qmRender();
                return;
            }
            if (__qmMobileOn) {
                __qmMobileOn = false; mob.classList.add('hidden'); row.classList.remove('hidden');
                tM.classList.remove(...act); tM.classList.add(...idle);
                if (editStudioMode === mode) editStudioMode = (mode === 'replace' ? 'free' : 'replace');   // 让下面的核心函数照常刷新标签与说明
            }
            __setEditStudioModeCore(mode);
        }

        // 📏 产品大小修正模板：红圈=当前产品（默认画笔），青绿圈=目标大小/位置（局部重绘与编辑模式共用）
        const SIZE_FIX_PRESET = '【产品大小修正】图中红色圈选的是当前产品主体，青绿色圈画出的是产品应有的目标大小和位置。请把红圈内的产品等比缩放并放置到青绿色圈所示的大小与位置，产品外形、颜色、材质、标签细节保持完全不变；画面其他内容（背景、文字、排版、光影）100% 保持原样不动；最终成图必须彻底去除红圈和青绿色圈的所有笔迹。';
        function fillSizeFixPrompt(taId) {
            playZeldaSound('click');
            const ta = document.getElementById(taId);
            if (!ta) return;
            if (ta.value.indexOf('【产品大小修正】') !== -1) return;
            ta.value = ta.value.trim() ? (ta.value.trim() + '\n\n' + SIZE_FIX_PRESET) : SIZE_FIX_PRESET;
        }

        // ===== 🖊️ 编辑模式通用圈注（底图/素材图画圈，保存时按原图分辨率合成进图片）=====
        let editAnnTarget = null;   // {type:'base'} 或 {type:'mat', idx}
        let editAnnPaths = [], editAnnCurrent = [], editAnnDrawing = false, editAnnColor = '#FF3333';
        const editAnnImg = document.getElementById('editAnnImg');
        const editAnnCanvas = document.getElementById('editAnnCanvas');
        const editAnnCtx = editAnnCanvas.getContext('2d');

        function editAnnOpen(target) {
            playZeldaSound('click');
            if (target.type === 'base' && !editBase) { triggerError('NO BASE', '先设置底图再圈注。'); return; }
            if (target.type === 'mat' && !editMaterials[target.idx]) return;
            editAnnTarget = target;
            const src = target.type === 'base'
                ? (editBase.dataUrl || editBase.url)
                : (editMaterials[target.idx].dataUrl || editMaterials[target.idx].url);
            document.getElementById('editAnnTitle').innerText = target.type === 'base' ? '[ 底图 ]' : `[ 素材图 ${target.idx + 1} ]`;
            editAnnPaths = []; editAnnCurrent = []; editAnnDrawing = false;
            editAnnCtx.clearRect(0, 0, editAnnCanvas.width, editAnnCanvas.height);
            document.getElementById('editAnnModal').classList.add('show');
            const fit = () => {
                if (!editAnnImg.clientWidth) { requestAnimationFrame(fit); return; }
                editAnnCanvas.width = editAnnImg.clientWidth;
                editAnnCanvas.height = editAnnImg.clientHeight;
                editAnnRedraw();
            };
            editAnnImg.crossOrigin = 'anonymous';
            editAnnImg.onload = fit;
            editAnnImg.onerror = () => { triggerError('LOAD ERROR', '图片加载失败，无法圈注。'); editAnnCancel(); };
            editAnnImg.src = CN_IMG_HOSTS.test(src) ? cnImg(src, 0) : /^https?:/.test(src) ? ('https://wsrv.nl/?url=' + encodeURIComponent(src)) : src;
        }

        function editAnnPos(e) { const r = editAnnCanvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
        editAnnCanvas.addEventListener('mousedown', (e) => { editAnnDrawing = true; editAnnCurrent = [editAnnPos(e)]; });
        editAnnCanvas.addEventListener('mousemove', (e) => { if (!editAnnDrawing) return; editAnnCurrent.push(editAnnPos(e)); editAnnRedraw(); });
        editAnnCanvas.addEventListener('mouseup', () => {
            if (!editAnnDrawing) return; editAnnDrawing = false;
            if (editAnnCurrent.length) { editAnnPaths.push({ path: editAnnCurrent, size: +document.getElementById('editAnnBrushSize').value, color: editAnnColor }); }
            editAnnCurrent = []; editAnnRedraw();
        });
        editAnnCanvas.addEventListener('mouseout', () => { editAnnDrawing = false; });

        function editAnnRedraw() {
            editAnnCtx.clearRect(0, 0, editAnnCanvas.width, editAnnCanvas.height);
            editAnnCtx.lineCap = 'round'; editAnnCtx.lineJoin = 'round';
            const strokes = editAnnCurrent.length
                ? editAnnPaths.concat([{ path: editAnnCurrent, size: +document.getElementById('editAnnBrushSize').value, color: editAnnColor }])
                : editAnnPaths;
            strokes.forEach(s => {
                if (!s.path.length) return;
                editAnnCtx.lineWidth = s.size; editAnnCtx.strokeStyle = s.color;
                editAnnCtx.beginPath(); editAnnCtx.moveTo(s.path[0].x, s.path[0].y);
                s.path.forEach(p => editAnnCtx.lineTo(p.x, p.y)); editAnnCtx.stroke();
            });
        }

        function editAnnUndo() { playZeldaSound('click'); editAnnPaths.pop(); editAnnRedraw(); }
        function editAnnClear() { playZeldaSound('click'); editAnnPaths = []; editAnnCurrent = []; editAnnRedraw(); }
        function editAnnSetColor(c) { playZeldaSound('click'); editAnnColor = c; }
        function editAnnCancel() { playZeldaSound('click'); document.getElementById('editAnnModal').classList.remove('show'); editAnnTarget = null; }

        function editAnnSave() {
            if (!editAnnTarget) return;
            if (!editAnnPaths.length) { editAnnCancel(); return; }
            playZeldaSound('click');
            try {
                const w = editAnnImg.naturalWidth || editAnnCanvas.width;
                const h = editAnnImg.naturalHeight || editAnnCanvas.height;
                const scale = editAnnCanvas.width ? (w / editAnnCanvas.width) : 1;
                const c = document.createElement('canvas');
                c.width = w; c.height = h;
                const ctx = c.getContext('2d');
                ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, w, h);
                ctx.drawImage(editAnnImg, 0, 0, w, h);
                ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                editAnnPaths.forEach(s => {
                    if (!s.path.length) return;
                    ctx.lineWidth = s.size * scale; ctx.strokeStyle = s.color;
                    ctx.beginPath(); ctx.moveTo(s.path[0].x * scale, s.path[0].y * scale);
                    s.path.forEach(p => ctx.lineTo(p.x * scale, p.y * scale)); ctx.stroke();
                });
                const merged = c.toDataURL('image/jpeg', 0.92);
                if (editAnnTarget.type === 'base') {
                    editSetBase({ dataUrl: merged });
                } else {
                    const m = editMaterials[editAnnTarget.idx];
                    if (m) { editMaterials[editAnnTarget.idx] = { dataUrl: merged, name: (m.name || 'mat') + '_圈注' }; renderEditMaterials(); }
                }
                document.getElementById('editAnnModal').classList.remove('show'); editAnnTarget = null;
            } catch (e) {
                triggerError('MERGE ERROR', '圈注合成失败（图片跨域受限）。把这张图下载到本地再上传后即可圈注。');
            }
        }

        const EDIT_REPLACE_MARK = '[PRODUCT REPLACEMENT]';
        const EDIT_REPLACE_PRESET = '[PRODUCT REPLACEMENT] Image 1 is the BASE image. Every image after it (Image 2, Image 3, ...) is a photo of the REAL product. The product currently drawn in Image 1 is WRONG and must NOT be kept: erase it and REBUILD it from scratch as a faithful copy of the real product in Image 2 — identical silhouette, proportions, part structure, colors, materials, surface finish, labels and logo. Do not blend the two or invent parts; if a detail in Image 1 differs from Image 2, Image 2 wins. Re-orient and scale the rebuilt product to fit the original placement, perspective and lighting of the scene. Everything else in Image 1 — composition, background, lighting, all text, typography, colors and layout — must stay 100% pixel-identical. If Image 1 contains colored hand-drawn circles or strokes, the circled area marks the wrong product to replace; the final image must contain NO trace of those marks.';

        // 局部重绘弹窗 → 编辑模式：把当前浏览的这一版图片（若有圈注则连圈注一起合成）带过去当底图
        function sendToEditStudio() {
            playZeldaSound('click');
            const data = imageSlots[inpaintSlotIdx];
            if (!data) return;
            const curUrl = data.history ? data.history[data.currentIndex] : data.url;
            if (canvasPaths.length > 0) {
                const mergeCanvas = document.createElement('canvas');
                mergeCanvas.width = inpaintImg.naturalWidth || inpaintCanvas.width; mergeCanvas.height = inpaintImg.naturalHeight || inpaintCanvas.height; // 按原图分辨率合成，避免重绘后分辨率下降
                const mCtx = mergeCanvas.getContext('2d');
                mCtx.drawImage(inpaintImg, 0, 0, mergeCanvas.width, mergeCanvas.height);
                mCtx.drawImage(inpaintCanvas, 0, 0, mergeCanvas.width, mergeCanvas.height);
                try { editSetBase({ dataUrl: mergeCanvas.toDataURL('image/jpeg', 0.95) }); }
                catch (e) { editSetBase({ url: curUrl }); }
            } else {
                editSetBase({ url: curUrl });
            }
            closeInpaintModal();
            setEditStudioMode('replace');
            switchView('edit-studio', document.getElementById('nav-edit'));
        }

        function editSetBase(base) {
            editBase = base;
            const img = document.getElementById('editBaseImg');
            img.src = base.dataUrl || base.url;
            img.classList.remove('hidden');
            document.getElementById('editBasePlaceholder').classList.add('hidden');
        }

        function editHandleBaseFile(files) {
            const file = (files && files[0]) || null;
            if (!file || !file.type.startsWith('image/')) return;
            playZeldaSound('click');
            compressImageFile(file)
                .catch(() => new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.onerror = () => reject(new Error('读取失败'));
                    reader.readAsDataURL(file);
                }))
                .then(dataUrl => editSetBase({ dataUrl: dataUrl }))
                .catch(() => triggerError('READ ERROR', '底图读取失败'));
            document.getElementById('editBaseInput').value = '';
        }

        function editSetBaseFromUrl() {
            playZeldaSound('click');
            const url = window.prompt('粘贴图片链接（需公网可访问）：');
            if (url === null) return;
            if (!/^https?:\/\//.test(url.trim())) { triggerError('BAD URL', '链接格式不对，需要 http(s) 开头。'); return; }
            editSetBase({ url: url.trim() });
        }

        function editHandleMaterials(files) {
            const list = Array.from(files || []).filter(f => f.type.startsWith('image/'));
            if (!list.length) return;
            const cap = EDIT_MAT_CAP[editStudioMode] || 4;
            if (editMaterials.length + list.length > cap) { triggerError('FULL', `当前模式图片素材最多 ${cap} 张。`); return; }
            playZeldaSound('click');
            list.forEach(file => {
                compressImageFile(file)
                    .catch(() => new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (e) => resolve(e.target.result);
                        reader.onerror = () => reject(new Error('读取失败'));
                        reader.readAsDataURL(file);
                    }))
                    .then(dataUrl => { editMaterials.push({ dataUrl: dataUrl, name: file.name }); renderEditMaterials(); })
                    .catch(() => triggerError('READ ERROR', '素材图读取失败：' + file.name));
            });
            document.getElementById('editMatInput').value = '';
        }

        function renderEditMaterials() {
            document.getElementById('editMatList').innerHTML = editMaterials.map((m, i) =>
                `<div class="relative w-16 h-16 rounded-lg overflow-hidden border border-zonai-yellow/50">
                    <img src="${m.dataUrl || m.url}" class="w-full h-full object-cover">
                    <button onclick="removeEditMaterial(${i})" class="absolute top-0 right-0 w-4 h-4 bg-black/70 text-red-400 text-[10px] leading-4 text-center" title="删除这张">✕</button>
                    <button onclick="editAnnOpen({type:'mat', idx:${i}})" class="absolute bottom-0 right-0 w-4 h-4 bg-black/70 text-zonai-yellow text-[10px] leading-4 text-center" title="在这张图上画圈标记">🖊</button>
                </div>`).join('');
        }

        function removeEditMaterial(i) { playZeldaSound('click'); editMaterials.splice(i, 1); renderEditMaterials(); }

        function editComposeReplacePrompt(extra) {
            extra = (extra || '').trim();
            return extra ? (EDIT_REPLACE_PRESET + '\n\nAdditional requirements (what is wrong in Image 1 / must match Image 2):\n' + extra) : EDIT_REPLACE_PRESET;
        }

        function editHasReplaceMark(t) { return t.indexOf(EDIT_REPLACE_MARK) !== -1 || t.indexOf('【产品替换】') !== -1; }

        function editFillReplacePreset() {
            playZeldaSound('click');
            if (!editMaterials.length) { triggerError('NO MATERIALS', '请先添加正确的产品素材图，再用产品替换预设。'); return; }
            if (!editBase) { triggerError('NO BASE', '产品替换预设需要先设置底图（要被替换产品的那张图）；只有素材图请切到「🎨 自由编辑」自己写指令。'); return; }
            const ta = document.getElementById('editPrompt');
            const extra = ta.value.trim();
            ta.value = editHasReplaceMark(extra) ? extra : editComposeReplacePrompt(extra);
        }

        function editSetStatus(msg, color) {
            const el = document.getElementById('editStatus');
            if (!msg) { el.classList.add('hidden'); return; }
            el.classList.remove('hidden'); el.style.color = color || ''; el.textContent = msg;
        }

        // 输出比例：手动选了就用手动值；「自动」= 从底图（自由编辑/无底图则第一张素材图）实际尺寸推最接近的标准比例
        function editDetectAspect() {
            const manual = document.getElementById('editAspect').value;
            if (manual && manual !== 'auto') return Promise.resolve(manual);
            const src = (editStudioMode !== 'free' && editBase) ? (editBase.dataUrl || editBase.url)
                      : (editMaterials.length ? (editMaterials[0].dataUrl || editMaterials[0].url) : null);
            if (!src) return Promise.resolve('1:1');
            return new Promise((resolve) => {
                const img = new Image();
                const timer = setTimeout(() => resolve('1:1'), 8000);
                img.onload = () => {
                    clearTimeout(timer);
                    const r = img.naturalWidth / img.naturalHeight;
                    const cands = [['1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4], ['16:9', 16 / 9], ['9:16', 9 / 16], ['21:9', 21 / 9], ['3:2', 1.5], ['2:3', 2 / 3]];
                    cands.sort((a, b) => Math.abs(a[1] - r) - Math.abs(b[1] - r));
                    resolve(cands[0][0]);
                };
                img.onerror = () => { clearTimeout(timer); resolve('1:1'); };
                img.src = src;
            });
        }

        async function editRunGeneration() {
            if (editBusy) return;
            let promptText = document.getElementById('editPrompt').value.trim();
            const isFree = editStudioMode === 'free';
            if (isFree) {
                if (!editMaterials.length) { triggerError('NO IMAGE', '自由编辑模式至少放 1 张图片素材。'); return; }
                if (!promptText) { triggerError('MISSING DIRECTIVE', '请写一下你想怎么编辑/生成。'); return; }
            } else {
                if (!editBase && !editMaterials.length) { triggerError('NO IMAGE', '至少需要一张图：设置底图（编辑现有图），或只上传产品素材图。'); return; }
                // 产品替换模式：底图 + 素材齐全时自动注入英文替换军令，用户写的文字作为补充差异说明
                if (editBase && editMaterials.length && !editHasReplaceMark(promptText)) {
                    promptText = editComposeReplacePrompt(promptText);
                    document.getElementById('editPrompt').value = promptText;
                }
                if (!promptText) { triggerError('MISSING DIRECTIVE', '请填写编辑/生成指令，或点「🔄 产品替换预设」。'); return; }
            }
            playZeldaSound('click');
            editBusy = true;
            const btn = document.getElementById('editRunBtn');
            btn.disabled = true; btn.textContent = '生成中…';
            const taskId = `edit_${Date.now()}`;
            try {
                // 图片走请求体 base64 直发（与主生成同款），由 n8n 服务器端上传图床——不再经浏览器直传 Firebase Storage
                editSetStatus('打包图片并递交云端…');
                let baseUrl = '', baseB64 = '';
                if (!isFree && editBase) {
                    if (editBase.dataUrl) { baseB64 = editBase.dataUrl; } else { baseUrl = editBase.url; }
                }
                const materialUrls = [], materialB64s = [];
                editMaterials.forEach(m => { if (m.url) { materialUrls.push(m.url); } else { materialB64s.push(m.dataUrl); } });
                const aspectRatio = await editDetectAspect();
                const channel = document.getElementById('editChannel').value;
                const payload = { task_id: taskId, slot_idx: -1, prompt: promptText, aspect_ratio: aspectRatio, annotated_image_url: baseUrl, material_image_urls: materialUrls, base_image_b64: baseB64, material_images_b64: materialB64s, channel: channel };
                const headers = await getAuthHeader();
                if (!headers) { editBusy = false; btn.disabled = false; btn.textContent = '⚡ 开始编辑生成'; editSetStatus(''); return; }
                const res = await fetch(N8N_INPAINT_WEBHOOK, { method: 'POST', headers: headers, body: JSON.stringify(payload) });
                if (res.status === 402) { throw new Error('剩余点数不够用了，请充值后继续。'); }
                if (!res.ok) throw new Error('图片任务未受理，请查看通道状态和错误提示');
                rememberChargeId(taskId, res.headers.get('X-Request-Id'));
                editSetStatus(channel === 'kie' ? '生成中（默认通道）…通常 1-3 分钟，请留在本页等待。' : '生成中（备用通道）…通常 1-2 分钟，请留在本页等待。');
                editListen(taskId);
            } catch (e) {
                editBusy = false; btn.disabled = false; btn.textContent = '⚡ 开始编辑生成';
                editSetStatus('❌ 派发失败：' + ((e && e.message) || '未知错误'), '#ff6b6b');
                playZeldaSound('error');
            }
        }

        function editListen(taskId) {
            if (editListenerRef) { editListenerRef.off(); editListenerRef = null; }
            if (editWatchdogTimer) clearTimeout(editWatchdogTimer);
            const ref = db.ref('hyrule_tasks/' + taskId);
            editListenerRef = ref;
            const settle = () => {
                ref.off(); editListenerRef = null; clearTimeout(editWatchdogTimer);
                editBusy = false;
                const btn = document.getElementById('editRunBtn');
                btn.disabled = false; btn.textContent = '⚡ 开始编辑生成';
            };
            editWatchdogTimer = setTimeout(() => { settle(); editSetStatus('⏱️ 等待超过 8 分钟无响应，请重新点击生成。', '#ff6b6b'); requestRefund(taskId, '编辑生成超时'); }, 8 * 60 * 1000);
            ref.on('value', (snap) => {
                const data = snap.val(); if (!data) return;
                if (data.status === 'completed' && data.imageUrl) {
                    settle(); playZeldaSound('success'); editSetStatus('');
                    editHistory.push(data.imageUrl); editCurrentIdx = editHistory.length - 1;
                    renderEditResult();
                } else if (data.status === 'failed') {
                    settle(); playZeldaSound('error');
                    editSetStatus('❌ 生成失败；测试点数已退回。真实扣费请在实际服务账单核对。', '#ff6b6b');
                    requestRefund(taskId, '编辑生成失败');
                }
            });
        }

        function renderEditResult() {
            const panel = document.getElementById('editResultPanel');
            if (!editHistory.length) { panel.classList.add('hidden'); return; }
            panel.classList.remove('hidden');
            { const _er = document.getElementById('editResultImg'); const _u = editHistory[editCurrentIdx]; _er.dataset.o = _u; delete _er.dataset.f; _er.onerror = () => cnFallback(_er); _er.src = cnImg(_u, 1600); }
            document.getElementById('editHistoryStrip').innerHTML = editHistory.map((u, i) =>
                `<img src="${cnImg(u, 480)}" data-o="${u}" onerror="cnFallback(this)" onclick="editShowHistory(${i})" class="w-14 h-14 object-cover rounded-lg cursor-pointer border ${i === editCurrentIdx ? 'border-zonai-teal' : 'border-white/20'}">`).join('');
            panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        function editShowHistory(i) { playZeldaSound('click'); editCurrentIdx = i; renderEditResult(); }

        function editUseResultAsBase() {
            if (editCurrentIdx < 0) return; playZeldaSound('click');
            const url = editHistory[editCurrentIdx];
            if (editStudioMode === 'free') {
                const cap = EDIT_MAT_CAP.free;
                if (editMaterials.length >= cap) { triggerError('FULL', `图片素材已满 ${cap} 张，先删几张再加。`); return; }
                editMaterials.push({ url: url, name: 'result' });
                renderEditMaterials();
            } else {
                editSetBase({ url: url });
            }
        }

        async function editDownloadResult() {
            if (editCurrentIdx < 0) return; playZeldaSound('click');
            const url = editHistory[editCurrentIdx];
            try {
                const blob = await fetchImageBlobBypassCORS(url);
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob); a.download = `edit_result_${Date.now()}.png`; a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 3000);
            } catch (e) { window.open(url, '_blank'); }
        }
