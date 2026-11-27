import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {createSadCaptchaClient} from './sadcaptcha-client.mjs';
import {temuGoodsId} from './geekbi.mjs';
import {readTemuGrid,solveTemuGrid} from './temu-grid-captcha.mjs';
import {readTemuCaptchaDiagnostic,sanitizeCaptchaDiagnostic,getCaptchaDiagnosticMessage} from './temu-captcha-diagnostics.mjs';

export function isTemuVerificationReturn(observed,args){
  if(observed?.status!=='ready')return false;
  try{
    const url=new URL(observed.url);
    if(url.protocol!=='https:'||!['www.temu.com','temu.com'].includes(url.hostname)||url.username||url.password||url.port)return false;
    if(args.goodsId)return temuGoodsId(observed.url)===String(args.goodsId)&&(!!observed.button||observed.pluginStatus==='success');
    return !!args.keyword&&url.pathname==='/search_result.html'&&url.searchParams.get('search_key')===args.keyword&&observed.searchListStatus==='ready'&&observed.products?.some(p=>!!temuGoodsId(p.sourceUrl))===true;
  }catch{return false;}
}

// Read rendered elements only. Selectors describe the documented Temu slider layout;
// an unfamiliar layout must not consume a recognition request.
export function readTemuSlider(){
  const roots=[];
  const walk=(root,offsetX=0,offsetY=0)=>{
    roots.push({root,offsetX,offsetY});
    for(const el of root.querySelectorAll('*'))if(el.shadowRoot)walk(el.shadowRoot,offsetX,offsetY);
    for(const frame of root.querySelectorAll('iframe'))try{
      const doc=frame.contentDocument,r=frame.getBoundingClientRect();
      if(doc&&r.width&&r.height&&Math.abs(r.width-frame.offsetWidth)<2)walk(doc,offsetX+r.x+frame.clientLeft,offsetY+r.y+frame.clientTop);
    }catch{ /* Cross-origin frames require a separately verified adapter. */ }
  };
  walk(document);
  const visible=e=>e&&e.getClientRects().length&&e.ownerDocument.defaultView.getComputedStyle(e).visibility!=='hidden'&&e.ownerDocument.defaultView.getComputedStyle(e).display!=='none';
  const candidates=[];
  for(const context of roots)for(const wrapper of context.root.querySelectorAll('#verification')){
    if(!visible(wrapper))continue;
    const one=selector=>{const found=[...wrapper.querySelectorAll(selector)].filter(visible);return found.length===1?found[0]:null;};
    let puzzle=one('#slider > img'),piece=one('#img-button > img'),pieceContainer=one('#img-button'),handle=one('#slide-button'),rail,layout='legacy';
    if(!puzzle){
      // Observed 2026-11-21: current Temu uses random IDs for the linear puzzle.
      // Identify the visible background, its absolute sibling piece, and the rail thumb.
      puzzle=one('img[class*="bgImg-"]');rail=one('[class*="handleBar-"]');
      if(puzzle&&rail){
        const view=wrapper.ownerDocument.defaultView;
        const pieces=[...puzzle.parentElement.children].filter(e=>e!==puzzle&&visible(e)&&view.getComputedStyle(e).position==='absolute'&&e.querySelectorAll('img').length===1);
        const handles=[...rail.children].filter(e=>visible(e)&&view.getComputedStyle(e).position==='absolute'&&view.getComputedStyle(e).cursor==='pointer');
        if(pieces.length===1&&handles.length===1){pieceContainer=pieces[0];piece=pieceContainer.querySelector('img');handle=handles[0];layout='dynamic';}
      }
    }
    if(!puzzle||!piece||!handle||!puzzle.complete||!piece.complete||!puzzle.naturalWidth||!piece.naturalWidth)continue;
    const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x+context.offsetX,y:r.y+context.offsetY,width:r.width,height:r.height};};
    const background=rect(puzzle),pieceBox=rect(pieceContainer),thumb=rect(handle);
    rail??=handle.closest('[class*="handleBar"]')||handle.parentElement;
    const railBox=rect(rail);
    if(!wrapper.contains(rail)||background.width<80||background.height<50||thumb.width<8||railBox.width<=thumb.width+10)continue;
    const inline=[pieceContainer,piece].map(e=>e?.style.transform||'').find(value=>/rotate(?:Z)?\(/i.test(value));
    const match=inline?.match(/rotate(?:Z)?\(\s*(-?[\d.]+)(deg|rad|turn)\s*\)/i);
    const rotation=match?Number(match[1])*(match[2]==='rad'?180/Math.PI:match[2]==='turn'?360:1):null;
    if(rotation===null&&layout!=='dynamic')continue;
    const angle=rotation??0,type=rotation===null?'puzzle':'temu-arced-slide';
    const center={proportionX:(pieceBox.x+pieceBox.width/2-background.x)/background.width,proportionY:(pieceBox.y+pieceBox.height/2-background.y)/background.height};
    const maxTravel=Math.floor(railBox.width-thumb.width);
    if(maxTravel<10||maxTravel>800||![angle,center.proportionX,center.proportionY].every(Number.isFinite))continue;
    const x=thumb.x+thumb.width/2,y=thumb.y+thumb.height/2;
    if(x<0||y<0||railBox.x+railBox.width>innerWidth||y>innerHeight)continue;
    const localX=x-context.offsetX,localY=y-context.offsetY;
    const hit=context.root.elementFromPoint?.(localX,localY)||handle.ownerDocument.elementFromPoint(localX,localY);
    const usable=handle===hit||handle.contains(hit);
    candidates.push({type,puzzle:{src:puzzle.currentSrc||puzzle.src,rect:background},piece:{src:piece.currentSrc||piece.src,rect:pieceBox},handle:{x,y},maxTravel,rotation:angle,center,usable,atOrigin:Math.abs(thumb.x-railBox.x)<5&&(type!=='puzzle'||Math.abs(pieceBox.x-background.x)<1.5)});
  }
  return candidates.length===1?candidates[0]:null;
}

