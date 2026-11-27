export const CAPTCHA_DIAGNOSTIC_MESSAGES=Object.freeze({
  'loading-images':'验证码图片仍未加载完成，已等待就绪但未调用 SadCaptcha；原页面已保留。',
  'page-loading':'验证码页面仍在加载，已等待就绪但未调用 SadCaptcha；原页面已保留。',
  'slider-blocked':'已找到滑块，但滑块操作位置被遮挡或不可点击；未调用 SadCaptcha，原页面已保留。',
  'slider-not-origin':'已找到滑块，但滑块或拼块不在起始位置；未调用 SadCaptcha，原页面已保留。',
  'slider-structure-mismatch':'已找到滑块区域，但图片、拼块或滑轨结构不符合当前适配条件；未调用 SadCaptcha，原页面已保留。',
  'point-structure-mismatch':'已找到点选验证码区域，但图片、题目或提交按钮结构不符合当前适配条件；未调用 SadCaptcha，原页面已保留。',
  'grid-structure-mismatch':'已找到九宫格区域，但图片、题目、顺序或提交按钮不符合当前适配条件；未调用 SadCaptcha，原页面已保留。',
  'embedded-frame-unsupported':'验证码位于尚未适配的嵌入页面中；未调用 SadCaptcha，原页面已保留。',
  'shadow-root-unsupported':'点选或九宫格验证码位于尚未适配的封装组件中；未调用 SadCaptcha，原页面已保留。',
  'unsupported-layout':'未识别到当前支持的验证码页面结构；未调用 SadCaptcha，原页面已保留。',
  'inspection-unavailable':'验证码页面状态读取失败，未调用 SadCaptcha；原页面已保留，可检查页面后继续。'
});
export const CAPTCHA_DIAGNOSTIC_CODES=Object.freeze(Object.keys(CAPTCHA_DIAGNOSTIC_MESSAGES));
const TYPES=new Set(['slider','point','grid','unknown']);
const bounded=(value,max)=>typeof value==='number'&&Number.isFinite(value)?Math.min(max,Math.max(0,Math.floor(value))):0;

// Persist only this allow-listed summary; page text, URLs and image bytes never cross it.
export function sanitizeCaptchaDiagnostic(value){
  if(!value||typeof value!=='object'||!CAPTCHA_DIAGNOSTIC_CODES.includes(value.code))return null;
  const images=bounded(value.images,100);
  return {code:value.code,type:TYPES.has(value.type)?value.type:'unknown',probes:bounded(value.probes,40),
    frames:bounded(value.frames,20),shadowRoots:bounded(value.shadowRoots,20),images,loadedImages:Math.min(images,bounded(value.loadedImages,100))};
}

export function getCaptchaDiagnosticMessage(value){
  const code=typeof value==='string'?value:value?.code;
  return Object.hasOwn(CAPTCHA_DIAGNOSTIC_MESSAGES,code)?CAPTCHA_DIAGNOSTIC_MESSAGES[code]:CAPTCHA_DIAGNOSTIC_MESSAGES['inspection-unavailable'];
}

// Standalone page.evaluate reader. It reports rendered structure only and performs no actions.
export function readTemuCaptchaDiagnostic({probes=0,sliderBlocked=false,sliderNotOrigin=false}={}){
  const contexts=[{root:document,embedded:false,shadow:false}],images=new Set();
  const visible=element=>{
    if(!element?.getClientRects().length)return false;
    const style=element.ownerDocument.defaultView.getComputedStyle(element);
    return style.visibility!=='hidden'&&style.display!=='none';
  };
  let frames=0,shadowRoots=0,point=false,grid=false,slider=false,embeddedUnsupported=false,shadowUnsupported=false,pageLoading=document.readyState==='loading';
  for(let index=0;index<contexts.length&&index<40;index++){
    const context=contexts[index],root=context.root;
    const points=[...root.querySelectorAll('#Picture')].filter(visible),grids=[...root.querySelectorAll('#imageSemantics')].filter(visible);
    const sliders=[...root.querySelectorAll('#verification')].filter(visible);
    point||=points.length>0;grid||=grids.length>0;slider||=sliders.length>0;
    if((points.length||grids.length)&&context.embedded)embeddedUnsupported=true;
    if((points.length||grids.length)&&context.shadow)shadowUnsupported=true;
    const scopes=[...new Set([...points,...grids,...sliders,...root.querySelectorAll('[id*="captcha"],[class*="captcha"],[id*="Captcha"],[class*="Captcha"]')])].filter(visible);
    if(scopes.length&&(root.nodeType===9?root:root.ownerDocument)?.readyState==='loading')pageLoading=true;
    for(const scope of scopes){
      if(scope.tagName==='IMG'&&images.size<100)images.add(scope);
      for(const image of scope.querySelectorAll('img'))if(visible(image)&&images.size<100)images.add(image);
    }
    for(const frame of root.querySelectorAll('iframe')){
      if(!visible(frame)||frames>=20)continue;
      frames++;
      let child;try{child=frame.contentDocument;}catch{/* Only counts and known marker presence are reported. */}
      if(child&&contexts.length<40)contexts.push({root:child,embedded:true,shadow:context.shadow});
      else if(/captcha|challenge|verification/i.test((frame.getAttribute('src')||'')+' '+(frame.title||'')))embeddedUnsupported=true;
    }
    for(const element of root.querySelectorAll('*'))if(element.shadowRoot&&visible(element)&&shadowRoots<20){
      shadowRoots++;
      if(contexts.length<40)contexts.push({root:element.shadowRoot,embedded:context.embedded,shadow:true});
    }
  }
  const loadedImages=[...images].filter(image=>image.complete&&image.naturalWidth>0).length;
  const type=grid?'grid':point?'point':slider?'slider':'unknown';
  // Known interaction blockers win over incidental page loading. Embedded point/grid
  // structures cannot be handled by the current readers, even if their images load.
  const code=sliderBlocked?'slider-blocked':sliderNotOrigin?'slider-not-origin':embeddedUnsupported?'embedded-frame-unsupported':shadowUnsupported?'shadow-root-unsupported':
    images.size>loadedImages?'loading-images':pageLoading?'page-loading':grid?'grid-structure-mismatch':point?'point-structure-mismatch':slider?'slider-structure-mismatch':'unsupported-layout';
  return {code,type,probes:Math.min(40,Math.max(0,Math.floor(Number(probes)||0))),frames,shadowRoots,images:images.size,loadedImages};
}
