import {randomUUID} from 'node:crypto';
import {connection,connect,pageById} from './bit-cdp.mjs';

// One batch owns at most an editor and a background inspector. Never adopt user tabs.
export async function createDraftSession(browserConfig,transport={connection,connect,pageById}) {
  const info=await transport.connection(browserConfig),browser=await transport.connect(info.ws);
  const owned=new Map();let preserveEditor=false;
  return {
    async page(role){
      if(owned.has(role))return owned.get(role);
      const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',background:role==='inspector'});
      const entry={targetId,page:null};owned.set(role,entry);
      entry.page=await transport.pageById(info,targetId);
      // Chrome throttles occluded/background tabs and can leave ERP modal
      // animations pending. Keep only this session's owned page active.
      await entry.page.send('Emulation.setFocusEmulationEnabled',{enabled:true});
      return entry;
    },
    begin(){preserveEditor=false;},
    async claim(page,store,row){
      const token=randomUUID();
      await page.evaluate(({token,motherId,sku})=>{
        if(!['www.dianxiaomi.com','dianxiaomi.com'].includes(location.hostname)||location.pathname!=='/web/popTemu/quoteEdit'
          ||new URL(location.href).searchParams.get('id')!==motherId||document.documentElement.dataset.workbenchMotherId!==motherId)throw new Error('编辑页身份已变化，停止填写');
        document.documentElement.dataset.workbenchAttempt=token;
        document.documentElement.dataset.workbenchAttemptSku=sku;
      },{token,motherId:store.draftId,sku:row.sku});
      return token;
    },
    keepEditor(){preserveEditor=true;},
    async retireFailure(row,store){
      if(!row.targetId||!row.attemptToken)return;
      if(!(await info.targets()).some(t=>t.id===row.targetId))return;
      const previous=await transport.pageById(info,row.targetId);
      try {
        await previous.send('Emulation.setFocusEmulationEnabled',{enabled:true});
        const safe=await previous.evaluate(({token,motherId,sku})=>
          ['www.dianxiaomi.com','dianxiaomi.com'].includes(location.hostname)&&location.pathname==='/web/popTemu/quoteEdit'
          &&new URL(location.href).searchParams.get('id')===motherId
          &&document.documentElement.dataset.workbenchAttempt===token
          &&document.documentElement.dataset.workbenchAttemptSku===sku,
        {token:row.attemptToken,motherId:store.draftId,sku:row.sku});
        if(!safe)throw new Error('上次失败页已跳转或身份已变化，已保留现场；请先核对是否已保存，不会另建副本。');
        const result=await browser.send('Target.closeTarget',{targetId:row.targetId});
        if(result.success===false)throw new Error('上次未保存的失败页无法回收，请检查浏览器后重试');
      } finally {await previous.send('Emulation.setFocusEmulationEnabled',{enabled:false}).catch(()=>{});previous.close();}
    },
    async close(){
      for(const [role,{targetId,page}] of owned){
        if(page)await page.send('Emulation.setFocusEmulationEnabled',{enabled:false}).catch(()=>{});
        page?.close();
        if(role!=='editor'||!preserveEditor)await browser.send('Target.closeTarget',{targetId}).catch(()=>{});
      }
      owned.clear();browser.close();
    }
  };
}