export function readTemuPoint(){
  const visible=e=>e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  const roots=[...document.querySelectorAll('#Picture')].filter(visible),found=[];
  const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
  for(const root of roots){
    const imgs=[...root.querySelectorAll('#captchaImg')].filter(e=>visible(e)&&e.complete&&e.naturalWidth>0);
    const labels=[...root.querySelectorAll('div,p,span')].filter(e=>visible(e)&&/^(请点击|please click|click (?:on )?the)/i.test(e.innerText?.trim()||'')&&e.innerText.trim().length<160&&![...e.children].some(c=>c.innerText?.trim()===e.innerText.trim()));
    const buttons=[...root.querySelectorAll('button,div,span,[role="button"]')].filter(e=>visible(e)&&/^(提交|submit)$/i.test(e.innerText?.trim()||'')&&![...e.children].some(c=>c.innerText?.trim()===e.innerText.trim()));
    if(imgs.length!==1||labels.length!==1||buttons.length!==1)continue;
    const image=imgs[0],box=rect(image),button=buttons[0],buttonBox=rect(button),x=buttonBox.x+buttonBox.width/2,y=buttonBox.y+buttonBox.height/2;
    if(box.width<50||box.height<50||box.x<0||box.y<0||box.x+box.width>innerWidth||box.y+box.height>innerHeight)continue;
    const control=button.closest('button,[role="button"]')||button;
    const usable=!control.disabled&&control.getAttribute('aria-disabled')!=='true'&&button.contains(document.elementFromPoint(x,y));
    found.push({type:'semantic-items',challenge:labels[0].innerText.trim(),image:{src:image.currentSrc||image.src,rect:box},submit:usable?{x,y}:null});
  }
  return found.length===1?found[0]:null;
}

