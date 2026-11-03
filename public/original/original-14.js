(function () {
    const KEY = 'yimu_spot_hint_v1';
    const hint = document.getElementById('spotHint');
    if (!hint) return;
    try { if (localStorage.getItem(KEY) === 'never') return; } catch (e) {}
    // 比壁纸提示晚 2.5s 出场，避免同时弹两个气泡
    setTimeout(() => { if (document.body.contains(hint)) hint.style.display = ''; }, 2500);

    function dismiss(permanent) {
        if (permanent) { try { localStorage.setItem(KEY, 'never'); } catch (e) {} }
        hint.classList.add('fading');
        setTimeout(() => hint.remove(), 400);
    }
    window.spotHintAskClose = function (ev) {
        ev.stopPropagation();
        hint.innerHTML = '<span class="wp-hint-text">下次还提醒吗？</span>'
            + '<button class="wp-hint-choice" onclick="spotHintDismiss(event, false)">暂时关闭</button>'
            + '<button class="wp-hint-choice perm" onclick="spotHintDismiss(event, true)">不再提示</button>';
    };
    window.spotHintDismiss = function (ev, permanent) { ev.stopPropagation(); dismiss(permanent); };
    const btn = document.getElementById('spotlightBtn');
    if (btn) btn.addEventListener('click', () => { if (document.body.contains(hint)) dismiss(true); });
})();
