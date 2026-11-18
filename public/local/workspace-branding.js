/* UI branding only: provider URLs, API names, keys and pricing remain intact. */
(() => {
  const replace=text=>text.replace(/极鲸云/g,'选品数据服务').replace(/GeekBI/gi,'选品数据服务');
  function clean(root){
    if(root.nodeType===Node.TEXT_NODE){if(!root.parentElement?.closest('script,style,textarea,input,pre,code')){const next=replace(root.nodeValue);if(next!==root.nodeValue)root.nodeValue=next;}return;}
    if(root.nodeType!==Node.ELEMENT_NODE)return;
    if(root.matches('script,style,textarea,input,pre,code'))return;
    if(root.matches('img')&&/极鲸云|geekbi/i.test([root.alt,root.getAttribute('data-brand'),root.src].join(' '))&&/logo|标识/i.test([root.alt,root.className,root.src].join(' ')))root.hidden=true;
    for(const name of ['alt','title','aria-label'])if(root.hasAttribute(name)){const value=root.getAttribute(name),next=replace(value);if(value!==next)root.setAttribute(name,next);}
    for(const child of root.childNodes)clean(child);
  }
  clean(document.body);
  new MutationObserver(records=>{for(const r of records)if(r.type==='characterData')clean(r.target);else for(const node of r.addedNodes)clean(node);}).observe(document.body,{childList:true,subtree:true,characterData:true});
})();
