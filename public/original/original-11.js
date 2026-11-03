(function () {
    // 1) 生成图揭幕显影
    document.addEventListener('load', (e) => {
        const img = e.target;
        if (!(img instanceof HTMLImageElement)) return;
        if (!img.closest('.quest-slot') && !img.classList.contains('ultra-card-img')) return;
        if (img.dataset.revealed) return;
        img.dataset.revealed = '1';
        img.classList.add('img-reveal');
        img.addEventListener('animationend', () => img.classList.remove('img-reveal'), { once: true });
    }, true);

    // 2) 结果卡 3D 视差微倾
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        let tiltEl = null;
        document.addEventListener('mousemove', (e) => {
            const card = e.target.closest ? e.target.closest('.quest-slot, .ultra-card-img-wrap') : null;
            if (tiltEl && tiltEl !== card) {
                tiltEl.style.transition = 'transform 0.5s cubic-bezier(0.32, 0.72, 0, 1)';
                tiltEl.style.transform = '';
                tiltEl = null;
            }
            if (!card) return;
            const r = card.getBoundingClientRect();
            const px = (e.clientX - r.left) / r.width - 0.5;
            const py = (e.clientY - r.top) / r.height - 0.5;
            card.style.transition = 'transform 0.12s ease-out';
            card.style.transform = 'perspective(800px) rotateX(' + (-py * 5).toFixed(2) + 'deg) rotateY(' + (px * 5).toFixed(2) + 'deg) translateY(-2px)';
            tiltEl = card;
        }, { passive: true });
        document.addEventListener('mouseleave', () => { if (tiltEl) { tiltEl.style.transform = ''; tiltEl = null; } });
    }

    // 3) 上传格磁吸光晕
    let magnetEl = null;
    function clearMagnet() { if (magnetEl) { magnetEl.classList.remove('drop-magnet'); magnetEl = null; } }
    document.addEventListener('dragover', (e) => {
        if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
        let best = null, bestD = 300;
        document.querySelectorAll('[onclick^="openUploader"]').forEach(c => {
            const r = c.getBoundingClientRect();
            if (!r.width) return;
            const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
            if (d < bestD) { bestD = d; best = c; }
        });
        if (best !== magnetEl) { clearMagnet(); if (best) { best.classList.add('drop-magnet'); magnetEl = best; } }
    });
    document.addEventListener('drop', clearMagnet, true);
    document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) clearMagnet(); });

    // 4) SOP 打字机流光：真实值立即写入（逻辑安全），视觉层做打字动画
    window.typewriterFill = function (el, text) {
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        try {
            const r = el.getBoundingClientRect();
            if (!r.width || !text || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            const cs = getComputedStyle(el);
            const ov = document.createElement('div');
            ov.className = 'sop-typing-overlay custom-scrollbar';
            ov.style.cssText += 'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;'
                + 'padding:' + cs.padding + ';font:' + cs.font + ';color:' + cs.color + ';'
                + 'background:#16181f;border-radius:' + cs.borderRadius + ';border:' + cs.border + ';';
            document.body.appendChild(ov);
            el.style.visibility = 'hidden';
            let i = 0;
            const total = Math.max(1, text.length);
            const step = Math.max(4, Math.ceil(total / 110));
            (function type() {
                i += step;
                ov.textContent = text.slice(0, i) + (i < total ? ' ▌' : '');
                ov.scrollTop = ov.scrollHeight;
                if (i < total && document.body.contains(ov)) requestAnimationFrame(type);
                else { el.style.visibility = ''; ov.remove(); }
            })();
        } catch (err) { el.style.visibility = ''; }
    };
})();
