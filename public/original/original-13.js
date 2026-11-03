(function () {
    const KEY = 'yimu_wp_hint_v1';
    const hint = document.getElementById('wpHint');
    if (!hint) return;
    try { if (localStorage.getItem(KEY) === 'never') return; } catch (e) {}
    hint.style.display = '';

    function dismiss(permanent) {
        if (permanent) { try { localStorage.setItem(KEY, 'never'); } catch (e) {} }
        hint.classList.add('fading');
        setTimeout(() => hint.remove(), 400);
    }
    window.wpHintAskClose = function (ev) {
        ev.stopPropagation();
        hint.innerHTML = '<span class="wp-hint-text">下次还提醒吗？</span>'
            + '<button class="wp-hint-choice" onclick="wpHintDismiss(event, false)">暂时关闭</button>'
            + '<button class="wp-hint-choice perm" onclick="wpHintDismiss(event, true)">不再提示</button>';
    };
    window.wpHintDismiss = function (ev, permanent) { ev.stopPropagation(); dismiss(permanent); };
    // 用户点开壁纸面板 = 引导达成，提示永久退场
    const btn = document.getElementById('wpBtn');
    if (btn) btn.addEventListener('click', () => { if (document.body.contains(hint)) dismiss(true); });
})();
