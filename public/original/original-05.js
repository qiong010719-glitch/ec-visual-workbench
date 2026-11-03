(function () {
    const SELS = Array.from(document.querySelectorAll('select.sheikah-input')).filter(s => !s.classList.contains('hidden'));
    let openPop = null, openTrig = null;

    function optionLabel(sel) {
        const o = sel.options[sel.selectedIndex];
        return o ? o.text : '请选择…';
    }
    function closePop() {
        if (!openPop) return;
        const p = openPop;
        p.classList.remove('show');
        setTimeout(() => p.remove(), 200);
        openPop = null; openTrig = null;
    }
    function buildPop(sel, trig) {
        const pop = document.createElement('div');
        pop.className = 'gsel-pop custom-scrollbar';
        if (sel.id === 'designScope') {
            const modeSel = document.getElementById('generationMode');
            const modeName = { ultra_fast: '极速飙车', fast: '快速设计', master: '大师设计' }[modeSel ? modeSel.value : ''] || '';
            if (modeName) {
                const g = document.createElement('div');
                g.className = 'gsel-group';
                g.textContent = '当前模式：' + modeName + ' · 可选范围随模式变化';
                pop.appendChild(g);
            }
        }
        const walk = (parent) => {
            Array.from(parent.children).forEach(node => {
                if (node.tagName === 'OPTGROUP') {
                    const g = document.createElement('div');
                    g.className = 'gsel-group'; g.textContent = node.label;
                    pop.appendChild(g); walk(node);
                } else if (node.tagName === 'OPTION') {
                    if (node.disabled) return;
                    const it = document.createElement('div');
                    it.className = 'gsel-item' + (node.selected ? ' sel' : '');
                    const check = document.createElement('span'); check.className = 'gsel-check'; check.textContent = '✓';
                    const label = document.createElement('span'); label.textContent = node.text;
                    it.appendChild(check); it.appendChild(label);
                    it.onclick = () => {
                        sel.value = node.value;
                        sel.dispatchEvent(new Event('change', { bubbles: true }));
                        if (typeof playZeldaSound === 'function') playZeldaSound('click');
                        closePop();
                    };
                    pop.appendChild(it);
                }
            });
        };
        walk(sel);
        return pop;
    }
    SELS.forEach(sel => {
        sel.classList.add('gsel-native');
        const trig = document.createElement('button');
        trig.type = 'button';
        trig.className = 'gsel-trigger';
        const lab = document.createElement('span');
        lab.className = 'gsel-label'; lab.textContent = optionLabel(sel);
        trig.appendChild(lab);
        sel.insertAdjacentElement('afterend', trig);
        trig.onclick = (e) => {
            e.stopPropagation();
            if (openTrig === trig) { closePop(); return; }
            closePop();
            const pop = buildPop(sel, trig);
            document.body.appendChild(pop);
            const r = trig.getBoundingClientRect();
            pop.style.minWidth = Math.max(r.width, 240) + 'px';
            const w = pop.offsetWidth, h = pop.offsetHeight;
            pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 12)) + 'px';
            if (r.bottom + h + 10 > window.innerHeight && r.top - h - 10 > 0) {
                pop.style.top = (r.top - h - 8) + 'px';
                pop.style.transformOrigin = 'bottom center';
            } else {
                pop.style.top = (r.bottom + 8) + 'px';
            }
            requestAnimationFrame(() => pop.classList.add('show'));
            openPop = pop; openTrig = trig;
        };
        sel.addEventListener('change', () => { lab.textContent = optionLabel(sel); });
        setInterval(() => {  // 程序恢复存档等静默改值时同步触发器文字
            const t = optionLabel(sel);
            if (lab.textContent !== t) lab.textContent = t;
        }, 800);
    });
    document.addEventListener('click', (e) => { if (openPop && !openPop.contains(e.target)) closePop(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
    window.addEventListener('scroll', closePop, true);
    window.addEventListener('resize', closePop);
})();
