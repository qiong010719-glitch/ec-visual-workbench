import {createHash} from 'node:crypto';

export function readTemuGrid(){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  const grids=[...document.querySelectorAll('#imageSemantics')].filter(visible);
  if(grids.length!==1)return null;
  const grid=grids[0],dialog=grid.closest('[role="dialog"]');
  if(!dialog)return null;
  const labels=[...dialog.querySelectorAll('div,p,span')].filter(e=>visible(e)&&/^(请按以下顺序点击相应的图片|Click on the corresponding images in the following order)/i.test(e.innerText.trim())&&e.innerText.length<300&&![...e.children].some(c=>c.innerText?.trim()===e.innerText.trim()));
  // Temu adds a second image as the numbered selection overlay inside each tile.
  const images=[...grid.querySelectorAll('[role="none"] > img')].filter(visible);
  const submits=[...dialog.querySelectorAll('button,[role="button"]')].filter(e=>visible(e)&&/^(提交|submit)$/i.test(e.innerText.trim())&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');
  if(labels.length!==1||images.length!==9||submits.length!==1||images.some(e=>!e.complete||!e.naturalWidth))return null;
  const tiles=images.map(e=>{const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {src:e.currentSrc||e.src,x,y,width:r.width,height:r.height,usable:r.width>20&&r.height>20&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&e.parentElement.contains(document.elementFromPoint(x,y))};});
  if(tiles.some(t=>!t.usable))return null;
  for(let i=0;i<9;i++)if(i%3&&tiles[i].x<=tiles[i-1].x||i%3&&Math.abs(tiles[i].y-tiles[i-1].y)>3||i>=3&&tiles[i].y<=tiles[i-3].y)return null;
  const rect=submits[0].getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
  if(!submits[0].contains(document.elementFromPoint(x,y)))return null;
  return {challenge:labels[0].innerText.trim(),tiles,submit:{x,y},selectedCount:images.filter(e=>e.parentElement.querySelectorAll('img').length>1||/^\d+$/.test(e.parentElement.innerText.trim())).length};
}

const nouns={鲸鱼:'whale',海豚:'dolphin',鲨鱼:'shark',蝴蝶:'butterfly',蜜蜂:'bee',熊猫:'panda',企鹅:'penguin',骆驼:'camel',猴子:'monkey',袋鼠:'kangaroo',乌龟:'turtle',鳄鱼:'crocodile',鸭子:'duck',鹅:'goose',鸡:'chicken',机器人:'robot',房子:'house',公共汽车:'bus',公交车:'bus',卡车:'truck',摩托车:'motorcycle',热气球:'hot air balloon',火箭:'rocket',滑板:'skateboard',帆船:'sailboat',箱子:'box',冰箱:'refrigerator',洗衣机:'washing machine',相机:'camera',台灯:'lamp',电风扇:'fan',眼镜:'glasses',钥匙:'key',剪刀:'scissors',锤子:'hammer',勺子:'spoon',叉子:'fork',刀:'knife',盘子:'plate',碗:'bowl',茶壶:'teapot',书:'book',书本:'book',背包:'backpack',闹钟:'alarm clock',花:'flower',树:'tree',蘑菇:'mushroom',柠檬:'lemon',樱桃:'cherry',南瓜:'pumpkin',西红柿:'tomato',胡萝卜:'carrot',茄子:'eggplant',冰淇淋:'ice cream',蛋糕:'cake',汉堡:'hamburger',披萨:'pizza',甜甜圈:'donut',面包:'bread',桌子:'table',桌:'table',床:'bed',棒球:'baseball',鹿:'deer',小提琴:'violin',电视:'television',电视机:'television',草莓:'strawberry',桃:'peach',桃子:'peach',苹果:'apple',香蕉:'banana',橘子:'orange',橙子:'orange',梨:'pear',梨子:'pear',西瓜:'watermelon',菠萝:'pineapple',葡萄:'grape',汽车:'car',火车:'train',飞机:'airplane',自行车:'bicycle',船:'boat',猫:'cat',狗:'dog',马:'horse',牛:'cow',兔子:'rabbit',鸟:'bird',鱼:'fish',熊:'bear',狮子:'lion',老虎:'tiger',大象:'elephant',斑马:'zebra',长颈鹿:'giraffe',椅子:'chair',沙发:'sofa',吉他:'guitar',钢琴:'piano',鼓:'drum',足球:'soccer ball',篮球:'basketball',网球:'tennis ball',杯子:'cup',时钟:'clock',钟:'clock',手机:'phone',电脑:'computer',雨伞:'umbrella',鞋子:'shoe',帽子:'hat'};
export function gridObjects(challenge){
  const prefix=/^(?:请按以下顺序点击相应的图片|Click on the corresponding images in the following order)\s*[:：]\s*/i;
  if(!prefix.test(challenge))return null;
  const tail=challenge.replace(prefix,''),matches=[...tail.matchAll(/['"‘“]([^'"’”]+)['"’”]/g)];
  if(!matches.length||matches.length>9||tail.replace(/['"‘“][^'"’”]+['"’”]/g,'').replace(/[\s,，、。.!！]/g,''))return null;
  const values=matches.map(m=>nouns[m[1].trim()]||(/^[a-z][a-z -]{0,40}$/i.test(m[1].trim())?m[1].trim().toLowerCase():null));
  return values.every(Boolean)?values:null;
}

export async function solveTemuGrid({page,args,readPage,initial,client,loadImage,pause,returned}){
  const waiting=message=>({status:'waiting-verification',message});
  const objects=gridObjects(initial.challenge);
  if(!objects||initial.selectedCount)return waiting('九宫格题目未适配或已存在选择，未请求识别，原页面已保留。');
  const same=value=>value&&value.challenge===initial.challenge&&value.tiles.every((t,i)=>t.src===initial.tiles[i].src);
  let attemptId,answered=false;
  const update=(status,message,extra={})=>args.afterCaptcha(attemptId,{status,message,...extra});
  const click=async point=>{
    let release=point;
    try{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...point});if(args.isStopped?.()){release={x:0,y:0};await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,...release});}}
    finally{await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...release});}
  };
  try{
    const images=await Promise.all(initial.tiles.map(t=>loadImage(t.src)));
    if(!same(await page.evaluate(readTemuGrid)))return waiting('九宫格题目已变化，未请求识别。');
    if(args.isStopped?.())return waiting('任务已暂停，未请求识别。');
    const hash=createHash('sha256').update('temu-three-by-three').update(JSON.stringify(objects));
    for(const bytes of images)hash.update(String(bytes.length)+':').update(bytes);
    attemptId=args.beforeCaptcha({type:'temu-three-by-three',fingerprint:hash.digest('hex')});
    const result=await client.solve('temu-three-by-three',{objectsOfInterest:objects,images:images.map(b=>b.toString('base64'))});answered=true;
    update('answered','SadCaptcha 已返回九宫格顺序，正在核对原题。',{durationMs:result.durationMs});
    const indices=result.answer.solutionIndices;
    if(!Array.isArray(indices)||indices.length!==objects.length||new Set(indices).size!==indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>8))throw new Error('九宫格答案数量或索引无效，未点击图片。');
    for(const index of indices){
      if(args.isStopped?.()){update('cancelled','任务已暂停，未继续九宫格操作。');return waiting('任务已暂停，未继续九宫格操作。');}
      const current=await page.evaluate(readTemuGrid);if(!same(current))throw new Error('九宫格图片或题目已变化，未继续点击。');
      await click({x:current.tiles[index].x,y:current.tiles[index].y});await pause(80);
    }
    if(args.isStopped?.()){update('cancelled','任务已暂停，未提交九宫格。');return waiting('任务已暂停，未提交九宫格。');}
    const current=await page.evaluate(readTemuGrid);if(!same(current))throw new Error('九宫格提交前题目已变化，未继续。');
    await click(current.submit);
    if(args.isStopped?.()){update('cancelled','任务已暂停，九宫格结果待核对。');return waiting('任务已暂停，九宫格结果待核对。');}
    const deadline=Date.now()+12000;
    while(Date.now()<deadline){
      await pause(400);
      const observed=await page.evaluate(readPage),next=await page.evaluate(readTemuGrid);
      if(['waiting-network','waiting-login','waiting-plugin'].includes(observed.status)){update('not-passed','提交后尚未回到可用的目标页面，未确认通过。');return observed;}
      if(!next&&returned(observed,args)){update('solved','已回读原任务页面，九宫格验证已通过。');return {status:'solved'};}
      if(next&&!same(next))break;
    }
    update('not-passed','已提交九宫格答案，Temu 未确认通过，未自动重试。');return waiting('九宫格答案已提交，但 Temu 未确认通过，原页面已保留。');
  }catch(error){
    if(attemptId)update(error.isUnknown?'unknown':answered?'not-passed':'failed',error.message,{code:error.code});
    return waiting(error.message||'九宫格验证未完成，原页面已保留。');
  }
}
