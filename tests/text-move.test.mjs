import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createWorkbench} from '../src/server.mjs';
import {encodeRgbaPng} from '../src/provider.mjs';
import {prepareTextMove,finishTextMove,textMoveGuide} from '../src/text-move.mjs';

const regions=[{role:'erase',x:10,y:10,w:30,h:20},{role:'paint',x:50,y:60,w:40,h:30}];
const source=()=>encodeRgbaPng(100,100,Buffer.alloc(40000,220));
const decode=bytes=>sharp(bytes).toColourspace('srgb').ensureAlpha().raw().toBuffer();
const draw=(rgba,left,top,w,h,value)=>{for(let y=top;y<top+h;y++)for(let x=left;x<left+w;x++){const i=(y*100+x)*4;rgba.fill(value,i,i+3);rgba[i+3]=255;}};

test('the separate guide marks old and new areas without mutating the source, mask or final output',async()=>{
  const original=source(),edit=await prepareTextMove(original,regions);
  const originalPixels=Buffer.from(edit.data),originalMask=Buffer.from(edit.mask);
  const guide=await decode(textMoveGuide(edit));
  const pixel=(x,y)=>Array.from(guide.subarray((y*100+x)*4,(y*100+x)*4+3));
  assert.deepEqual(pixel(10,10),[235,40,65]);
  assert.deepEqual(pixel(54,64),[0,105,255]);
  assert.deepEqual(pixel(70,75),[0,105,255]);
  assert.deepEqual(pixel(0,0),Array.from(originalPixels.subarray(0,3)));
  assert.deepEqual(edit.source,original);assert.deepEqual(edit.data,originalPixels);assert.deepEqual(edit.mask,originalMask);
  assert.deepEqual(await decode(await finishTextMove(edit,original)),originalPixels,'guide marks must never reach the merged output');
  await assert.rejects(finishTextMove(edit,textMoveGuide(edit)),/残留了位置参考标记/);
});

test('small shifts of an existing boundary detail do not look like new clipped text',async()=>{
  const input=Buffer.alloc(40000,220);draw(input,88,70,3,12,20);
  const edit=await prepareTextMove(encodeRgbaPng(100,100,input),regions);
  const shifted=Buffer.alloc(40000,220);draw(shifted,89,70,3,12,20);
  const result=await decode(await finishTextMove(edit,encodeRgbaPng(100,100,shifted)));
  for(let y=0;y<100;y++)for(let x=90;x<100;x++) {
    const i=(y*100+x)*4;assert.deepEqual(result.subarray(i,i+4),edit.data.subarray(i,i+4));
  }
});

test('masked output preserves every outside RGBA pixel while accepting only inside edits, including alpha',async()=>{
  const edit=await prepareTextMove(source(),regions);
  const raw=Buffer.from(edit.data);
  for(let i=0;i<raw.length;i+=4){raw[i]+=7;raw[i+1]-=4;raw[i+3]+=5;}
  draw(raw,15,15,15,6,245);draw(raw,60,70,20,8,20);
  const result=await decode(await finishTextMove(edit,encodeRgbaPng(100,100,raw)));
  for(let y=0;y<100;y++)for(let x=0;x<100;x++) {
    const editable=(x>=10&&x<40&&y>=10&&y<30)||(x>=50&&x<90&&y>=60&&y<90);
    const i=(y*100+x)*4;
    assert.deepEqual(result.subarray(i,i+4),(editable?raw:edit.data).subarray(i,i+4),`pixel ${x},${y}`);
  }
});

test('a new dark or light stroke across any target boundary is rejected before it can be clipped',async()=>{
  for(const value of [0,255])for(const [x,y,w,h] of [[48,70,6,8],[88,70,6,8],[65,58,8,6],[65,88,8,6]]) {
    const edit=await prepareTextMove(encodeRgbaPng(100,100,Buffer.alloc(40000,128)),regions);
    const raw=Buffer.from(edit.data);draw(raw,x,y,w,h,value);
    await assert.rejects(finishTextMove(edit,encodeRgbaPng(100,100,raw)),{code:'TEXT_MOVE_REJECTED'});
  }
});

test('wrong dimensions and undecodable responses never replace the original',async()=>{
  const edit=await prepareTextMove(source(),regions);
  for(const result of [encodeRgbaPng(80,100,Buffer.alloc(32000,255)),Buffer.from('not an image')]) {
    await assert.rejects(finishTextMove(edit,result),{code:'TEXT_MOVE_REJECTED'});
  }
});

