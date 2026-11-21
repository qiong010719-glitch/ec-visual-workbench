/* Optional per-slot benchmark intake. Own-product materials remain in their original library. */
(() => {
  const $=id=>document.getElementById(id),key='taobao-benchmark-v1';
  let state={jobId:null,analysisId:null,mapping:{},enabled:false,comparisons:{}},job=null,busy=false,timer,signature='';
  try{state={...state,...JSON.parse(localStorage.getItem(key)||'{}')};}catch{}
  const save=()=>localStorage.setItem(key,JSON.stringify(state));
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label={main:'主图',sku:'SKU',detail:'详情'};
  const spec=()=>window.__customLayout?.taobao;
  const slots=()=>spec()&&$('designScope')?.value==='custom'?TaobaoLayout.activeSlots(spec()):[];
  const selected=()=>slots().flatMap(s=>{const m=state.mapping[s.slot];return m?.zone===s.zone&&m.assetId?[{...s,assetId:m.assetId}]:[];});
  const asset=id=>job?.assets.find(a=>a.id===id&&a.status==='downloaded');
  const message=text=>{if($('tbBenchmarkMessage'))$('tbBenchmarkMessage').textContent=text;};
  async function api(url,body){
    const response=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error||'读取失败'),{status:response.status});return result;
  }
  function render(){
    if(!$('tbBenchmarkAssets'))return;
    $('tbBenchmarkEnabled').checked=state.enabled;
    $('tbBenchmarkEnabled').disabled=busy||!selected().length||selected().some(s=>!asset(s.assetId)?.layout);
    $('tbBenchmarkFetch').disabled=busy;$('tbBenchmarkAnalyze').disabled=busy||!selected().length;
    $('tbBenchmarkClear').disabled=busy;
    $('tbBenchmarkResume').hidden=!(job?.status==='failed'&&job.acquisition?.runId);$('tbBenchmarkResume').disabled=busy;
    $('tbBenchmarkTitle').textContent=job?`${job.title||(job.status==='failed'?'读取未完成':'正在读取')} · ${job.assets.filter(a=>a.status==='downloaded').length}张已保存${job.cachedFrom?'（复用已抓取资料）':''}`:'';
    const runLink=$('tbBenchmarkRun'),runId=job?.acquisition?.runId;
    runLink.hidden=!/^[a-zA-Z0-9_-]+$/.test(runId||'');
    if(!runLink.hidden)runLink.href='https://console.apify.com/actors/runs/'+encodeURIComponent(runId);
    const cost=job?.acquisition?.usageTotalUsd;
    $('tbBenchmarkCost').textContent=job?.cachedFrom?'本次复用已保存图片，没有新增抓取请求。':Number.isFinite(cost)?`Apify 已记录抓取费用：${cost.toFixed(4)} 美元（分析与生图另计）。`:'';
    $('tbBenchmarkWarnings').textContent=(job?.warnings||[]).join(' ');
    const downloaded=job?.assets.filter(a=>a.status==='downloaded')||[];
    $('tbBenchmarkAssets').innerHTML=downloaded.map(a=>`<a href="${escape(a.localUrl)}" target="_blank" rel="noopener"><img loading="lazy" src="${escape(a.localUrl)}" alt="${label[a.group]}参考${a.index}"><span>${label[a.group]} ${a.index}${a.layout?' · 已分析':''}</span></a>`).join('');
    $('tbBenchmarkBindings').innerHTML=downloaded.length?slots().map(s=>{
      const options=downloaded.filter(a=>a.group===s.zone),value=state.mapping[s.slot]?.zone===s.zone?state.mapping[s.slot].assetId:'';
      return `<label>${escape(TaobaoLayout.customerLabel(s.slot,spec()))}<select data-benchmark-slot="${s.slot}" ${busy?'disabled':''}><option value="">不用对标，沿用原构思</option>${options.map(a=>`<option value="${escape(a.id)}" ${a.id===value?'selected':''}>${label[a.group]}参考 ${a.index}${a.layout?'（已分析）':''}</option>`).join('')}</select></label>`;
    }).join(''):'';
    for(const select of $('tbBenchmarkBindings').querySelectorAll('select'))select.addEventListener('change',()=>{
      const s=slots().find(s=>s.slot===Number(select.dataset.benchmarkSlot));
      state.mapping[s.slot]={zone:s.zone,assetId:select.value};state.enabled=false;save();render();
      message('绑定已更改。点击“分析并用于构思”，随后重新一键构思；已有成图保留。');
    });
  }
  async function poll(){
    clearTimeout(timer);
    if(!state.jobId)return;
    const currentJobId=state.jobId;
    try{
      const latest=await api('/api/taobao/benchmarks/'+encodeURIComponent(currentJobId));
      if(state.jobId!==currentJobId)return;job=latest;
      busy=['pending','running'].includes(job.status);
      if(busy)message(`正在读取对标：已保存 ${job.assets.filter(a=>a.status==='downloaded').length} 张；没有启动分析或生图。`);
      else if(job.status==='failed')message(job.error);
      else if(state.analysisId){
        const run=await api('/api/taobao/benchmark-analyses/'+encodeURIComponent(state.analysisId));
        busy=['pending','running'].includes(run.status);
        if(busy)message(`正在分析版式 ${run.completed}/${run.assetIds.length}，没有启动生图。`);
        else if(run.status==='failed'){message(run.error+' 已完成的分析保留。');state.analysisId=null;save();}
        else{job=await api('/api/taobao/benchmarks/'+encodeURIComponent(state.jobId));state.enabled=true;state.analysisId=null;save();message('版式分析完成，已用于所选图片。现在可以“一键构思”，审看方案后再生成。');}
      }else message(state.enabled?'已恢复对标选择与版式分析，可继续查看方案；恢复草稿没有再次抓取、分析或生图。':'对标原图已取得。为需要参考的图片选择对应原图，再分析版式。未绑定的图片仍沿用本站构思。');
      render();if(busy)timer=setTimeout(poll,1500);
    }catch(error){if(state.jobId!==currentJobId)return;busy=false;message(error.message+' 可点“刷新状态”核对原任务，不会重新提交。');render();}
  }
  function comparisons(){
    if(typeof imageSlots==='undefined')return;
    imageSlots.forEach((data,index)=>{
      const slot=$('slot-'+index);if(!slot||!data)return;
      const current=data.history?data.history[data.currentIndex]:data.url,b=state.comparisons[current];
      slot.querySelector('.tb-benchmark-comparison')?.remove();if(!b)return;
      const block=document.createElement('div');block.className='tb-benchmark-comparison';
      block.innerHTML=`<a target="_blank" rel="noopener" href="${escape(b.localUrl)}"><img src="${escape(b.localUrl)}" alt="本张版式参考"></a><span>本张版式参考<br>${escape(b.assetId)}<br>商品以本品图为准</span>`;slot.append(block);
    });
  }
  window.prepareTaobaoBenchmarkPayload=(payload)=>{
    if(!state.enabled||!slots().length)return payload;
    const chosen=selected();
    if(chosen.some(s=>!asset(s.assetId)?.layout))throw Error('对标图尚未读取或分析完成，请先完成分析，或关闭“使用本次对标”。');
    const bindings=new Map(chosen.map(s=>[s.slot,s.assetId]));
    return {...payload,slot_directives:(payload.slot_directives||[]).map(d=>bindings.has(Number(d.slot))?{...d,benchmark:{job_id:state.jobId,asset_id:bindings.get(Number(d.slot))}}:d)};
  };
  window.TaobaoBenchmarkState={
    capture(){if(busy)throw Error('请等待当前抓取或分析完成后保存草稿。');return {jobId:state.jobId,mapping:structuredClone(state.mapping),enabled:state.enabled,sourceUrl:job?.sourceUrl||$('tbBenchmarkLink')?.value||''};},
    async restore(value){clearTimeout(timer);state={jobId:null,analysisId:null,mapping:{},enabled:false,comparisons:{},...structuredClone(value)};job=null;busy=false;save();$('tbBenchmarkLink').value=value.sourceUrl||'';$('taobaoBenchmarks').open=!!state.jobId;render();if(state.jobId)await poll();comparisons();}
  };
  window.addEventListener('local-image-task-update',({detail:t})=>{
    if(t?.status==='completed'&&t.imageUrl&&t.benchmark){state.comparisons[t.imageUrl]=t.benchmark;save();setTimeout(comparisons,100);}
  });
  if(typeof renderSlot==='function'){const original=renderSlot;window.renderSlot=function(...args){const value=original(...args);comparisons();return value;};}
  function setup(){
    if(!$('taobaoShell'))return;
    const style=document.createElement('style');style.textContent=`
      #taobaoBenchmarks{padding:12px;margin:12px 0;border:1px solid #b6a26488;border-radius:12px;background:#101b2a88;color:#e2e8f0;font-size:12px}
      #taobaoBenchmarks summary{cursor:pointer;color:#ffe29b;font-size:14px;font-weight:bold}#taobaoBenchmarks p{line-height:1.65;margin:8px 0}
      #taobaoBenchmarks textarea,#taobaoBenchmarks select{width:100%;box-sizing:border-box;background:#0f172a;color:#edf2ff;border:1px solid #64748b;border-radius:6px;padding:7px;font-size:12px}
      #taobaoBenchmarks button{border:1px solid #d4b96c;padding:7px 9px;border-radius:6px;color:#ffe29b;margin:5px 4px 5px 0}#taobaoBenchmarks button:disabled{opacity:.4}
      #tbBenchmarkAssets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;max-height:250px;overflow:auto;margin:8px 0}
      #tbBenchmarkAssets a{color:#d3dded;text-decoration:none}#tbBenchmarkAssets img{width:100%;height:82px;object-fit:contain;background:#fff;border-radius:5px}
      #tbBenchmarkAssets span{display:block;font-size:11px}#tbBenchmarkBindings label{display:block;margin:8px 0}#tbBenchmarkBindings select{margin-top:4px}
      #tbBenchmarkMessage{color:#ffe29b;white-space:pre-wrap}#tbBenchmarkWarnings{color:#f1c2a4}.tb-benchmark-comparison{display:flex;gap:10px;padding:8px;font-size:11px;background:#111827;color:#dce7ff}.tb-benchmark-comparison img{width:70px;height:70px;object-fit:contain;background:white}`;document.head.append(style);
    const panel=document.createElement('details');panel.id='taobaoBenchmarks';panel.innerHTML=`<summary>对标链接与版式参考</summary>
      <p>粘贴淘宝／天猫链接或分享文案，提取对标图片。参考其布局，用你的商品、SKU和真实卖点重新制作；张数与尺寸仍以上方设置为准。</p>
      <textarea id="tbBenchmarkLink" rows="3" placeholder="淘宝／天猫商品链接或分享文案" aria-label="对标商品链接"></textarea>
      <button type="button" id="tbBenchmarkFetch">Apify 读取链接图片</button><button type="button" id="tbBenchmarkRefresh">刷新状态</button><button type="button" id="tbBenchmarkResume" hidden>同步已有抓取</button>
      <p>每次只抓一个商品，不抓评论；Apify 单次费用上限 0.05 美元。分析与生图费用另计。</p>
      <p id="tbBenchmarkConnection"></p><p id="tbBenchmarkTitle"></p><p id="tbBenchmarkCost"></p><a id="tbBenchmarkRun" target="_blank" rel="noopener" hidden>查看本次 Apify 运行记录</a><p id="tbBenchmarkWarnings"></p><div id="tbBenchmarkAssets"></div><div id="tbBenchmarkBindings"></div>
      <button type="button" id="tbBenchmarkAnalyze">分析并用于构思（使用视觉额度）</button><button type="button" id="tbBenchmarkClear">清除本次对标</button>
      <label><input type="checkbox" id="tbBenchmarkEnabled"> 使用本次对标版式</label>
      <p id="tbBenchmarkMessage" role="status"></p><p>读取和分析不会生图。对标未返回的分类不会用其他图冒充；没有绑定的图片使用原有构思。结果保存在本机，不自动发布。</p>`;
    $('taobaoShell').after(panel);
    if(state.jobId)panel.open=true;
    $('tbBenchmarkFetch').onclick=async()=>{
      const link=$('tbBenchmarkLink').value.trim();if(!link){message('请先粘贴对标商品链接。');return;}
      const request_id=crypto.randomUUID(),previous=structuredClone(state),previousJob=job;
      state={...state,jobId:request_id,analysisId:null,mapping:{},enabled:false};job=null;save();busy=true;render();message('正在提交取图任务…');
      try{job=await api('/api/taobao/benchmarks',{request_id,link});await poll();}
      catch(error){
        if(error.status>=400&&error.status<500){state=previous;job=previousJob;save();}
        busy=false;message(error.message+' 若提交结果未知，请点“刷新状态”查询原任务，不要重复读取。');render();
      }
    };
    $('tbBenchmarkAnalyze').onclick=async()=>{
      const asset_ids=[...new Set(selected().map(s=>s.assetId))];if(!asset_ids.length)return;
      state.analysisId=crypto.randomUUID();state.enabled=false;save();busy=true;render();message('正在提交版式分析…');
      try{await api('/api/taobao/benchmark-analyses',{request_id:state.analysisId,job_id:state.jobId,asset_ids});await poll();}
      catch(error){if(error.status>=400&&error.status<500){state.analysisId=null;save();}busy=false;message(error.message+' 请先刷新状态核对原任务。');render();}
    };
    $('tbBenchmarkEnabled').onchange=event=>{state.enabled=event.target.checked;save();message('对标设置已更改，请重新构思后生成。已有成图不会被改写。');};
    $('tbBenchmarkRefresh').onclick=poll;
    $('tbBenchmarkResume').onclick=async()=>{busy=true;render();try{await api('/api/taobao/benchmarks/resume',{job_id:state.jobId});await poll();}catch(error){busy=false;message(error.message);render();}};
    $('tbBenchmarkClear').onclick=()=>{clearTimeout(timer);state={...state,jobId:null,analysisId:null,mapping:{},enabled:false};job=null;save();render();message('已清除对标绑定，本品素材和已有成图保留。');};
    api('/api/taobao/benchmarks/status').then(s=>{$('tbBenchmarkConnection').textContent=`${s.sourceProvider==='apify'?'Apify 抓取':'抓取服务'}：${s.sourceConfigured?'已配置':'未配置'}；视觉分析：${s.analysisConfigured?'已配置':'未配置'}。`}).catch(e=>{$('tbBenchmarkConnection').textContent=e.message;});
    render();if(state.jobId)poll();
    setInterval(()=>{const next=JSON.stringify(slots());if(next!==signature){signature=next;render();}comparisons();},1700);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
