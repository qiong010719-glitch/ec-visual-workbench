(function () {
    const KEY = 'yimu_spotlight_v1';
    const layer = document.getElementById('spotlightLayer');
    const btn = document.getElementById('spotlightBtn');
    let on = false, raf = null;
    let tx = innerWidth / 2, ty = innerHeight / 2, cx = tx, cy = ty;
    document.addEventListener('mousemove', (e) => { tx = e.clientX; ty = e.clientY; }, { passive: true });
    function tick() {
        cx += (tx - cx) * 0.16; cy += (ty - cy) * 0.16;
        layer.style.setProperty('--sl-x', cx.toFixed(1) + 'px');
        layer.style.setProperty('--sl-y', cy.toFixed(1) + 'px');
        raf = on ? requestAnimationFrame(tick) : null;
    }
    function apply() {
        document.body.classList.toggle('spotlight-on', on);
        if (btn) { const sl = document.getElementById('spotLabel'); if (sl) sl.textContent = on ? '全亮' : '聚光'; btn.classList.toggle('spot-on', on); btn.title = on ? '点击恢复整体亮度' : '鼠标聚光：光圈跟随鼠标，四周轻微压暗'; }
        if (on && !raf) { cx = tx; cy = ty; raf = requestAnimationFrame(tick); }
    }
    window.toggleSpotlight = function () {
        on = !on; apply();
        try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
        if (typeof playZeldaSound === 'function') playZeldaSound('click');
    };
    try { on = localStorage.getItem(KEY) !== '0'; } catch (e) { on = true; }
    apply();
})();
