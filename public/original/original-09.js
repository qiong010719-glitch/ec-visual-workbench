/* ── Dock 磁性侧栏 ── */
(function () {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const bar = document.querySelector('.sidebar-categories'); if (!bar) return;
    const icons = Array.from(bar.querySelectorAll('.category-icon'));
    bar.addEventListener('mousemove', (e) => {
        icons.forEach(ic => {
            const r = ic.getBoundingClientRect();
            const d = Math.abs(e.clientY - (r.top + r.height / 2));
            const s = 1 + 0.3 * Math.exp(-(d * d) / 12800);
            ic.style.transform = 'scale(' + s.toFixed(3) + ')';
        });
    });
    bar.addEventListener('mouseleave', () => icons.forEach(ic => { ic.style.transform = ''; }));
})();

/* ── 通知横幅 ── */
window.aquaNotify = function (title, body, icon) {
    const stack = document.getElementById('aquaNotifyStack'); if (!stack) return;
    while (stack.children.length >= 4) stack.firstChild.remove();
    const n = document.createElement('div');
    n.className = 'aqua-notif';
    const ic = document.createElement('div'); ic.className = 'an-icon'; ic.textContent = icon || '✅';
    const tx = document.createElement('div');
    const t = document.createElement('div'); t.className = 'an-title'; t.textContent = title;
    const b = document.createElement('div'); b.className = 'an-body'; b.textContent = body || '';
    tx.appendChild(t); if (body) tx.appendChild(b);
    n.appendChild(ic); n.appendChild(tx);
    stack.appendChild(n);
    requestAnimationFrame(() => n.classList.add('show'));
    const kill = () => { n.classList.add('hide'); setTimeout(() => n.remove(), 500); };
    n.onclick = kill;
    setTimeout(kill, 6000);
};