export function translatePointChallenge(value){
  const challenge=String(value||'').trim();
  if(/^(?:please )?click (?:on )?the [a-z -]+ (?:closest to|farthest from) the [a-z -]+[.!]?$/i.test(challenge))return challenge;
  const match=/^请点击距离(火车|汽车|飞机|自行车|船)(最近|最远)的(球|苹果|香蕉|杯子)[。！!]?$/u.exec(challenge);
  if(!match)return null;
  const objects={火车:'train',汽车:'car',飞机:'airplane',自行车:'bicycle',船:'boat',球:'ball',苹果:'apple',香蕉:'banana',杯子:'cup'};
  return `Please click the ${objects[match[3]]} ${match[2]==='最近'?'closest to':'farthest from'} the ${objects[match[1]]}.`;
}

async function imageBytes(source,fetchImpl){
  let buffer;
  if(/^data:image\/(?:png|jpeg|webp);base64,/i.test(source)){
    const data=source.slice(source.indexOf(',')+1);
    if(data.length>6000000||!/^[a-z\d+/=\r\n]+$/i.test(data))throw new Error('验证码图片数据格式无效，未调用识别。');
    buffer=Buffer.from(data,'base64');
  }else{
    const url=new URL(source);
    if(url.protocol!=='https:'||url.username||url.password||url.port||!['temu.com','kwcdn.com'].some(host=>url.hostname===host||url.hostname.endsWith('.'+host)))throw new Error('验证码图片地址不属于已支持的 Temu 图片域名，未调用识别。');
    let response;
    try{response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(10000)});}catch{throw new Error('读取验证码图片失败，未调用识别。');}
    if(!response.ok||!response.headers.get('content-type')?.startsWith('image/'))throw new Error('验证码图片尚未就绪，未调用识别。');
    const reader=response.body.getReader(),chunks=[];let bytes=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>4500000)throw new Error('验证码图片过大，未调用识别。');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
    buffer=Buffer.concat(chunks);
  }
  let metadata;try{metadata=await sharp(buffer,{limitInputPixels:16000000}).metadata();}catch{throw new Error('验证码图片无法解码，未调用识别。');}
  if(!metadata.width||!metadata.height||metadata.width>4000||metadata.height>4000)throw new Error('验证码图片尺寸不受支持，未调用识别。');
  return buffer;
}

