import {merchantFixture} from './merchant-fixture.mjs';
import {buildPlan,splitPlan} from '../src/planner.mjs';
import {readCreativeCopy} from '../src/creative-direction.mjs';

export const repeatedHeadline='A Closer Look at the Canvas';
export async function copyReviewFixture(options={}){
  const originals=new Map();
  const f=await merchantFixture({planner:async payload=>{
    const plan=buildPlan(payload);
    const text=plan.sections.map(s=>s.title+'\n镜头、版式和商品事实保持不变。'+(s.outputConstraint?'':`\n画面主标题：${s.slot===1?repeatedHeadline:'Canvas appearance in '+payload.creative_direction.styleId}\n画面副文案：View the artwork.`)).join('\r\n\r\n');
    const result={...plan,text,copyHeadlines:readCreativeCopy(splitPlan(text).blocks,plan.sections)};
    originals.set(payload.set_id,structuredClone(result));return result;
  },...options});
  const imported=await f.api('/api/products/import-folder',{folder:f.input});
  const products=[{...imported.products[0],count:3}];
  const batch=await f.api('/api/products',{requestId:'copy-review-fixture',platform:'temu',storeKey:'merchant-ca',label:'文案检查',products,imageCount:3,ratio:'1:1',mode:'master'});
  return {...f,batch,originals,route:'/api/products/'+batch.id};
}