/* ── Quick Look 图片预览 ── */
(function () {
    const overlay = document.getElementById('qlOverlay');
    const img = document.getElementById('qlImg');
    const SPRING = 'cubic-bezier(0.32, 0.72, 0, 1)';
    let items = [], idx = 0, origins = [], opened = false;

    function fitRect(nw, nh) {
        const maxW = innerWidth * 0.86, maxH = innerHeight * 0.8;
        const s = Math.min(maxW / (nw || maxW), maxH / (nh || maxH), 1e9);
        const w = (nw || maxW) * s, h = (nh || maxH) * s;
        return { left: (innerWidth - w) / 2, top: (innerHeight - h) / 2, width: w, height: h };
    }
    function setRect(r) { img.style.left = r.left + 'px'; img.style.top = r.top + 'px'; img.style.width = r.width + 'px'; img.style.height = r.height + 'px'; }
    function chrome() {
        document.getElementById('qlCounter').textContent = items.length > 1 ? (idx + 1) + ' / ' + items.length : '';
        document.getElementById('qlLabel').textContent = items[idx].label || '';
        document.getElementById('qlPrev').classList.toggle('disabled', idx <= 0);
        document.getElementById('qlNext').classList.toggle('disabled', idx >= items.length - 1);
    }
    function centerIn() {
        const apply = () => { img.style.transition = 'left 0.45s ' + SPRING + ', top 0.45s ' + SPRING + ', width 0.45s ' + SPRING + ', height 0.45s ' + SPRING + ', border-radius 0.45s ' + SPRING; requestAnimationFrame(() => setRect(fitRect(img.naturalWidth, img.naturalHeight))); };
        if (img.complete && img.naturalWidth) apply(); else img.onload = apply;
    }
    window.qlOpen = function (list, i, originEls) {
        items = list; idx = i; origins = originEls || []; opened = true;
        img.style.transition = 'none'; img.style.transform = '';
        img.src = items[idx].url;
        const o = origins[idx];
        if (o && o.getBoundingClientRect) {
            const r = o.getBoundingClientRect();
            setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
        } else { const f = fitRect(0, 0); setRect({ left: f.left + f.width * 0.1, top: f.top + f.height * 0.1, width: f.width * 0.8, height: f.height * 0.8 }); img.style.opacity = '0'; }
        overlay.classList.add('open');
        requestAnimationFrame(() => { img.style.opacity = '1'; centerIn(); chrome(); });
        if (typeof playZeldaSound === 'function') playZeldaSound('click');
    };
    window.qlClose = function () {
        if (!opened) return; opened = false;
        const o = origins[idx];
        overlay.classList.remove('open');
        overlay.style.display = 'block';
        if (o && document.contains(o)) {
            const r = o.getBoundingClientRect();
            img.style.transition = 'left 0.4s ' + SPRING + ', top 0.4s ' + SPRING + ', width 0.4s ' + SPRING + ', height 0.4s ' + SPRING + ', opacity 0.35s ease, transform 0.4s ' + SPRING;
            img.style.transform = '';
            setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
            img.style.opacity = '0.15';
        } else {
            img.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
            img.style.transform = 'scale(0.92)'; img.style.opacity = '0';
        }
        setTimeout(() => { overlay.style.display = ''; img.src = ''; img.style.opacity = '1'; img.style.transform = ''; }, 420);
    };
    window.qlNav = function (dir) {
        const ni = idx + dir; if (ni < 0 || ni >= items.length) return;
        idx = ni;
        img.style.transition = 'opacity 0.14s ease, transform 0.14s ease';
        img.style.opacity = '0'; img.style.transform = 'translateX(' + (-24 * dir) + 'px)';
        setTimeout(() => {
            img.style.transition = 'none'; img.style.transform = 'translateX(' + (24 * dir) + 'px)';
            img.src = items[idx].url;
            const show = () => { img.style.transition = 'opacity 0.25s ease, transform 0.35s ' + SPRING + ', left 0.35s ' + SPRING + ', top 0.35s ' + SPRING + ', width 0.35s ' + SPRING + ', height 0.35s ' + SPRING; requestAnimationFrame(() => { img.style.opacity = '1'; img.style.transform = ''; setRect(fitRect(img.naturalWidth, img.naturalHeight)); }); };
            if (img.complete && img.naturalWidth) show(); else img.onload = show;
            chrome();
        }, 150);
        if (typeof playZeldaSound === 'function') playZeldaSound('click');
    };
    // 下拽甩出关闭
    let g = null;
    img.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        img.setPointerCapture(e.pointerId);
        g = { sx: e.clientX, sy: e.clientY, t: performance.now(), vy: 0, ly: e.clientY, lt: performance.now() };
        img.style.transition = 'none';
    });
    img.addEventListener('pointermove', (e) => {
        if (!g) return;
        const dx = (e.clientX - g.sx) * 0.35, dy = e.clientY - g.sy;
        const now = performance.now();
        if (now - g.lt > 12) { g.vy = (e.clientY - g.ly) / ((now - g.lt) / 1000); g.ly = e.clientY; g.lt = now; }
        const s = Math.max(0.82, 1 - Math.abs(dy) / 1800);
        img.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + s + ')';
        overlay.querySelector('.ql-backdrop').style.opacity = String(Math.max(0.3, 1 - Math.abs(dy) / 500));
    });
    const endG = (e) => {
        if (!g) return;
        const dy = e.clientY - g.sy, vy = g.vy; g = null;
        overlay.querySelector('.ql-backdrop').style.opacity = '';
        if (dy > 140 || vy > 650) { window.qlClose(); }
        else { img.style.transition = 'transform 0.45s ' + SPRING; img.style.transform = ''; }
    };
    img.addEventListener('pointerup', endG);
    img.addEventListener('pointercancel', endG);
    document.addEventListener('keydown', (e) => {
        if (!opened) return;
        if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); window.qlClose(); }
        else if (e.key === 'ArrowLeft') window.qlNav(-1);
        else if (e.key === 'ArrowRight') window.qlNav(1);
    });

    // 案例图接入（覆写原 openSampleLightbox）
    window.openSampleLightbox = function (src) {
        const els = Array.from(document.querySelectorAll('img[onclick*="openSampleLightbox"]')).filter(el => el.offsetParent);
        let list = els, i = els.findIndex(el => el.src === src);
        if (i < 0) { list = els.length ? els : []; i = 0; }
        if (!list.length) { window.qlOpen([{ url: src, label: '' }], 0, []); return; }
        window.qlOpen(list.map(el => ({ url: cnBig(el.src), label: el.alt || '' })), i, list);
    };
    // 生成图接入（事件委托，图片卡点击即预览）
    document.addEventListener('click', (e) => {
        const el = e.target.closest('.quest-slot img, .ultra-card-img');
        if (!el || overlay.contains(el)) return;
        if (e.target.closest('.slot-actions') || e.target.closest('button')) return;
        const all = Array.from(document.querySelectorAll('.quest-slot img, .ultra-card-img')).filter(n => n.offsetParent);
        const i = Math.max(0, all.indexOf(el));
        window.qlOpen(all.map((n, k) => {
            const lab = n.closest('.ultra-card') ? (n.closest('.ultra-card').querySelector('.ultra-card-label') || {}).textContent : '';
            return { url: cnBig(n.src), label: (lab || '').trim() || ('第 ' + (k + 1) + ' 张') };
        }), i, all);
    });
})();
