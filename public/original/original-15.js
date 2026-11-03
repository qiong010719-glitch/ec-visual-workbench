(function () {
    const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform);
    const mod = isMac ? '⌘' : 'Ctrl';
    const hint = document.getElementById('kbdHint');
    if (hint) hint.innerHTML = '<kbd>' + mod + '</kbd><kbd>↩</kbd><span>快速生成</span><span class="kbd-sep">·</span><kbd>Esc</kbd><span>关闭弹层</span>';
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            const fe = document.getElementById('fieldEditorModal');
            if (fe && fe.classList.contains('show')) return;
            const mainBtn = document.getElementById('mainBtn');
            const agentBtn = document.getElementById('agentBtn');
            if (mainBtn && !mainBtn.disabled) { e.preventDefault(); mainBtn.click(); }
            else if (agentBtn && agentBtn.style.display !== 'none' && !agentBtn.disabled) { e.preventDefault(); agentBtn.click(); }
        }
    });
})();
