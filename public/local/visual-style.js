/* Style preferences are independent for fast, master and ultra modes. */
(() => {
  const key='workbench-visual-style-by-mode-v1';
  let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}') || {};}catch{}
  const mode=()=>document.getElementById('generationMode')?.value || 'fast';
  window.getLocalVisualStyle=value=>saved[value || mode()]==='original'?'original':'scene_advertising';
  function setup(){
    const anchor=document.getElementById('modeDescription');if(!anchor)return;
    const panel=document.createElement('div');panel.id='localVisualStylePanel';panel.style.cssText='padding:12px;border:1px solid #ffffff24;border-radius:12px;background:#ffffff06';
    panel.innerHTML='<label for="localVisualStyle" style="display:block;font-size:12px;color:#b9c4d9;margin-bottom:6px">本模式的图片风格</label><select id="localVisualStyle" class="sheikah-input" style="width:100%;font-size:13px"><option value="scene_advertising">场景广告风格 · 跨类目参考</option><option value="original">原有风格</option></select><p id="localVisualStyleHint" style="font-size:11px;color:#a3afc7;line-height:1.7;margin-top:7px"></p>';
    anchor.after(panel);
    const select=panel.querySelector('select'),hint=panel.querySelector('p');
    function update(){
      select.value=window.getLocalVisualStyle();
      const master=mode()==='master',ultra=mode()==='ultra_fast';
      panel.querySelector('label').textContent=(master?'大师模式':ultra?'极速模式':'快速设计模式')+' · 图片风格';
      hint.textContent=select.value==='original'?'沿用本模式原有视觉规则。':master?'用完整场景、自然动作、细节图解和佩戴／使用关系讲清卖点。A+ 继续展开使用过程和选购问题，整套保持统一光影与配色。':ultra?'每个分镜分别表达一个购买问题，结合场景、动作与细节，整套统一配色和字体。':'用具体场景、细节和图文关系讲清卖点；A+ 补充主图没有展开的内容。信息密度与场景倾向分别生效。';
      for(const id of ['infoDensity','sceneIntensity']){
        const control=document.getElementById(id);if(!control)continue;
        control.disabled=master||ultra;control.style.opacity=master||ultra?'.4':'1';
        control.title=master?'该选项仅用于快速设计；大师模式独立规划摄影与文案。':id==='infoDensity'?'快速设计：控制文字与图标的信息密度。':'快速设计：控制真实使用场景的比重，与信息密度分别生效。';
      }
    }
    select.addEventListener('change',()=>{
      saved[mode()]=select.value;try{localStorage.setItem(key,JSON.stringify(saved));}catch{}
      update();
      if(mode()!=='ultra_fast'){
        const button=document.getElementById('mainBtn');if(button){button.disabled=true;button.classList.remove('ready-to-fuse');}
        hint.textContent+=' 风格已更改，请重新构思后生成。';
      }
    });
    document.getElementById('generationMode')?.addEventListener('change',update);update();
    window.restoreLocalVisualStyle=(value,currentMode)=>{saved[currentMode]=value;localStorage.setItem(key,JSON.stringify(saved));update();};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
