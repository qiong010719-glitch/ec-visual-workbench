(function () {
    document.addEventListener('drop', (e) => {
        const cell = e.target.closest ? e.target.closest('[onclick^="openUploader"]') : null;
        if (!cell || !e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
        const r = cell.getBoundingClientRect();
        const files = Array.from(e.dataTransfer.files).filter(f => f.type && f.type.startsWith('image/')).slice(0, 3);
        files.forEach((f, i) => {
            try {
                const url = URL.createObjectURL(f);
                const g = document.createElement('img');
                g.src = url; g.className = 'absorb-ghost';
                const size = 90;
                g.style.left = (e.clientX - size / 2 + i * 14) + 'px';
                g.style.top = (e.clientY - size / 2 + i * 10) + 'px';
                g.style.width = size + 'px'; g.style.height = size + 'px';
                g.style.opacity = '0.95';
                g.style.transition = 'all 0.55s cubic-bezier(0.32, 0.72, 0, 1)';
                document.body.appendChild(g);
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    g.style.left = (r.left + r.width / 2 - 8) + 'px';
                    g.style.top = (r.top + r.height / 2 - 8) + 'px';
                    g.style.width = '16px'; g.style.height = '16px';
                    g.style.opacity = '0';
                }));
                setTimeout(() => { URL.revokeObjectURL(url); g.remove(); }, 750);
            } catch (err) {}
        });
        cell.classList.remove('cell-gulp'); void cell.offsetWidth; cell.classList.add('cell-gulp');
        setTimeout(() => cell.classList.remove('cell-gulp'), 650);
        if (typeof playZeldaSound === 'function') playZeldaSound('click');
    }, true);
})();
