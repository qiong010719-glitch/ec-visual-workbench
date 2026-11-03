import {performance} from 'node:perf_hooks';

export const CLICK_INTERVAL_MS=2500;
const pacers=new WeakMap();

// One queue per browser context keeps the same interval across draft tabs.
export function createClickPacer({intervalMs=CLICK_INTERVAL_MS,now=()=>performance.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  let lastCompleted=null,tail=Promise.resolve();
  const actions=[];
  return {
    perform(action,{kind='click',target=''}={}) {
      const pending=tail.then(async()=>{
        if(lastCompleted!==null) {
          let remaining=intervalMs-(now()-lastCompleted);
          while(remaining>0) {await sleep(remaining);remaining=intervalMs-(now()-lastCompleted);}
        }
        const started=now();
        const entry={kind,target,startedAt:new Date().toISOString(),gapSincePreviousCompletedMs:lastCompleted===null?null:Math.round(started-lastCompleted),status:'running'};
        actions.push(entry);
        try {const value=await action();entry.status='completed';return value;}
        catch(error) {entry.status='failed';throw error;}
        finally {lastCompleted=now();entry.completedAt=new Date().toISOString();entry.actionDurationMs=Math.round(lastCompleted-started);}
      });
      tail=pending.catch(()=>{});
      return pending;
    },
    metrics() {
      const gaps=actions.map(a=>a.gapSincePreviousCompletedMs).filter(n=>n!==null);
      return {intervalMs,totalActions:actions.length,minimumGapMs:gaps.length?Math.min(...gaps):null,actions:structuredClone(actions)};
    }
  };
}

function forContext(context) {
  if(!pacers.has(context))pacers.set(context,createClickPacer());
  return pacers.get(context);
}

export function clickRequired(locator,options) {
  return forContext(locator.page().context()).perform(()=>locator.click(options),{target:locator.toString()});
}

export async function checkRequired(locator,options) {
  if(await locator.isChecked())return;
  return forContext(locator.page().context()).perform(()=>locator.check(options),{kind:'check',target:locator.toString()});
}

export function getInteractionMetrics(context) {return forContext(context).metrics();}