test('JPEG and WebP inputs preserve decoded outside pixels; EXIF rotation matches displayed coordinates',async()=>{
  for(const format of ['jpeg','webp']) {
    const input=await sharp(source())[format]().toBuffer();
    const edit=await prepareTextMove(input,regions);
    const raw=Buffer.from(edit.data);draw(raw,60,70,10,8,0);
    const output=await decode(await finishTextMove(edit,encodeRgbaPng(100,100,raw)));
    assert.deepEqual(output.subarray(0,400),edit.data.subarray(0,400));
  }
  const rotated=await sharp({create:{width:80,height:100,channels:3,background:'#abcdef'}}).withMetadata({orientation:6}).jpeg().toBuffer();
  const edit=await prepareTextMove(rotated,regions);
  assert.deepEqual([edit.width,edit.height],[100,80]);
  assert.equal((await sharp(edit.source).metadata()).orientation,undefined);
});

async function fixture(t,options={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'text-move-'));
  const app=createWorkbench({dataDirectory:directory,configuration:{},researchOptions:{client:{configured:false}},...options});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  const {token}=await(await fetch(base+'/api/session')).json();
  t.after(async()=>{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));app.research.close();fs.rmSync(directory,{recursive:true,force:true});});
  const call=async(url,data)=>{const response=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(data)});return {status:response.status,body:await response.json()};};
  const wait=async id=>{for(let i=0;i<100;i++){const task=await(await fetch(base+'/api/tasks/hyrule_tasks/'+id)).json();if(['completed','failed'].includes(task.status))return task;await new Promise(r=>setTimeout(r,10));}throw new Error('task did not settle');};
  return {...app,base,call,wait};
}

test('uncertain local recognition stops before the provider and returns the simulated charge',async t=>{
  let generated=0;
  const app=await fixture(t,{textRecognizer:async()=>[],provider:async()=>{generated++;return source();}});
  const before=app.store.state.balance;
  const sent=await app.call('/api/inpaint',{text_move:true,text_sentence:'测试',text_target:{x:70,y:75},task_id:'unrecognized',slot_idx:0,prompt:'原文：测试',base_image_b64:'data:image/png;base64,'+source().toString('base64'),mask_regions:regions});
  assert.equal(sent.status,202);
  const task=await app.wait('unrecognized');
  assert.equal(task.phase,'edit_rejected');assert.match(task.error,/本次未提交出图/);
  assert.equal(task.imageUrl,undefined);assert.equal(task.canRetryDownload,false);
  assert.equal(generated,0);assert.equal(app.store.state.balance,before);
});

test('download recovery retains mask enforcement after a restart and never resubmits generation',async t=>{
  let generated=0,downloads=0;
  const textRecognizer=async(_bytes,box)=>box.w===30&&box.h===20?[{text:'测试',confidence:95,box:{x:15,y:15,w:12,h:6}}]:box.w>40?[{text:'测试',confidence:95,box:{x:64,y:72,w:12,h:6}}]:[];
  const app=await fixture(t,{textRecognizer,provider:async({onProgress})=>{generated++;await onProgress({resultUrl:'https://example.com/edited.png'});throw new Error('download timeout');}});
  const inline='data:image/png;base64,'+source().toString('base64');
  assert.equal((await app.call('/api/inpaint',{text_move:true,text_sentence:'测试',text_target:{x:70,y:75},task_id:'recover_masked',slot_idx:0,prompt:'原文：测试',base_image_b64:inline,mask_regions:regions})).status,202);
  const initial=await app.wait('recover_masked');assert.equal(initial.canRetryDownload,true);
  const recovery=await fixture(t,{dataDirectory:app.store.directory,textRecognizer,download:async()=>{downloads++;const raw=await decode(source());draw(raw,76,71,6,6,0);return encodeRgbaPng(100,100,raw);}});
  assert.deepEqual(recovery.store.state.tasks['hyrule_tasks/recover_masked'].textMove.precision.boxes,[{x:13,y:13,w:16,h:10},{x:62,y:70,w:16,h:10}]);
  const chargeCount=recovery.store.state.charges.length;
  assert.equal((await recovery.call('/api/downloads/retry',{taskId:'recover_masked'})).status,202);
  const rejected=await recovery.wait('recover_masked');
  assert.equal(rejected.phase,'edit_rejected');assert.equal(rejected.canRetryDownload,false);assert.equal(rejected.imageUrl,undefined);
  assert.equal((await recovery.call('/api/downloads/retry',{taskId:'recover_masked'})).status,409);
  assert.equal(downloads,1);assert.equal(generated,1);assert.equal(recovery.store.state.charges.length,chargeCount);
});
