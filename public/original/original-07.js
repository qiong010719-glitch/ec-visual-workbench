(function () {
    const overlay = document.getElementById('tipCenterOverlay');
    const content = document.getElementById('tipCenterContent');
    const closeBtn = document.getElementById('tipCenterClose');
    const READ_KEY = 'hyrule_tip_read_v1';     // 已读(点过"知道了")的图标
    const SEEN_KEY = 'hyrule_tip_autoseen_v1'; // 已自动弹过一次的图标
    let currentId = null;

    function loadSet(k){ try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch(e){ return new Set(); } }
    function addTo(k, id){ try { const st = loadSet(k); st.add(id); localStorage.setItem(k, JSON.stringify([...st])); } catch(e){} }

    // 已读的图标置灰；未读保持醒目金色
    function paint(tip) {
        const icon = tip.querySelector('.tooltip-icon');
        if (!icon) return;
        if (loadSet(READ_KEY).has(tip.id)) {
            icon.style.color = 'var(--text-3)';
            icon.classList.remove('newbie-breathe');
            icon.style.opacity = '0.55';
            tip.title = '已读 · 点击可再看';
        } else {
            icon.style.color = '#FFD60A';
            icon.style.opacity = '1';
            tip.title = '使用技巧 · 点击查看';
        }
    }
    function paintAll(){ document.querySelectorAll('.guide-tooltip').forEach(paint); }

    function openTip(tip) {
        const src = tip.querySelector('.tooltip-content');
        if (!src) return;
        if (overlay.classList.contains('show')) return;   // 已开着不重复渲染，防闪
        currentId = tip.id;
        content.innerHTML = src.innerHTML;
        overlay.classList.add('show');
    }
    function closeTip(){ overlay.classList.remove('show'); }

    function bind(tip) {
        if (!tip.id) tip.id = 'guideTip_' + Math.random().toString(36).slice(2, 8);
        paint(tip);
        // 悬停：仅"首次"自动弹一次，之后不再骚扰
        tip.addEventListener('mouseenter', function () {
            if (loadSet(SEEN_KEY).has(tip.id)) return;
            addTo(SEEN_KEY, tip.id);
            openTip(tip);
        });
        // 点击：任何时候都能主动打开
        tip.addEventListener('click', function (e) { e.stopPropagation(); openTip(tip); });
    }
    function bindAll(){ document.querySelectorAll('.guide-tooltip').forEach(bind); }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindAll);
    else bindAll();

    // 只有点「知道了」才算已读 → 图标置灰
    closeBtn.addEventListener('click', function () {
        if (currentId) { addTo(READ_KEY, currentId); addTo(SEEN_KEY, currentId); paintAll(); }
        closeTip();
    });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeTip(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeTip(); });
})();
