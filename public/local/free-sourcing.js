(() => {
  const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={running:'运行中',pending:'尚未提交',checking:'检查采集箱',submitted:'已点击，等待提示',collected:'采集成功，待核对入箱',verified:'已确认入箱',unavailable:'商品不可采集',completed:'已完成',paused:'已暂停',stopped:'已结束','waiting-verification':'验证待处理','waiting-plugin':'需要检查插件','waiting-login':'等待登录','waiting-network':'Temu访问失败','needs-review':'等待核对',failed:'采集失败'};
  labels['skipped-duplicate']='前端提示重复，已跳过';
  const captchaLabels={pending:'等待识别',requesting:'正在识别',submitted:'已提交识别',solving:'正在处理',answered:'已取得识别结果',solved:'验证已通过',succeeded:'验证已通过',completed:'已完成','not-passed':'页面验证未通过',failed:'验证失败',unknown:'结果待核对',cancelled:'已停止',unsupported:'暂不支持此类型',exhausted:'调用额度已用完'};
  const pluginLabels={ready:'已启用',missing:'尚未安装',disabled:'需要启用','browser-closed':'采集窗口未打开',unknown:'需要检查'};
  let token,settings,state,captchaState,pending=null,polling=false,acting=false;
  try{pending=JSON.parse(sessionStorage.getItem('free-sourcing-pending'));}catch{}
  const message=(value,error=false)=>{$('notice').hidden=false;$('notice').className=error?'error':'';$('notice').textContent=value;};
  const clearMessage=()=>{$('notice').hidden=true;$('notice').className='';$('notice').textContent='';};
  async function api(route,payload){
    const r=await fetch('/api/'+route,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(payload)});
    const value=await r.json();if(!r.ok)throw Object.assign(new Error(value.error||'请求失败'),{status:r.status});return value;
  }
  const remember=value=>{pending=value;try{if(value)sessionStorage.setItem('free-sourcing-pending',JSON.stringify(value));else sessionStorage.removeItem('free-sourcing-pending');}catch{}};
  const safeUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&['www.temu.com','temu.com'].includes(u.hostname)?u.href:'';}catch{return '';}};
  function controls(){
    const busy=acting||state?.busy||state?.otherBusy,unfinished=state?.jobs.some(j=>!['completed','stopped'].includes(j.status));
    for(const input of $('freeForm').elements)input.disabled=!!(busy||pending||unfinished);
    for(const input of $('captchaForm').elements)input.disabled=!!busy;
    $('checkCaptcha').disabled=!!(busy||!captchaState?.configured||$('captchaKey').value.trim());
    $('busyNotice').textContent=pending?'上次提交的回执尚待核对，请刷新进度。':state?.otherBusy?'其他工作台任务正在运行，结束后可继续。':unfinished?'请先继续或结束已有任务，再开始新的关键词。':'';
    document.querySelectorAll('[data-action]').forEach(button=>{button.disabled=!!(acting||state?.otherBusy||state?.busy&&button.dataset.action!=='stop');});
    document.querySelectorAll('[data-plugin]').forEach(button=>{button.disabled=!!(busy||!$('freeErp').value);});
    $('refresh').disabled=acting||polling;
  }
  function renderPlugin(){
    const erp=settings?.erpConnections.find(e=>e.key===$('freeErp').value),browser=settings?.browsers.find(b=>b.key===erp?.browserKey);
    const reuse=browser?.connectionMode==='existing',mode=browser?(reuse?'复用当前 Chrome':'独立 Chrome 窗口'):'未绑定';
    const checked=state?.pluginChecks?.find(p=>p.erpKey===erp?.key&&p.browserKey===browser?.key);
    $('pluginConfigured').textContent=checked?pluginLabels[checked.status]||'需要检查':'尚未检查';
    $('pluginConfigured').className='state'+(checked?.status==='ready'?' verified':'');
    $('pluginBinding').textContent=erp?`当前采集窗口：${browser?.name||'未绑定'} · ${mode} · 接收账号：${erp.expectedAccount||'未填写'}`:'请先在连接设置绑定店小秘账号和谷歌浏览器。';
    $('pluginMessage').textContent=checked?`${checked.message}${checked.version?`（版本 ${checked.version}）`:''}`:!browser?'请先在连接设置选择该账号使用的 Chrome，再检查插件。':reuse?'采集和店小秘登录会复用已打开的 Chrome，已有插件无需重装。请在装好插件的 Chrome 用户中保留店小秘页面，并按连接设置启用远程调试、允许工作台连接。':'当前账号使用独立 Chrome 窗口，插件和登录保存在该窗口。要复用日常 Chrome 已有的登录与插件，请到连接设置切换为“使用已打开的 Chrome”；继续使用独立窗口时，需要在该窗口安装插件。';
    $('pluginSetup').querySelector('[data-plugin="install"]').textContent=reuse?'查看插件安装状态':'在采集窗口安装插件';
  }
  function renderCaptcha(){
    const configured=!!captchaState?.configured;
    $('captchaConfigured').textContent=configured?'已配置':'未配置';$('captchaConfigured').className='state'+(configured?' verified':'');
    $('captchaKey').placeholder=configured?'已配置；填写新密钥可替换':'填写 SadCaptcha API 密钥';
    const checked=Date.parse(captchaState?.checkedAt),checkedText=Number.isFinite(checked)?`（${new Date(checked).toLocaleString('zh-CN')}）`:'';
    $('captchaBalance').textContent=!configured?'保存密钥后可检查连接与余额。':Number.isFinite(captchaState.credits)?`最近查询余额：${captchaState.credits} credits${checkedText}。实际扣费以供应商记录为准。`:'已配置密钥，请检查连接与余额以获取最新额度。';
  }
  function captchaProgress(job){
    if(!job.captcha)return '';
    const attempts=Array.isArray(job.captcha.attempts)?job.captcha.attempts:[],maxAttempts=Number(job.captcha.maxAttempts)||0,last=attempts.at(-1);
    const duration=last&&Number.isFinite(last.durationMs)?` · ${(last.durationMs/1000).toFixed(1)} 秒`:'';
    const diagnostics=Array.isArray(job.captcha.diagnostics)?job.captcha.diagnostics.slice(-20):[],latest=diagnostics.at(-1);
    const diagnosticTime=value=>{const date=Date.parse(value);return Number.isFinite(date)?new Date(date).toLocaleString('zh-CN'):'';};
    const pending=latest&&job.status==='waiting-verification'&&latest.attemptsAtObservation===attempts.length?`<p>最近一次调用前检查（${esc(diagnosticTime(latest.observedAt))}）：${esc(latest.message)}</p>`:'';
    const history=diagnostics.length?`<details class="captcha-diagnostics"><summary>调用前检查记录（${diagnostics.length}）</summary><ol>${[...diagnostics].reverse().map(item=>`<li><small>${esc(diagnosticTime(item.observedAt))} · ${item.stage==='product'?`商品 ${esc(item.goodsId)}`:'搜索页'}</small><p>${esc(item.message)}</p></li>`).join('')}</ol></details>`:'';
    return `<div class="captcha-result"><p>${maxAttempts>0?`自动验证已调用 <strong>${attempts.length} / ${maxAttempts}</strong> 次`:'本任务使用手动验证'}</p>${pending}${last?`<p>最近结果：${esc(captchaLabels[last.status]||last.status||'等待结果')}${duration}</p>${last.message?`<p class="${['failed','unknown','unsupported'].includes(last.status)?'error':'muted'}">${esc(last.message)}</p>`:''}`:''}${history}</div>`;
  }
  function render(){
    const expandedDiagnostics=new Set([...document.querySelectorAll('#freeJobs .captcha-diagnostics[open]')].map(detail=>detail.closest('[data-job]')?.dataset.job));
    $('freeJobs').innerHTML=state.jobs.map(job=>{
      const verified=job.rows.filter(r=>r.status==='verified').length,skipped=job.rows.filter(r=>r.status==='skipped-duplicate').length,waiting=job.status.startsWith('waiting-'),done=['completed','stopped'].includes(job.status);
      const erpConnection=settings?.erpConnections.find(item=>item.key===job.erpKey),browserConfig=settings?.browsers.find(item=>item.key===erpConnection?.browserKey);
      const pluginReady=job.status==='waiting-plugin'&&JSON.stringify({erpConnection,browserConfig})===JSON.stringify(job.binding)&&state.pluginChecks?.some(check=>check.erpKey===job.erpKey&&check.browserKey===browserConfig?.key&&check.status==='ready');
      const jobMessage=pluginReady?'店小秘插件已启用，点击“已处理，继续”后继续本任务。':job.message;
      return `<article class="batch" id="job-${esc(job.id)}" data-job="${esc(job.id)}"><div class="batch-head"><div><h3>${esc(job.keyword)}</h3><time>${esc(new Date(job.createdAt).toLocaleString('zh-CN'))} · ${esc(job.binding.erpConnection.name)}</time></div><span class="state ${esc(job.status)}">${esc(labels[job.status]||job.status)}</span></div><p class="free-summary"><span><strong>${verified}</strong> 件已确认</span><span>${job.rows.length} 件候选 / 目标 ${job.limit} 件</span>${skipped?`<span>${skipped} 件重复已跳过</span>`:""}</p><p class="${waiting?'free-handoff':'muted'}">${esc(jobMessage)}</p>${captchaProgress(job)}<div class="actions free-actions">${!done&&job.status!=='running'?`<button class="primary" data-action="resume">${waiting?'已处理，继续':'继续任务'}</button>`:''}${job.status==='waiting-plugin'?`<button data-action="plugin">${job.binding.browserConfig.connectionMode==='existing'?'查看本任务插件':'安装采集插件'}</button><button data-action="plugin-check">检查本任务插件</button>`:''}<button data-action="open">打开 Temu 任务页</button><button data-action="collection">打开采集箱</button>${job.rows.some(r=>r.submittedAt)?'<button data-action="reconcile">只核对结果</button>':''}${!done?`<button data-action="stop">${job.status==='running'?'暂停后续商品':'结束此任务'}</button>`:''}${verified?`<a href="/sourcing/listing?freeJobId=${encodeURIComponent(job.id)}">继续本批认领、补全与待发布 →</a>`:''}</div><ul>${job.rows.map(row=>{const url=safeUrl(row.sourceUrl);return `<li class="free-row"><span class="state ${esc(row.status)}">${esc(labels[row.status]||row.status)}</span><div>${url?`<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(row.title||row.goodsId)} ↗</a>`:esc(row.title)}<small class="muted">${esc(row.goodsId)}${row.reused||row.reusedSubmission?' · 复用并核对已有记录':''}</small>${row.error?`<small class="error">${esc(row.error)}</small>`:''}</div></li>`;}).join('')}</ul></article>`;
    }).join('')||'<p class="empty">输入关键词，开始第一批免费选品。</p>';
    document.querySelectorAll('#freeJobs .captcha-diagnostics').forEach(detail=>{detail.open=expandedDiagnostics.has(detail.closest('[data-job]')?.dataset.job);});
    renderPlugin();controls();
  }
  async function refresh(){[state,captchaState]=await Promise.all([api('free-sourcing'),api('free-sourcing/captcha')]);if(pending&&state.jobs.some(j=>j.id===pending.requestId))remember(null);renderCaptcha();render();}
  async function action(fn,{job}={}){if(acting)return;clearMessage();acting=true;controls();try{await fn();}catch(e){message((job?`任务“${job.keyword}”（${job.id.slice(0,8)}）：`:'')+e.message,true);}finally{acting=false;controls();}}
  $('freeForm').addEventListener('submit',event=>{event.preventDefault();void action(async()=>{
    if(pending)throw new Error('请先核对上一条提交。');
    const payload={...Object.fromEntries(new FormData($('freeForm'))),requestId:crypto.randomUUID(),collectionMode:'recording'};
    // Disabled form fields are not included in FormData, so read the known controls directly.
    payload.keyword=$('freeForm').elements.keyword.value;payload.limit=Number($('freeForm').elements.limit.value);payload.erpKey=$('freeErp').value;payload.captchaMaxAttempts=Number($('freeForm').elements.captchaMaxAttempts.value);
    remember(payload);
    try{await api('free-sourcing/jobs',payload);remember(null);}catch(e){if(e.status)remember(null);else message('提交结果暂时无法确认，正在核对同一任务记录。',true);throw e;}
    await refresh();
  });});
  $('freeJobs').addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(!button||button.disabled)return;const id=button.closest('[data-job]').dataset.job,job=state.jobs.find(item=>item.id===id);void action(async()=>{if(['plugin','plugin-check'].includes(button.dataset.action)){const checking=button.dataset.action==='plugin-check',view=job?.binding.browserConfig.connectionMode==='existing'?'manage':'install',result=await api(`free-sourcing/plugin/${checking?'check':'open'}`,{jobId:id,...(!checking?{view}:{})});message(result.message,checking&&result.status!=='ready');}else await api(`free-sourcing/jobs/${encodeURIComponent(id)}/${button.dataset.action}`,{});await refresh();},{job});});
  $('pluginSetup').addEventListener('click',event=>{const button=event.target.closest('[data-plugin]');if(!button||button.disabled)return;void action(async()=>{const checking=button.dataset.plugin==='check',result=await api(`free-sourcing/plugin/${checking?'check':'open'}`,{erpKey:$('freeErp').value,...(!checking?{view:button.dataset.plugin}:{})});message(result.message,checking&&result.status!=='ready');await refresh();});});
  $('refresh').onclick=()=>action(async()=>{await refresh();if(pending){await api('free-sourcing/jobs',pending);remember(null);await refresh();}});
  $('captchaKey').addEventListener('input',controls);
  $('captchaForm').addEventListener('submit',event=>{event.preventDefault();void action(async()=>{
    const key=$('captchaKey').value.trim();if(!key)throw new Error('请填写 SadCaptcha API 密钥；现有密钥不会被空白覆盖。');
    settings=await api('settings');settings=await api('settings',{revision:settings.revision,models:{SADCAPTCHA_API_KEY:key}});
    $('captchaKey').value='';captchaState={configured:!!settings.models.SADCAPTCHA_API_KEYConfigured,provider:'sadcaptcha',credits:null};renderCaptcha();
    message('SadCaptcha 密钥已加密保存。可检查连接与余额后开始采集。');
  });});
  $('checkCaptcha').onclick=()=>action(async()=>{
    const checked=await api('free-sourcing/captcha/check',{});captchaState={...captchaState,...checked};renderCaptcha();
    message(Number.isFinite(captchaState.credits)?'SadCaptcha 连接正常，已读取余额。':'检查请求已完成，供应商未返回可确认的余额。');
  });
  $('freeErp').onchange=()=>{const erp=settings.erpConnections.find(e=>e.key===$('freeErp').value),browser=settings.browsers.find(b=>b.key===erp?.browserKey);$('binding').textContent=erp?`账号：${erp.expectedAccount||'未填写'} · 浏览器：${browser?.name||'未绑定'}`:'请先到连接设置绑定店小秘账号。';renderPlugin();controls();};
  void (async()=>{
    ({token}=await api('session'));settings=await api('settings');
    $('freeErp').innerHTML=settings.erpConnections.filter(e=>(e.provider||'dianxiaomi')==='dianxiaomi').map(e=>`<option value="${esc(e.key)}">${esc(e.name)}</option>`).join('')||'<option value="">请先添加店小秘账号</option>';$('freeErp').onchange();await refresh();
    setInterval(async()=>{if(polling||acting||document.hidden)return;polling=true;try{await refresh();}catch(e){message(e.message,true);}finally{polling=false;controls();}},2500);
  })().catch(e=>message(e.message,true));
})();
