(function () {
    const WP_KEY = 'yimu_wallpaper_v1';
    const WP_CUSTOM_KEY = 'yimu_wp_custom_img';

    const WP_PRESETS = [
        { id: 'aurora', name: '极光', css: 'radial-gradient(70% 55% at 18% 8%, #4a7cff 0%, transparent 60%), radial-gradient(60% 50% at 82% 14%, #9b5cff 0%, transparent 58%), radial-gradient(65% 60% at 72% 96%, #14b8c4 0%, transparent 60%), radial-gradient(45% 40% at 28% 88%, #ff7a59 0%, rgba(255,122,89,0) 62%), linear-gradient(180deg, #0f1430 0%, #171538 60%, #101a2e 100%)' },
        { id: 'sequoia', name: '红杉暮色', css: 'radial-gradient(110% 90% at 20% 100%, #c74e83 0%, transparent 60%), radial-gradient(120% 90% at 85% 0%, #2b55b8 0%, transparent 60%), linear-gradient(160deg, #1a2145 0%, #43296b 55%, #6b3a5e 100%)' },
        { id: 'sonoma', name: '晨昏山谷', css: 'radial-gradient(100% 75% at 50% 105%, #ff9a4d 0%, rgba(255,154,77,0) 55%), radial-gradient(120% 80% at 50% -10%, #3a6db3 0%, transparent 65%), linear-gradient(180deg, #23345c 0%, #5d4470 65%, #a05a4e 100%)' },
        { id: 'mint', name: '碧湖', css: 'radial-gradient(100% 90% at 80% 100%, #17907c 0%, transparent 60%), radial-gradient(110% 80% at 10% 10%, #1a5f96 0%, transparent 60%), linear-gradient(180deg, #122438 0%, #164450 100%)' },
        { id: 'graphite', name: '石墨', css: 'radial-gradient(120% 100% at 30% 0%, #3b3f52 0%, transparent 60%), radial-gradient(100% 100% at 90% 100%, #23263a 0%, transparent 60%), linear-gradient(180deg, #1a1d28 0%, #292c3a 100%)' },
        { id: 'ventura', name: '橙紫波浪', css: 'radial-gradient(90% 80% at 85% 90%, #e06a52 0%, transparent 55%), radial-gradient(110% 90% at 15% 15%, #6f3cc4 0%, transparent 60%), radial-gradient(80% 60% at 60% 50%, #b8508f 0%, transparent 65%), linear-gradient(180deg, #241a48 0%, #4c2a5e 100%)' },
        { id: 'neon', name: '霓虹', css: 'radial-gradient(110% 85% at 12% 8%, #ff2d78 0%, transparent 52%), radial-gradient(100% 80% at 88% 15%, #00d4ff 0%, transparent 55%), radial-gradient(95% 90% at 65% 100%, #7b3fd6 0%, transparent 60%), linear-gradient(180deg, #150c26 0%, #1d1030 100%)' },
        { id: 'sunrise', name: '日出', css: 'radial-gradient(100% 80% at 50% 108%, #ff9d5c 0%, transparent 55%), radial-gradient(90% 70% at 20% 30%, #ff5c8a 0%, transparent 58%), radial-gradient(110% 85% at 85% 0%, #4a7dd6 0%, transparent 60%), linear-gradient(180deg, #1c2247 0%, #57324a 100%)' },
        { id: 'polar', name: '极夜', css: 'radial-gradient(120% 90% at 20% 10%, #173e8c 0%, transparent 58%), radial-gradient(100% 85% at 85% 40%, #0d6b7a 0%, transparent 60%), radial-gradient(90% 80% at 55% 105%, #3c2a80 0%, transparent 62%), linear-gradient(180deg, #0a0e1e 0%, #101528 100%)' },
        { id: 'lava', name: '熔岩', css: 'radial-gradient(105% 85% at 15% 95%, #e0452e 0%, transparent 55%), radial-gradient(95% 75% at 80% 85%, #ff9130 0%, transparent 55%), radial-gradient(110% 90% at 60% 0%, #6b2350 0%, transparent 62%), linear-gradient(180deg, #1c0e1c 0%, #2e1220 100%)' }
    ];

    function loadCfg() {
        try { return JSON.parse(localStorage.getItem(WP_KEY)) || {}; } catch (e) { return {}; }
    }
    function saveCfg(patch) {
        const cfg = Object.assign(loadCfg(), patch);
        localStorage.setItem(WP_KEY, JSON.stringify(cfg));
        return cfg;
    }

    function applyWallpaper(cfg) {
        const wp = document.getElementById('wallpaper');
        if (!wp) return;
        if (cfg.type === 'custom') {
            const dataUrl = localStorage.getItem(WP_CUSTOM_KEY);
            if (dataUrl) {
                wp.style.background = `url("${dataUrl}") center / cover no-repeat`;
            }
        } else if (cfg.type === 'mix' && Array.isArray(cfg.mix) && cfg.mix.length === 3) {
            wp.style.background = mixCss(cfg.mix);
            wp.style.backgroundSize = 'cover';
        } else {
            const p = WP_PRESETS.find(x => x.id === cfg.preset) || WP_PRESETS[0];
            wp.style.background = p.css;
            wp.style.backgroundSize = 'cover';
        }
        document.documentElement.style.setProperty('--wp-dim', (cfg.dim != null ? cfg.dim : 20) / 100);
        document.documentElement.style.setProperty('--window-alpha', (cfg.glass != null ? cfg.glass : 30) / 100);
        renderGrid(cfg);
    }

    function renderGrid(cfg) {
        const grid = document.getElementById('wpGrid');
        if (!grid) return;
        grid.innerHTML = '';
        WP_PRESETS.forEach(p => {
            const d = document.createElement('div');
            d.className = 'wp-thumb' + ((cfg.type !== 'custom' && (cfg.preset || 'aurora') === p.id) ? ' active' : '');
            d.style.background = p.css;
            d.style.backgroundSize = 'cover';
            d.title = p.name;
            d.innerHTML = `<span class="wp-thumb-name">${p.name}</span>`;
            d.onclick = () => applyWallpaper(saveCfg({ type: 'preset', preset: p.id }));
            grid.appendChild(d);
        });
        const customUrl = localStorage.getItem(WP_CUSTOM_KEY);
        if (customUrl) {
            const d = document.createElement('div');
            d.className = 'wp-thumb' + (cfg.type === 'custom' ? ' active' : '');
            d.style.background = `url("${customUrl}") center / cover no-repeat`;
            d.title = '自定义壁纸';
            d.innerHTML = `<span class="wp-thumb-name">自定义</span>`;
            d.onclick = () => applyWallpaper(saveCfg({ type: 'custom' }));
            grid.appendChild(d);
        }
        renderUserPresets(cfg, grid);
    }

    window.toggleWpPanel = function (ev) {
        if (ev) ev.stopPropagation();
        document.getElementById('wpPanel').classList.toggle('show');
    };

    // 点面板外部关闭
    document.addEventListener('click', (e) => {
        const panel = document.getElementById('wpPanel');
        if (panel && panel.classList.contains('show') && !panel.contains(e.target)) {
            panel.classList.remove('show');
        }
    });

    function mixCss(colors) {
        const [a, b, c] = colors;
        return `radial-gradient(120% 90% at 15% 0%, ${a} 0%, transparent 55%),` +
               `radial-gradient(100% 80% at 85% 10%, ${b} 0%, transparent 55%),` +
               `radial-gradient(90% 90% at 70% 100%, ${c} 0%, transparent 60%),` +
               `linear-gradient(180deg, color-mix(in srgb, ${a} 18%, #0c0e18) 0%, color-mix(in srgb, ${c} 16%, #100c1a) 100%)`;
    }
    function hslToHex(h, s, l) {
        s /= 100; l /= 100;
        const k = n => (n + h / 30) % 12;
        const f = n => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
        const to = x => Math.round(255 * x).toString(16).padStart(2, '0');
        return '#' + to(f(0)) + to(f(8)) + to(f(4));
    }
    function currentMix() {
        const cfg = loadCfg();
        return (Array.isArray(cfg.mix) && cfg.mix.length === 3) ? cfg.mix.slice() :
            [document.getElementById('wpMix0').value, document.getElementById('wpMix1').value, document.getElementById('wpMix2').value];
    }
    function syncSwatches(mix) {
        mix.forEach((c, i) => { const el = document.getElementById('wpMix' + i); if (el && /^#[0-9a-fA-F]{6}$/.test(c)) el.value = c; });
    }
    window.setMixColor = function (i, v) {
        const mix = currentMix(); mix[i] = v;
        applyWallpaper(saveCfg({ type: 'mix', mix: mix }));
    };
    window.randomMix = function () {
        const h = Math.floor(Math.random() * 360);
        const mix = [
            hslToHex(h, 62 + Math.random() * 18, 42 + Math.random() * 14),
            hslToHex((h + 60 + Math.random() * 80) % 360, 58 + Math.random() * 20, 44 + Math.random() * 14),
            hslToHex((h + 180 + Math.random() * 60) % 360, 55 + Math.random() * 20, 38 + Math.random() * 14)
        ];
        syncSwatches(mix);
        applyWallpaper(saveCfg({ type: 'mix', mix: mix }));
        if (typeof playZeldaSound === 'function') playZeldaSound('click');
    };
    // ── 用户自定义混色预设 ──
    const WP_USER_KEY = 'yimu_wp_userpresets_v1';
    function userPresets() { try { return JSON.parse(localStorage.getItem(WP_USER_KEY)) || []; } catch (e) { return []; } }
    function renderUserPresets(cfg, grid) {
        userPresets().forEach(up => {
            const d = document.createElement('div');
            const active = cfg.type === 'mix' && JSON.stringify(cfg.mix || []) === JSON.stringify(up.mix);
            d.className = 'wp-thumb' + (active ? ' active' : '');
            d.style.background = mixCss(up.mix);
            d.style.backgroundSize = 'cover';
            d.title = up.name;
            const nm = document.createElement('span'); nm.className = 'wp-thumb-name'; nm.textContent = '⭐ ' + up.name;
            const del = document.createElement('button'); del.className = 'wp-thumb-del'; del.textContent = '✕'; del.title = '删除此预设';
            del.onclick = (ev) => window.deleteMixPreset(ev, up.id);
            d.appendChild(nm); d.appendChild(del);
            d.onclick = () => { syncSwatches(up.mix); applyWallpaper(saveCfg({ type: 'mix', mix: up.mix.slice() })); };
            grid.appendChild(d);
        });
    }
    window.toggleSaveMixRow = function () {
        const r = document.getElementById('wpSaveRow');
        const show = r.style.display === 'none';
        r.style.display = show ? '' : 'none';
        if (show) { const i = document.getElementById('wpPresetName'); i.value = ''; setTimeout(() => i.focus(), 50); }
    };
    window.saveMixPreset = function () {
        const list = userPresets();
        if (list.length >= 12) { if (window.aquaNotify) aquaNotify('预设已满', '最多存 12 个自定义壁纸预设，先删掉一些再存吧', '🖼️'); else alert('自定义预设最多存 12 个，先删掉一些再存吧'); return; }
        const name = (document.getElementById('wpPresetName').value || '').trim() || ('我的配色 ' + (list.length + 1));
        const mix = currentMix();
        let maxId = 0; list.forEach(p => { const n = parseInt(String(p.id).slice(1)); if (n > maxId) maxId = n; });
        list.push({ id: 'u' + (maxId + 1), name: name, mix: mix });
        try { localStorage.setItem(WP_USER_KEY, JSON.stringify(list)); } catch (e) {}
        document.getElementById('wpSaveRow').style.display = 'none';
        applyWallpaper(saveCfg({ type: 'mix', mix: mix }));
        if (typeof playZeldaSound === 'function') playZeldaSound('victory');
    };
    window.deleteMixPreset = function (ev, id) {
        ev.stopPropagation();
        const list = userPresets().filter(p => p.id !== id);
        try { localStorage.setItem(WP_USER_KEY, JSON.stringify(list)); } catch (e) {}
        renderGrid(loadCfg());
    };
    window.setWpDim = function (v) { applyWallpaper(saveCfg({ dim: Number(v) })); };
    window.setWpGlass = function (v) { applyWallpaper(saveCfg({ glass: Number(v) })); };
    // 官方推荐默认：暗度 20 / 玻璃浓度 38（通透感最佳的调校值）
    window.resetWpDefaults = function () {
        const cfg = saveCfg({ dim: 20, glass: 38 });
        const d = document.getElementById('wpDim'), g = document.getElementById('wpGlass');
        if (d) d.value = 20;
        if (g) g.value = 38;
        applyWallpaper(cfg);
        if (typeof playZeldaSound === 'function') playZeldaSound('click');
    };

    // 上传壁纸：canvas 压缩到 2200px 内的 JPEG 再存 localStorage（避免超配额）
    window.handleWallpaperUpload = function (input) {
        const file = input.files && input.files[0];
        if (!file) return;
        const img = new Image();
        const reader = new FileReader();
        reader.onload = e => { img.src = e.target.result; };
        img.onload = () => {
            const MAX = 2200;
            const scale = Math.min(1, MAX / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            let dataUrl = canvas.toDataURL('image/jpeg', 0.82);
            try {
                localStorage.setItem(WP_CUSTOM_KEY, dataUrl);
            } catch (err) {
                // 配额不足：降质重试一次
                try {
                    dataUrl = canvas.toDataURL('image/jpeg', 0.6);
                    localStorage.setItem(WP_CUSTOM_KEY, dataUrl);
                } catch (err2) {
                    if (window.aquaNotify) aquaNotify('壁纸图片过大', '浏览器存储空间不足，请换一张小一点的图片', '🖼️'); else alert('壁纸图片过大，浏览器存储空间不足，请换一张小一点的图片。');
                    return;
                }
            }
            applyWallpaper(saveCfg({ type: 'custom' }));
        };
        reader.readAsDataURL(file);
        input.value = '';
    };

    // 初始化
    const cfg = loadCfg();
    const dimEl = document.getElementById('wpDim');
    const glassEl = document.getElementById('wpGlass');
    if (dimEl && cfg.dim != null) dimEl.value = cfg.dim;
    if (glassEl && cfg.glass != null) glassEl.value = cfg.glass;
    if (Array.isArray(cfg.mix) && cfg.mix.length === 3) syncSwatches(cfg.mix);
    applyWallpaper(cfg);
})();
