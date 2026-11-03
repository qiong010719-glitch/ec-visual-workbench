(function () {
    const FE_CONFIG = {
        prodName: {
            title: '产品名称及物理特征',
            hint: '<strong>作用：</strong>AI 会用它+参考图建立产品的「物理档案」，全流程靠它防止把产品画走样。<br>' +
                  '<strong>✅ 要写：</strong>品类 + 尺寸/容量 + 材质 + 结构形态。<br>' +
                  '<strong>❌ 别写：</strong>高端、奢华、爆款这类营销形容词——不影响出图，只会稀释重点。<br>' +
                  '<strong>💡 有参数一定写具体数字</strong>：AI 对大小没概念时最容易把比例画错。',
            warn: false,
            placeholder: '例：不锈钢保温杯 500ml，双层真空，杯身直径 7cm、高 22cm，翻盖式杯口，哑光磨砂表面…'
        },
        prodDesc: {
            title: '详细核心卖点描述',
            hint: '<strong>一条一行，越精简越准</strong>——大段文字会稀释重点，AI 信息越集中越不容易出幻觉。<br>' +
                  '<strong>✅ 要写：</strong>功能、参数、解决什么问题、给谁用。<b>冷门产品务必写清使用场景</b>（例：户外露营时装热水）——AI 不认识的产品最容易在用法上翻车。<br>' +
                  '<strong>❌ 千万别写视觉指令：</strong>配色、字体、光线、构图、画面风格。这些由系统内置的 4 位视觉专家（色彩/美学/字体/亚马逊合规）决定，<b>你写了会覆盖他们的专业判断，出图反而更差</b>。<br>' +
                  '<span style="opacity:.85;">注意区分：「露营时装热水」是产品事实 ✅；「画面要夜景冷色调」是视觉指令 ❌。</span>',
            warn: false,
            placeholder: '例：\n· 24 小时保冷 / 12 小时保温\n· 食品级 316 不锈钢内胆，无异味\n· 一键开盖，单手可操作\n· 户外露营、通勤、健身房均适用…'
        },
        strictReq: {
            title: '强制设计要求（最高优先级）',
            hint: '<strong>选填，而且越少越好（建议 ≤2 条）。</strong>这里的要求 AI 会最高优先级执行。<br>' +
                  '<strong>✅ 最该用来：</strong>纠正 AI 容易画错的物理形态（例：杯盖是翻盖不是旋盖；支架是三脚不是四脚），以及硬性红线（必须白底 / 严禁人物出镜 / LOGO 保持原样）。<br>' +
                  '<strong>❌ 别把视觉偏好堆这里</strong>（配色、风格、氛围）——它优先级太高，会压制视觉专家的判断，出图反而变差。<br>' +
                  '<span style="opacity:.85;">没有硬性要求就留空，这很正常。</span>',
            warn: true,
            placeholder: '例：杯盖为翻盖结构，不是旋盖；必须纯白背景，严禁人物出镜…'
        }
    };
    let feTarget = null;
    const modal = document.getElementById('fieldEditorModal');
    const box = document.getElementById('feBox');
    const ta = document.getElementById('feTextarea');
    const count = document.getElementById('feCount');

    window.openFieldEditor = function (id) {
        const cfg = FE_CONFIG[id]; if (!cfg) return;
        feTarget = document.getElementById(id);
        document.getElementById('feTitle').textContent = cfg.title;
        document.getElementById('feHint').innerHTML = cfg.hint;
        box.classList.toggle('warn', cfg.warn);
        ta.value = feTarget.value;
        ta.placeholder = cfg.placeholder;
        updateCount();
        modal.classList.add('show');
        if (typeof playZeldaSound === 'function') playZeldaSound('click');
        setTimeout(() => ta.focus(), 60);
    };
    window.closeFieldEditor = function () { modal.classList.remove('show'); feTarget = null; };
    window.confirmFieldEditor = function () {
        if (!feTarget) return;
        feTarget.value = ta.value.trim();
        feTarget.dispatchEvent(new Event('input', { bubbles: true }));
        if (typeof playZeldaSound === 'function') playZeldaSound('click');
        window.closeFieldEditor();
    };
    function updateCount() { count.textContent = ta.value.length ? ta.value.length + ' 字' : ''; }
    ta.addEventListener('input', updateCount);
    ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') window.confirmFieldEditor(); });
    modal.addEventListener('click', (e) => { if (e.target === modal) window.closeFieldEditor(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('show')) window.closeFieldEditor(); });
})();
