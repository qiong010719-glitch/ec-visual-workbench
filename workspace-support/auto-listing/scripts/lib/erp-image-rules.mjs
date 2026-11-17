export function mainImageLimits(text) {
  const minimum=String(text||'').match(/最少选用\s*(\d+)\s*张/);
  const maximum=String(text||'').match(/最多选用\s*(\d+)\s*张/);
  return {minimum:minimum?Number(minimum[1]):null,maximum:maximum?Number(maximum[1]):null};
}

export function validateMainImageCount(count,text) {
  const limits=mainImageLimits(text);
  if(limits.minimum!==null&&count<limits.minimum)throw new Error(`店小秘当前类目至少需要 ${limits.minimum} 张主图，当前只有 ${count} 张；请补齐图片后重新导入。尚未点击保存。`);
  if(limits.maximum!==null&&count>limits.maximum)throw new Error(`店小秘当前类目最多允许 ${limits.maximum} 张主图，当前有 ${count} 张。尚未点击保存。`);
  return limits;
}

// Scope this policy to the category verified in real ERP rejection receipts.
// Other categories (especially apparel) must not inherit its square-image rule.
// Reference: https://help.dianxiaomi.com/article/2257 (checked 2026-11-11).
export function motherSkuPreviewPolicy(mother) {
  const categories=mother.items.find(item=>item.label==='产品分类')?.selections||[];
  return categories.includes('海报和印刷品')?{category:'海报和印刷品',minimum:800,maximumBytes:2*1024*1024}:null;
}

// Serialized into the ERP page. Read the original bytes, not a CSS thumbnail or
// a Content-Length estimate. Never send account credentials to image hosts.
export async function readSkuPreviewImage({url,maximumBytes,timeoutMs=10000}) {
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||parsed.port||parsed.username||parsed.password||!['wxalbum-10001658-file.dianxiaomi.com','img.kwcdn.com'].includes(parsed.hostname))throw new Error('母稿 SKU 预览图地址不受支持，请在店小秘重新上传图片并保存母稿');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url,{credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});
    if(!response.ok||!response.body)throw new Error('无法读取图片');
    const reader=response.body.getReader(),chunks=[];let bytes=0;
    try{
      for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maximumBytes){await reader.cancel();return {bytes,tooLarge:true};}chunks.push(value);}
    }finally{reader.releaseLock();}
    const blob=new Blob(chunks),head=new Uint8Array(await blob.slice(0,8).arrayBuffer());
    const format=head[0]===255&&head[1]===216?'jpeg':head.length===8&&[137,80,78,71,13,10,26,10].every((v,i)=>head[i]===v)?'png':null;
    if(!format)throw new Error('图片格式无效');
    const image=await createImageBitmap(blob);
    try{return {width:image.width,height:image.height,bytes,format};}finally{image.close();}
  }catch{
    throw new Error('无法核验母稿 SKU 预览图原文件，可能是链接失效、图片损坏或网络异常；请在店小秘检查图片并保存后重新校验。尚未继续生成或上传。');
  }finally{clearTimeout(timer);}
}

export function validateMotherSkuPreview(image,policy) {
  const issues=[];
  if(image.tooLarge||image.bytes>policy.maximumBytes)issues.push('文件超过 2 MB');
  if(!image.tooLarge){
    if(!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<=0||image.height<=0)issues.push('未读取到真实像素尺寸');
    else if(image.width!==image.height||image.width<policy.minimum||image.height<policy.minimum)issues.push(`实际尺寸为 ${image.width}×${image.height}，需为 1:1 方图且宽高至少 ${policy.minimum} 像素`);
  }
  if(issues.length)throw new Error(`母稿 SKU 预览图不符合“${policy.category}”要求：${issues.join('；')}。请在店小秘母稿的“变种信息”中修正 SKU 预览图并保存，再返回重新校验；只更换主图或详情图不能解决。尚未继续生成或上传。`);
  return {...image,category:policy.category,checked:true};
}