const waiting=message=>({status:'waiting-verification',message});
const sameImages=(a,b)=>a&&b&&a.puzzle.src===b.puzzle.src&&a.piece.src===b.piece.src;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function createTemuCaptchaSolver({configuration={},client=createSadCaptchaClient(configuration),fetchImpl=globalThis.fetch,pause=delay}={}){
  async function solvePoint({page,args,readPage},initial){
    const challenge=translatePointChallenge(initial.challenge);
    if(!challenge)return waiting('当前点选题的文字要求尚未适配，未调用 SadCaptcha；原页面已保留。');
    let attemptId,answered=false;
    const same=value=>value&&value.challenge===initial.challenge&&value.image.src===initial.image.src;
    const click=async point=>{
      let releasePoint=point;
      try{
        await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...point});
        if(args.isStopped?.()){releasePoint={x:0,y:0};await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,...releasePoint});}
      }finally{await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...releasePoint});}
    };
    const cancelled=()=>{if(attemptId)args.afterCaptcha(attemptId,{status:'cancelled',message:'任务已暂停，未继续提交点选验证。'});return waiting('任务已暂停，未继续提交点选验证。');};
    try{
      const bytes=await imageBytes(initial.image.src,fetchImpl);
      if(!same(await page.evaluate(readTemuPoint)))return waiting('点选题图片或文字已变化，未请求识别。');
      if(args.isStopped?.())return cancelled();
      const fingerprint=createHash('sha256').update('semantic-items').update(challenge).update(bytes).digest('hex');
      attemptId=args.beforeCaptcha({type:'semantic-items',fingerprint});
      const result=await client.solve('semantic-items',{challenge,image_b64:bytes.toString('base64')});answered=true;
      args.afterCaptcha(attemptId,{status:'answered',message:'SadCaptcha 已返回点选位置，正在核对原题。',durationMs:result.durationMs});
      const points=result.answer.proportionalPoints;
      if(!Array.isArray(points)||points.length!==1||![points[0].proportionX,points[0].proportionY].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1))throw new Error('本题要求单个目标，但识别结果不是一个有效位置，未点击图片。');
      if(args.isStopped?.())return cancelled();
      const current=await page.evaluate(readTemuPoint);
      if(!same(current))throw new Error('识别返回时点选题已变化，未使用过期答案。');
      if(args.isStopped?.())return cancelled();
      const box=current.image.rect;
      await click({x:box.x+box.width*points[0].proportionX,y:box.y+box.height*points[0].proportionY});
      if(args.isStopped?.())return cancelled();
      const selected=await page.evaluate(readTemuPoint);
      if(!same(selected)||!selected.submit)throw new Error('选择后题目或提交按钮已变化，未重复点击。');
      if(args.isStopped?.())return cancelled();
      await click(selected.submit);
      if(args.isStopped?.())return cancelled();
      const deadline=Date.now()+12000;
      while(Date.now()<deadline){
        await pause(400);
        const observed=await page.evaluate(readPage),next=await page.evaluate(readTemuPoint);
        if(['waiting-network','waiting-login','waiting-plugin'].includes(observed.status)){
          args.afterCaptcha(attemptId,{status:'not-passed',message:'提交后未回到可用的目标页面，未确认验证码通过。'});return observed;
        }
        if(isTemuVerificationReturn(observed,args)&&!next){args.afterCaptcha(attemptId,{status:'solved',message:'已回读 Temu 页面，点选验证码已通过。'});return {status:'solved'};}
        if(next&&!same(next))break;
      }
      args.afterCaptcha(attemptId,{status:'not-passed',message:'已提交点选答案，但 Temu 未确认通过；未自动重试。'});
      return waiting('SadCaptcha 已返回点选答案，但 Temu 未确认验证通过。原页面已保留。');
    }catch(error){
      if(attemptId)args.afterCaptcha(attemptId,{status:error.isUnknown?'unknown':answered?'not-passed':'failed',message:error.message,code:error.code});
      return waiting(error.message||'点选验证未完成，原页面已保留。');
    }
  }
  return {
    async solve({page,args,readPage}){
      const gate=args.captchaPreflight?.()||{allowed:false,message:'当前任务未配置自动验证码。'};
      if(!gate.allowed)return waiting(gate.message);
      let attemptId,held=false,initial,answered=false,piecePerPointer=1,handlePerPointer=1;
      const send=(type,x,y)=>page.send('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,...(type==='mouseMoved'?{}:{clickCount:1})});
      const release=async()=>{
        if(!held)return;
        // Releasing the button must still be attempted if returning to the origin fails.
        try{await send('mouseMoved',initial.handle.x,initial.handle.y);}
        finally{try{await send('mouseReleased',initial.handle.x,initial.handle.y);}finally{held=false;}}
      };
      try{
        let diagnostic,probes=0;
        const loadingDeadline=Date.now()+10000;
        for(let attempt=0;attempt<40;attempt++){
          if(args.isStopped?.())return waiting('任务已暂停，未发起验证码请求。');
          probes=attempt+1;
          initial=await page.evaluate(readTemuSlider);
          if(initial?.usable&&initial.atOrigin)break;
          const point=await page.evaluate(readTemuPoint);
          if(point)return solvePoint({page,args,readPage},point);
          const grid=await page.evaluate(readTemuGrid);
          if(grid)return solveTemuGrid({page,args,readPage,initial:grid,client,loadImage:source=>imageBytes(source,fetchImpl),pause,returned:isTemuVerificationReturn});
          if(attempt>=11){
            diagnostic=null;
            try{diagnostic=sanitizeCaptchaDiagnostic(await page.evaluate(readTemuCaptchaDiagnostic,{probes,sliderBlocked:!!initial&&!initial.usable,sliderNotOrigin:!!initial&&!initial.atOrigin}));}catch{/* Preserve a fixed, safe diagnostic if the page cannot be inspected. */}
            diagnostic??=sanitizeCaptchaDiagnostic({code:'inspection-unavailable',type:'unknown',probes});
            if(!['loading-images','page-loading'].includes(diagnostic.code)||Date.now()>=loadingDeadline)break;
          }
          if(attempt<39)await pause(250);
        }
        if(!initial||!initial.usable||!initial.atOrigin){
          diagnostic??=sanitizeCaptchaDiagnostic({code:'inspection-unavailable',type:'unknown',probes});
          args.onCaptchaDiagnostic?.(diagnostic);
          return {...waiting(getCaptchaDiagnosticMessage(diagnostic)),code:diagnostic.code,diagnostic};
        }
        if(initial.type==='puzzle'){
          // This template may replace its piece on mousedown; capture the active images.
          held=true;await send('mousePressed',initial.handle.x,initial.handle.y);await pause(80);
          let pressed;
          for(let attempt=0;attempt<12;attempt++){
            if(args.isStopped?.())throw new Error('任务已暂停，未发起验证码请求。');
            pressed=await page.evaluate(readTemuSlider);
            if(pressed)break;
            if(attempt<11)await pause(250);
          }
          if(!pressed||pressed.type!=='puzzle'||!pressed.atOrigin||!pressed.usable)throw new Error('按下后滑块结构或位置变化，未请求识别。');
          initial=pressed;
        }
        const [puzzle,piece]=await Promise.all([imageBytes(initial.puzzle.src,fetchImpl),imageBytes(initial.piece.src,fetchImpl)]);
        const fingerprint=createHash('sha256').update(initial.type).update(puzzle).update(piece).digest('hex');
        const current=await page.evaluate(readTemuSlider);
        if(!sameImages(initial,current)||!current.usable||!current.atOrigin)return waiting('验证码图片或滑块位置已经变化，未请求识别。');
        initial=current;
        let payload;
        if(initial.type==='temu-arced-slide'){
          const trajectory=[{pixels_from_slider_origin:0,piece_rotation_angle:initial.rotation,piece_center:initial.center}];
          held=true;await send('mousePressed',initial.handle.x,initial.handle.y);
          // The API requires a sample at each pixel while the mouse remains held.
          // The rail's right edge bounds travel in this verified DOM layout.
          for(let pixels=1;pixels<=initial.maxTravel;pixels++){
            if(args.isStopped?.())throw new Error('任务已暂停，未继续验证码请求。');
            await send('mouseMoved',initial.handle.x+pixels,initial.handle.y);
            let frame=await page.evaluate(readTemuSlider);
            if(!sameImages(initial,frame))throw new Error('拖动期间验证码已经变化，未继续识别。');
            if(Math.abs(frame.handle.x-initial.handle.x-pixels)>1.5){
              await pause(34);frame=await page.evaluate(readTemuSlider);
              if(!sameImages(initial,frame)||Math.abs(frame.handle.x-initial.handle.x-pixels)>1.5)throw new Error('页面滑块未跟随拖动，未调用 SadCaptcha；请检查页面状态。');
            }
            trajectory.push({pixels_from_slider_origin:pixels,piece_rotation_angle:frame.rotation,piece_center:frame.center});
          }
          payload={puzzle_image_b64:puzzle.toString('base64'),piece_image_b64:piece.toString('base64'),slide_piece_trajectory:trajectory};
        }else{
          // Measure the rendered displacement rather than assuming CSS scale is 1.
          const probe=Math.min(10,initial.maxTravel/2);
          await send('mouseMoved',initial.handle.x+probe,initial.handle.y);await pause(34);
          const moved=await page.evaluate(readTemuSlider);
          if(!sameImages(initial,moved)||moved.type!=='puzzle')throw new Error('试拖期间验证码变化，未请求识别。');
          piecePerPointer=(moved.piece.rect.x-initial.piece.rect.x)/probe;
          handlePerPointer=(moved.handle.x-initial.handle.x)/probe;
          if(![piecePerPointer,handlePerPointer].every(n=>Number.isFinite(n)&&n>=0.1&&n<=4))throw new Error('页面滑块未跟随拖动，未调用 SadCaptcha；请检查页面状态。');
          await send('mouseMoved',initial.handle.x,initial.handle.y);await pause(34);
          const returned=await page.evaluate(readTemuSlider);
          if(!sameImages(initial,returned)||!returned.atOrigin)throw new Error('滑块未返回可确认的起点，未请求识别。');
          payload={puzzleImageB64:puzzle.toString('base64'),pieceImageB64:piece.toString('base64')};
        }
        // Persist billing intent immediately before the sole outbound recognition call.
        if(args.isStopped?.())throw new Error('任务已暂停，未发起验证码请求。');
        attemptId=args.beforeCaptcha({type:initial.type,fingerprint});
        const result=await client.solve(initial.type,payload);answered=true;
        args.afterCaptcha(attemptId,{status:'answered',message:'SadCaptcha 已返回识别结果，正在核对页面。',durationMs:result.durationMs});
        const cancelled=async()=>{await release();args.afterCaptcha(attemptId,{status:'cancelled',message:'识别请求已完成；任务暂停后未提交验证码。'});return waiting('任务已暂停，识别请求已完成，未继续提交验证码。');};
        if(args.isStopped?.())return await cancelled();
        const frame=await page.evaluate(readTemuSlider);
        if(!sameImages(initial,frame))throw new Error('识别返回时验证码图片已变化，未使用过期答案。');
        const distance=initial.type==='puzzle'?result.answer.slideXProportion*initial.puzzle.rect.width:null;
        const pixels=initial.type==='temu-arced-slide'?result.answer.pixelsFromSliderOrigin:distance/piecePerPointer;
        if(!Number.isFinite(pixels)||pixels<0||pixels*handlePerPointer>initial.maxTravel+1||distance!==null&&distance>initial.puzzle.rect.width-initial.piece.rect.width+1)throw new Error('识别结果超出当前滑块可移动范围，未提交验证码。');
        if(args.isStopped?.())return await cancelled();
        if(!held){held=true;await send('mousePressed',initial.handle.x,initial.handle.y);}
        await send('mouseMoved',initial.handle.x+pixels,initial.handle.y);
        if(args.isStopped?.())return await cancelled();
        await send('mouseReleased',initial.handle.x+pixels,initial.handle.y);held=false;
        const deadline=Date.now()+12000;
        while(Date.now()<deadline){
          await pause(400);
          let observed;try{observed=await page.evaluate(readPage);}catch{continue;}
          const next=await page.evaluate(readTemuSlider);
          if(['waiting-network','waiting-login','waiting-plugin'].includes(observed.status)){
            args.afterCaptcha(attemptId,{status:'not-passed',message:'提交后未回到可用的目标页面，未确认验证码通过。'});
            return observed;
          }
          if(isTemuVerificationReturn(observed,args)&&!next){
            args.afterCaptcha(attemptId,{status:'solved',message:'已回读 Temu 页面，验证码已消失。'});
            return {status:'solved'};
          }
          if(next&&!sameImages(initial,next))break;
        }
        args.afterCaptcha(attemptId,{status:'not-passed',message:'已提交识别结果，但 Temu 未确认通过；未自动重试。'});
        return waiting('SadCaptcha 已返回答案，但 Temu 未确认验证通过。原页面已保留，可核对后继续。');
      }catch(error){
        await release().catch(()=>{});
        if(attemptId)args.afterCaptcha(attemptId,{status:error.isUnknown?'unknown':answered?'not-passed':'failed',message:error.message,code:error.code});
        return waiting(error.message||'自动验证未完成，原页面已保留。');
      }finally{await release().catch(()=>{});}
    }
  };
}
