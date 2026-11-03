function showUltraFastWarning() {
    const m = document.getElementById('ultraFastWarningModal');
    m.style.display = 'flex';
}

// ── 模式分段控件的滑块（v17.1）：跟着 .mode-active 走，不改 setModeUI 本身 ──
(function () {
    const seg = document.getElementById('modeSeg');
    const thumb = document.getElementById('modeThumb');
    if (!seg || !thumb) return;
    let raf = 0;
    function place() {
        raf = 0;
        const active = seg.querySelector('.mode-btn.mode-active');
        if (!active) { seg.classList.remove('has-thumb'); return; }
        const pad = 4;
        thumb.style.width = active.offsetWidth + 'px';
        thumb.style.transform = 'translateX(' + (active.offsetLeft - pad) + 'px)';
        seg.classList.add('has-thumb');
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(place); };
    new MutationObserver(schedule).observe(seg, { subtree: true, attributes: true, attributeFilter: ['class'] });
    const dash = document.getElementById('view-dashboard');
    if (dash) new MutationObserver(() => { schedule(); setTimeout(schedule, 60); }).observe(dash, { attributes: true, attributeFilter: ['class'] });
    if (window.ResizeObserver) new ResizeObserver(schedule).observe(seg);
    window.addEventListener('resize', schedule);
    schedule();
})();
