import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {encodeRgbaPng,pngAlpha} from '../src/provider.mjs';
import {prepareTextMove,finishTextMove} from '../src/text-move.mjs';
import {locateTextMove,installPrecision,checkTextMove} from '../src/text-move-precision.mjs';
import {sameText} from '../src/text-recognition.mjs';

const source=()=>encodeRgbaPng(200,200,Buffer.alloc(200*200*4,220));
const regions=[{role:'erase',x:0,y:70,w:56,h:18},{role:'paint',x:0,y:10,w:56,h:18}];
const sentence='杯碟，不随附。',target={x:28,y:25};
const original={x:10,y:145,w:80,h:20};
const recognized=()=>[{text:sentence,confidence:94,box:original}];
async function fixture(){const edit=await prepareTextMove(source(),regions);return locateTextMove(edit,{sentence,target},recognized);}

test('precise mask uses detected sentence and exact pin, independent of clamped UI boxes',async()=>{
  const edit=await fixture();
  assert.deepEqual(edit.precision.target,{x:16,y:40,w:80,h:20});
  assert.deepEqual(edit.boxes,[{x:7,y:142,w:86,h:26},{x:13,y:37,w:86,h:26}]);
  assert.equal(pngAlpha(edit.mask,50,25),255,'old broad paint rectangle is no longer editable');
  assert.equal(pngAlpha(edit.mask,50,50),0,'the actual pin, even outside broad reference box, determines the location');
  const restored=installPrecision(await prepareTextMove(source(),regions),JSON.parse(JSON.stringify(edit.precision)));
  assert.deepEqual(restored.mask,edit.mask);
});

test('uncertain, ambiguous, mismatched or out-of-bounds original text and edge targets fail closed',async()=>{
  for(const lines of [[],[{...recognized()[0],confidence:84}],recognized().concat(recognized()),[{...recognized()[0],text:'杯碟，随附。'}],[{...recognized()[0],box:{...original,x:190}}]]) {
    await assert.rejects(locateTextMove(await prepareTextMove(source(),regions),{sentence,target},async()=>lines),{code:'TEXT_MOVE_REJECTED'});
  }
  await assert.rejects(locateTextMove(await prepareTextMove(source(),regions),{sentence,target:{x:1,y:1}},recognized),/本次未提交出图/);
  await assert.rejects(locateTextMove(await prepareTextMove(source(),regions),{sentence,target},async()=>{throw Error('OCR unavailable');}),/本次未提交出图/);
  assert.equal(sameText('杯 碟 , 不 随 附 。',sentence),true);
  assert.equal(sameText('杯碟，不随附',sentence),false,'punctuation is not discarded');
});

test('wrong words, off-center result, oversize text and original-text remnants are rejected',async()=>{
  const edit=await fixture(),p=edit.precision;
  for(const line of [{text:'杯碟，随附。',confidence:96,box:p.target},{text:sentence,confidence:84,box:p.target},
    {text:sentence,confidence:95,box:{...p.target,x:p.target.x+5}},
    {text:sentence,confidence:95,box:{...p.target,x:5,w:102}}]) {
    await assert.rejects(checkTextMove(edit,source(),async()=>[line]),{code:'TEXT_MOVE_REJECTED'});
  }
  await assert.rejects(checkTextMove(edit,source(),async(_bytes,box)=>box.y>100?recognized():[{text:sentence,confidence:95,box:p.target}]),/文字残留/);
});

test('final PNG retains every pixel outside the two tight boxes, including pixels within old UI rectangles',async()=>{
  const edit=await fixture();
  const rgba=Buffer.from(edit.data);
  for(let i=0;i<rgba.length;i+=4)rgba[i]+=7;
  const recognize=async(_bytes,box)=>box.y>100?[]:[{text:sentence,confidence:95,box:edit.precision.target}];
  const output=await sharp(await finishTextMove(edit,encodeRgbaPng(200,200,rgba),recognize)).ensureAlpha().raw().toBuffer();
  for(let y=0;y<200;y++)for(let x=0;x<200;x++){
    const editable=edit.boxes.some(b=>x>=b.x&&y>=b.y&&x<b.x+b.w&&y<b.y+b.h),i=(y*200+x)*4;
    assert.deepEqual(output.subarray(i,i+4),(editable?rgba:edit.data).subarray(i,i+4));
  }
});
