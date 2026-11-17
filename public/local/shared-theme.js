/* Page labels only. Global navigation is rendered in the initial HTML. */
(() => {
  if(window.WorkbenchPlatform!=='temu')return;
  function setup(){
    const subtitle=document.querySelector('.ws-subtitle');if(subtitle)subtitle.textContent='产品做图、套图裂变与上架';
    const heading=document.querySelector('.ws-header h2');if(heading)heading.textContent='生图工作台';
    const modeLabel=document.querySelector('.panel-glass h3.border-l-2');if(modeLabel)modeLabel.setAttribute('aria-hidden','true');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
