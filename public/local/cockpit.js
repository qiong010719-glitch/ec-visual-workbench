/* Read-only overview. All creation, billing and publishing stay in the existing tools. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const icons = {
    products:'<path d="m12 3 9 5-9 5-9-5Zm-9 5v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5"/>',
    sourcing:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5M8 10.5h5m-2.5-2.5v5"/>',
    content:'<rect x="3" y="3" width="15" height="18" rx="2"/><path d="m6 16 4-5 5 6M8 7h2m11-1v8m-4-4h8"/><path d="M6 18h9"/>',
    listings:'<path d="M5 11v9h14v-9M3 7l2-4h14l2 4v4a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0ZM9 20v-6h6v6"/>',
    tasks:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="m7 8 1 1 2-2m3 1h4m-10 5 1 1 2-2m3 1h4M7 18h10"/>',
    settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>'
  };
  const icon = name => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (icons[name] || icons.products) + '</svg>';
  const modules = [
    {id:'products',name:'商品库',short:'商品资料的起点',url:'/products',badge:'共享资料',description:'商品事实、原图和平台成品，在这里统一管理。',features:['新建与编辑商品资料','上传原图、批量导入文件夹','搜索商品、查看平台版本'],nextTitle:'从一份商品资料开始',next:'导入原图，或新建一个商品。后续制作会沿用这些资料。',scope:'各平台成品分别保存，商品原图与事实共用。'},
    {id:'sourcing',name:'选品与采集',short:'发现值得做的商品',url:'/sourcing',badge:'Temu 选品',description:'按关键词和市场条件筛选商品，把可用的商品资料带回工作台。',features:['免费关键词采集与验证恢复','数据服务筛选与原始详情','采集箱核对及按店认领'],nextTitle:'先明确市场与选品条件',next:'可从免费选品开始，也可连接数据服务按条件筛选。',scope:'当前选品接口支持 Temu；Amazon 选品尚未接入。'},
    {id:'content',name:'内容制作',short:'把商品变成好内容',url:'/content',badge:'双平台设计',description:'围绕同一商品制作主图、副图与平台内容，让每一套成品保持一致。',features:['单品设计与图片编辑','多方向、多套图片裂变','Amazon A+ 与 Temu 方图'],nextTitle:'选好商品，再开始创作',next:'选择当前商品与目标平台，制作结果会保存为独立的平台版本。',scope:'图片生成沿用已配置模型与计费流程；在制作页明确提交后执行。'},
    {id:'listings',name:'上架中心',short:'从成品到店铺',url:'/listings?mode=images',badge:'分平台执行',description:'把制作好的图片与商品资料交给店铺，核对后继续草稿或上架流程。',features:['图片裂变与已有成品上架','采集商品按固定模板批量填写','逐店核对保存和发布结果'],nextTitle:'先核对，再继续上架',next:'选择目标店铺与母稿，确认商品事实、标题和图片后再执行。',scope:'Temu 按现有确认流程执行；Amazon 支持资料包导出，尚未接入自动发布。'},
    {id:'tasks',name:'任务记录',short:'每一步都有记录',url:'/tasks',badge:'统一追踪',description:'设计、裂变、采集和上架任务集中查看，随时回到对应环节继续。',features:['按状态与平台筛选任务','核对进行中和异常任务','返回原任务继续处理'],nextTitle:'先处理需要关注的任务',next:'失败或待核对任务保留原记录，打开任务后按实际状态继续。',scope:'任务状态来自当前工作空间，不代表外部平台已审核或发布。'},
    {id:'settings',name:'设置',short:'让所有工具协同',url:'/settings',badge:'本机配置',description:'管理生图、文字、视频和链接分析密钥，以及浏览器、ERP 和店铺连接。',features:['四类服务密钥，服务配置由网站内置','复用 Chrome 登录、插件与 ERP 连接','店铺、站点及商品母稿管理'],nextTitle:'配置服务密钥与店铺连接',next:'按需填写对应网站的服务密钥，再配置浏览器、ERP 与目标店铺。',scope:'服务地址、模型及调用方式由网站内置，用户只需填写密钥。视频生成接入准备中。'}
  ];
  const active = new Set(['pending','queued','running','planning','generating','checking','processing','collecting','publishing']);
  const attention = new Set(['failed','error','attention','partial','partial_succeeded','interrupted','needs_review','awaiting_review','needs-review','waiting-verification','waiting-plugin','waiting-login','waiting-network','inspected','unknown','paused']);
  const statusNames = {'needs-review':'待核对','waiting-verification':'验证待处理','waiting-plugin':'插件待处理','waiting-login':'等待登录','waiting-network':'访问待恢复',inspected:'已定位待填写',submitted:'已提交待平台核实',pending:'待处理',queued:'排队中',running:'进行中',planning:'构思中',generating:'生成中',checking:'核对中',processing:'处理中',collecting:'采集中',publishing:'上架中',completed:'已完成',complete:'已完成',succeeded:'已完成',success:'已完成',saved:'已保存',published:'已发布',exported:'已导出',failed:'失败',error:'失败',attention:'待处理',partial:'部分完成',partial_succeeded:'部分完成',interrupted:'已中断',needs_review:'待核对',awaiting_review:'待核对',paused:'已暂停',draft:'草稿',planned:'方案就绪',prepared:'已准备',ready:'已就绪',cancelled:'已取消',stopped:'已停止'};
  const platformName = value => value === 'amazon' ? 'Amazon' : value === 'temu' ? 'Temu' : '通用';
  const safeLink = (value, fallback = '/products') => {
    try { const url = new URL(value,location.origin); return url.origin === location.origin && /^\/(products|content|tasks|listings|sourcing|settings|design|temu(?:\/listings)?)(?:\/)?$/.test(url.pathname) ? url.pathname + url.search + url.hash : fallback; } catch { return fallback; }
  };
  const safeImage = value => {
    try { const url = new URL(value,location.origin); return (url.origin === location.origin && /^\/media\/[a-zA-Z0-9_.%-]+$/.test(url.pathname)) || (url.protocol === 'https:' && !url.username && !url.password) ? url.href : ''; } catch { return ''; }
  };
  const readableDate = value => {
    const date = new Date(value); return !value || Number.isNaN(date.getTime()) ? '工作台记录' : new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'}).format(date);
  };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const storageKey = 'commerce-cockpit-appearance';
  let appearance = {theme:'dark',accent:'ocean',motion:true,material:true,view:'orbit'};
  try { const saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); appearance = {...appearance,theme:saved.theme === 'light' ? 'light':'dark',accent:['ocean','emerald','violet'].includes(saved.accent)?saved.accent:'ocean',motion:saved.motion!==false,material:saved.material!==false,view:saved.view==='flat'?'flat':'orbit'}; } catch {}
  let workspace = null, inFlight = null, selected = 0, queueTab = 'recent', playTimer = null, refreshTimer = null, drag = null, suppressClick = false, resizeObserver;
  const normalizeSnapshot = value => {
    if (!value || !Array.isArray(value.products) || !Array.isArray(value.tasks) || !Array.isArray(value.stores)) throw new Error('工作台返回的资料不完整');
    return value;
  };
  function applyAppearance(persist = false) {
    document.documentElement.dataset.cockpitTheme = appearance.theme;
    document.documentElement.dataset.cockpitAccent = appearance.accent;
    document.body.dataset.motion = appearance.motion && !reduce.matches ? 'on':'off';
    document.body.dataset.material = appearance.material ? 'on':'off';
    document.querySelectorAll('[data-theme]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.theme === appearance.theme)));
    document.querySelectorAll('[data-accent]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.accent === appearance.accent)));
    $('motionToggle').checked = appearance.motion;
    $('materialToggle').checked = appearance.material;
    $('motionNote').textContent = reduce.matches ? '已遵循系统的“减少动态效果”设置，当前以静态方式展示。' : '偏好自动保存在当前浏览器。';
    $('orbitPlay').disabled = !appearance.motion || reduce.matches || appearance.view === 'flat';
    if ($('orbitPlay').disabled) setPlaying(false);
    $('orbitStage').classList.toggle('is-flat',appearance.view === 'flat');
    $('orbitView').setAttribute('aria-pressed',String(appearance.view === 'flat'));
    $('orbitView').textContent = appearance.view === 'flat' ? '3D 环绕':'平面视图';
    $('orbitView').title = appearance.view === 'flat' ? '切换为 3D 环绕':'切换为平面卡片';
    if (persist) { try { localStorage.setItem(storageKey,JSON.stringify(appearance)); } catch { $('motionNote').textContent = '外观已应用；当前浏览器无法保存偏好。'; } }
    document.dispatchEvent(new CustomEvent('cockpit:appearance-changed',{detail:{...appearance,motion:appearance.motion && !reduce.matches}}));
    positionCards();
  }
  function setPlaying(value) {
    clearInterval(playTimer); playTimer = null;
    if (value && appearance.motion && !reduce.matches && appearance.view !== 'flat' && !document.hidden) playTimer = setInterval(() => selectModule(selected + 1,false),4200);
    $('orbitPlay').setAttribute('aria-pressed',String(Boolean(playTimer)));
    $('orbitPlay').setAttribute('aria-label',playTimer ? '暂停自动浏览':'自动浏览功能卡片');
    $('orbitPlay').title = playTimer ? '暂停自动浏览':'自动浏览';
    $('orbitPlay').innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (playTimer ? '<path d="M9 5v14M16 5v14"/>' : '<path d="m9 5 11 7-11 7z"/>') + '</svg>';
  }
  function mountOrbit() {
    $('moduleOrbit').innerHTML = modules.map((module,index) => `<button type="button" class="module-card" data-module-id="${module.id}" aria-pressed="${index===0}" aria-label="${module.name}，查看功能详情"><span class="module-number">${String(index+1).padStart(2,'0')}<i></i></span><span class="module-illustration">${icon(module.id)}</span><span class="module-title">${module.name}</span><span class="module-subtitle">${module.short}</span></button>`).join('');
    $('orbitIndicators').innerHTML = modules.map((module,index) => `<button type="button" data-orbit-index="${index}" aria-label="选择${module.name}" aria-pressed="${index===0}"></button>`).join('');
    $('moduleOrbit').addEventListener('click',event => { const card = event.target.closest('[data-module-id]'); if (!card || suppressClick) return; selectModule(modules.findIndex(module => module.id === card.dataset.moduleId)); });
    $('moduleOrbit').addEventListener('dblclick',event => { const card = event.target.closest('[data-module-id]'); if (card && !suppressClick) location.assign(modules.find(module => module.id === card.dataset.moduleId).url); });
    $('moduleOrbit').addEventListener('keydown',event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();selectModule(event.key === 'Home' ? 0 : event.key === 'End' ? modules.length-1 : selected + (event.key === 'ArrowRight' ? 1:-1));
      $('moduleOrbit').querySelector('[aria-pressed="true"]').focus({preventScroll:true});
    });
    $('orbitIndicators').addEventListener('click',event => { const dot = event.target.closest('[data-orbit-index]'); if (dot) selectModule(Number(dot.dataset.orbitIndex)); });
    $('orbitPrev').addEventListener('click',() => selectModule(selected-1));
    $('orbitNext').addEventListener('click',() => selectModule(selected+1));
    $('orbitPlay').addEventListener('click',() => setPlaying(!playTimer));
    $('orbitView').addEventListener('click',() => { appearance.view = appearance.view === 'flat'?'orbit':'flat';setPlaying(false);applyAppearance(true); });
    const stage = $('orbitStage');
    stage.addEventListener('pointerdown',event => {
      if (event.button !== 0 || appearance.view === 'flat' || event.target.closest('.orbit-navigation')) return;
      drag = {id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastTime:performance.now(),velocity:0,moved:false};setPlaying(false);
    });
    stage.addEventListener('pointermove',event => {
      if (!drag || drag.id!==event.pointerId) return;
      const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
      if (!drag.moved && Math.abs(dy)>Math.abs(dx) && Math.abs(dy)>10) { drag=null;return; }
      if (Math.abs(dx)>9) { drag.moved=true; if (!stage.hasPointerCapture(event.pointerId)) stage.setPointerCapture(event.pointerId); }
      if (!drag.moved) return;
      const time=performance.now();drag.velocity=(event.clientX-drag.lastX)/Math.max(1,time-drag.lastTime);drag.lastX=event.clientX;drag.lastTime=time;
      if (window.CockpitScene?.ready) window.CockpitScene.drag(dx);
      else $('moduleOrbit').style.translate = `${Math.max(-75,Math.min(75,dx*.24))}px 0`;
    });
    const endDrag = event => {
      if (!drag || event.pointerId!==drag.id) return;
      const state=drag;drag=null;$('moduleOrbit').style.translate='';
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
      if (!state.moved) return;
      const dx=event.clientX-state.x;
      if(window.CockpitScene?.ready)window.CockpitScene.releaseDrag(state.velocity);
      else if (Math.abs(dx)>28 || Math.abs(state.velocity)>.4) selectModule(selected+(dx<0?1:-1));
      suppressClick=true;setTimeout(() => {suppressClick=false;},0);
    };
    stage.addEventListener('pointerup',endDrag);
    stage.addEventListener('pointercancel',event => { if (drag?.id===event.pointerId) {drag=null;$('moduleOrbit').style.translate='';window.CockpitScene?.drag(0);} });
    document.addEventListener('cockpit:select-module',event=>selectModule(event.detail.index));
    resizeObserver=new ResizeObserver(positionCards);resizeObserver.observe(stage);
  }
  function positionCards() {
    window.CockpitScene?.select(selected);
    const width=$('moduleOrbit').clientWidth || 500;
    const spread=Math.min(180,Math.max(60,(width-145)/2.1));
    for (const [index,card] of [...$('moduleOrbit').children].entries()) {
      let distance=(index-selected+modules.length)%modules.length;
      if (distance>modules.length/2) distance-=modules.length;
      const absolute=Math.abs(distance),direction=Math.sign(distance);
      const x=direction*spread*(absolute===1?.54:absolute===2?.9:1.06);
      const y=absolute===0?-8:absolute===1?8:absolute===2?21:25;
      const scale=absolute===0?1.03:absolute===1?.88:absolute===2?.74:.63;
      const rotation=direction*(absolute===1?-12:absolute===2?-19:-23);
      if (!window.CockpitScene?.ready || appearance.view==='flat') {
        card.style.transform=`translate3d(${x}px,${y}px,${-absolute*18}px) rotateY(${rotation}deg) rotateZ(${direction*absolute*1.4}deg) scale(${scale})`;
        card.style.opacity=String(absolute===0?1:absolute===1?.78:absolute===2?.48:.27);
      }
      card.style.zIndex=String(10-absolute);
      card.setAttribute('aria-pressed',String(index===selected));
    }
    for (const [index,dot] of [...$('orbitIndicators').children].entries()) dot.setAttribute('aria-pressed',String(index===selected));
  }
  function selectModule(index,user=true) {
    if (user) setPlaying(false);
    selected=(index+modules.length)%modules.length;positionCards();renderDetails();
  }
  function renderDetails() {
    const module=modules[selected];
    $('detailIndex').textContent=`${String(selected+1).padStart(2,'0')} / 06`;
    $('detailTitle').textContent=module.name;$('detailBadge').textContent=module.badge;
    $('detailDescription').textContent=module.description;$('detailArt').innerHTML=icon(module.id);
    $('detailFeatures').innerHTML=module.features.map(feature=>`<li>${icon('check')}<span>${feature}</span></li>`).join('');
    $('nextStepTitle').textContent=module.nextTitle;$('nextStepDescription').textContent=module.next;
    $('capabilityNote').textContent=module.scope;$('currentModuleLabel').textContent='打开'+module.name+' ↗';$('orbitQuickOpen').href=module.url;
    $('detailAction').href=module.url;$('detailAction').innerHTML='打开'+module.name+' '+icon('arrow');
    const count=workspace?.products.length, taskCount=workspace?.tasks.length, storeCount=workspace?.stores.length;
    const facts = {
      products:[['资料范围','当前工作空间'],['现有商品',count===undefined?'正在读取':count+' 个'],['成品归属','按平台分别保存']],
      sourcing:[['选品平台','Temu'],['数据来源','已连接的选品服务'],['采集去向','店小秘采集箱']],
      content:[['制作平台','Amazon / Temu'],['商品资料',count===undefined?'正在读取':count+' 个可选商品'],['输出方式','单品 / 多套裂变']],
      listings:[['已配置店铺',storeCount===undefined?'正在读取':storeCount+' 家'],['Temu','核对后执行'],['Amazon','资料包导出']],
      tasks:[['任务总数',taskCount===undefined?'正在读取':taskCount+' 项'],['记录范围','设计 / 采集 / 上架'],['数据来源','当前工作空间']],
      settings:[['已关联店铺',storeCount===undefined?'正在读取':storeCount+' 家'],['浏览器','沿用账号绑定的 Chrome'],['模型服务','沿用已有配置']]
    };
    $('detailFacts').innerHTML=facts[module.id].map(([label,value])=>`<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('');
  }
  function renderQueue() {
    if (!workspace) return;
    const tasks=[...workspace.tasks].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    const shown=(queueTab==='attention'?tasks.filter(task=>attention.has(task.status)):tasks).slice(0,4);
    $('attentionCount').textContent=String(tasks.filter(task=>attention.has(task.status)).length);
    if (shown.length) {
      $('queueContent').innerHTML='<div class="queue-group-label"><span class="tiny-dot"></span>'+(queueTab==='attention'?'需要你关注':'最近更新')+' <span>'+shown.length+'</span></div>'+shown.map(task=>`<a class="queue-item" href="${escape(safeLink(task.url,'/tasks'))}"><span class="queue-item-icon">${icon(task.type?.includes('上架')?'listings':task.type?.includes('采集')||task.type?.includes('选品')?'sourcing':'content')}</span><span class="queue-item-copy"><strong title="${escape(task.title)}">${escape(task.title||'工作台任务')}</strong><small>${escape(platformName(task.platform))} · ${escape(task.type||'任务')}</small></span><span class="status-tag ${attention.has(task.status)?'warning':''}">${escape(statusNames[task.status]||'待核对')}</span></a>`).join('');
    } else {
      $('queueContent').innerHTML=`<div class="queue-empty">${icon('check')}<strong>${queueTab==='attention'?'暂时没有待处理任务':'今天，从一个好商品开始'}</strong><p>${queueTab==='attention'?'需要核对的任务会集中显示在这里。':'完成一次选品或创作后，可以在这里跟进进度。'}</p></div>`+(queueTab==='recent'?'<div class="queue-group-label">开始工作</div>'+[
        ['products','整理商品资料','导入原图与商品事实'],['content','制作第一套图片','选择平台，开始设计'],['settings','连接目标店铺','配置 ERP 与商品母稿']
      ].map(([id,title,subtitle])=>`<a class="queue-item" href="${modules.find(module=>module.id===id).url}"><span class="queue-item-icon">${icon(id)}</span><span class="queue-item-copy"><strong>${title}</strong><small>${subtitle}</small></span><span class="status-tag">↗</span></a>`).join(''):'');
    }
  }
  function renderProducts() {
    const products=[...workspace.products].sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''))).slice(0,3);
    if (!products.length) { $('recentProducts').innerHTML='<div class="recent-empty"><p>还没有商品。先添加原图与商品资料。</p><a class="quiet-link" href="/products">添加商品 ↗</a></div>';return; }
    $('recentProducts').innerHTML=products.map(product=>{
      const images=Array.isArray(product.images)?product.images:[], versions=Array.isArray(product.versions)?product.versions:[];
      const cover=images.find(image=>safeImage(typeof image==='string'?image:image.url)),src=cover?safeImage(typeof cover==='string'?cover:cover.url):'';
      const platforms=[...new Set(versions.map(version=>version.platform))].filter(id=>['amazon','temu'].includes(id));
      const url='/content?product='+encodeURIComponent(product.id)+'&platform='+(workspace.context?.platform==='temu'?'temu':'amazon');
      return `<article class="recent-product"><span class="recent-product-image">${src?`<img src="${escape(src)}" alt="${escape(product.name||'商品原图')}" loading="lazy">`:icon('products')}</span><div class="recent-product-info"><strong>${escape(product.name||'未命名商品')}</strong><p>${images.length} 张原图 · ${versions.length} 个平台版本 · ${escape(readableDate(product.updatedAt||product.createdAt))}</p></div><div class="product-platforms">${platforms.map(id=>'<span>'+platformName(id)+'</span>').join('')||'<span>待制作</span>'}</div><a href="${escape(url)}">继续制作 ↗</a></article>`;
    }).join('');
    $('recentProducts').querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{img.parentElement.innerHTML=icon('products');},{once:true}));
  }
  function renderSnapshot(state) {
    workspace=normalizeSnapshot(state);
    $('metricProducts').textContent=String(workspace.products.length);
    const running=workspace.tasks.filter(task=>active.has(task.status)).length,pending=workspace.tasks.filter(task=>attention.has(task.status)).length;
    $('metricTasks').textContent=String(running+pending);
    $('taskMetricNote').textContent=running||pending?`${running} 项进行中 · ${pending} 项需要处理`:'所有工作都可以从容开始';
    $('metricVersions').textContent=String(workspace.products.reduce((total,product)=>total+(product.versions||[]).filter(version=>version.status==='completed').length,0));
    $('metricStores').textContent=String(workspace.stores.length);
    $('storeMetricNote').textContent=workspace.stores.length?'店铺与母稿统一管理':'添加店铺，准备开始经营';
    $('connectionLabel').textContent='工作台已连接';
    $('lastSynced').textContent='同步于 '+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date());
    $('cockpitNotice').hidden=true;renderDetails();renderQueue();renderProducts();
    if ($('globalSearch').value) renderSearch();
  }
  async function refresh() {
    if (inFlight) return inFlight;
    $('refreshOverview').disabled=true;
    inFlight=fetch('/api/workspace',{cache:'no-store',signal:AbortSignal.timeout(15000)}).then(async response=>{
      const state=await response.json();if (!response.ok) throw new Error(state.error||'工作台连接失败');
      renderSnapshot(state);document.dispatchEvent(new CustomEvent('workspace:changed',{detail:{workspace:state}}));
    }).catch(error=>{
      $('connectionLabel').textContent='连接需要重试';$('cockpitNotice').hidden=false;
      $('cockpitNotice').querySelector('span').textContent=(workspace?'暂时无法同步，当前显示上次读取的资料。':'暂时无法读取商品与任务，请检查本地工作台服务。')+' '+(error.name==='TimeoutError'?'连接超时':error.message);
      if (!workspace) { $('queueContent').innerHTML='<p class="muted-note">连接恢复后显示真实任务。</p>';$('recentProducts').innerHTML='<p class="muted-note">连接恢复后显示商品资料。</p>'; }
    }).finally(()=>{inFlight=null;$('refreshOverview').disabled=false;});
    return inFlight;
  }
  function renderSearch() {
    const term=$('globalSearch').value.trim().toLowerCase(),results=$('searchResults');
    if (!term) {results.hidden=true;$('globalSearch').setAttribute('aria-expanded','false');return;}
    const candidates=[...modules.map(module=>({title:module.name,description:module.short+' '+module.features.join(' '),type:'功能入口',url:module.url,icon:module.id})),...(workspace?.products||[]).map(product=>({title:product.name,description:product.description||'',type:'商品资料',url:'/content?product='+encodeURIComponent(product.id)+'&platform='+(workspace.context?.platform==='temu'?'temu':'amazon'),icon:'products'})),...(workspace?.tasks||[]).map(task=>({title:task.title,description:task.type||'',type:'任务记录',url:safeLink(task.url,'/tasks'),icon:'tasks'}))];
    const matched=candidates.filter(item=>(item.title+' '+item.description).toLowerCase().includes(term)).slice(0,8);
    results.innerHTML=matched.length?matched.map(item=>`<a href="${escape(item.url)}">${icon(item.icon)}<span class="search-result-copy"><strong>${escape(item.title)}</strong><small>${item.type}</small></span></a>`).join(''):'<p>没有匹配的商品、任务或功能。换一个关键词试试。</p>';
    results.hidden=false;$('globalSearch').setAttribute('aria-expanded','true');
  }
  function openAppearance() {setPlaying(false);if (!$('appearanceDialog').open) $('appearanceDialog').showModal();}
  function startRefreshTimer() {clearInterval(refreshTimer);refreshTimer=setInterval(()=>{if(!document.hidden)refresh();},30000);}
  mountOrbit();applyAppearance();renderDetails();refresh();startRefreshTimer();
  $('workspaceDate').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(new Date());
  $('refreshOverview').addEventListener('click',refresh);$('retryLoad').addEventListener('click',refresh);
  document.addEventListener('workspace:refresh',refresh);
  document.addEventListener('workspace:changed',event=>{if(event.detail?.workspace && event.detail.workspace!==workspace){try{renderSnapshot(event.detail.workspace);}catch{}}});
  document.querySelectorAll('[data-queue]').forEach(button=>button.addEventListener('click',()=>{queueTab=button.dataset.queue;document.querySelectorAll('[data-queue]').forEach(tab=>tab.setAttribute('aria-selected',String(tab===button)));$('queueContent').setAttribute('aria-labelledby',button.id);renderQueue();}));
  $('globalSearch').addEventListener('input',renderSearch);$('globalSearch').addEventListener('focus',renderSearch);
  $('globalSearch').addEventListener('keydown',event=>{if(event.key==='ArrowDown'){$('searchResults').querySelector('a')?.focus();event.preventDefault();}});
  document.addEventListener('click',event=>{if(!event.target.closest('.global-search-wrap')){$('searchResults').hidden=true;$('globalSearch').setAttribute('aria-expanded','false');}});
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();$('globalSearch').focus();}if(event.key==='Escape'){$('searchResults').hidden=true;$('globalSearch').setAttribute('aria-expanded','false');}});
  $('appearanceOpen').addEventListener('click',openAppearance);document.addEventListener('cockpit:appearance',openAppearance);
  ['appearanceClose','appearanceDone'].forEach(id=>$(id).addEventListener('click',()=>$('appearanceDialog').close()));
  $('appearanceDialog').addEventListener('click',event=>{if(event.target===$('appearanceDialog')){const box=event.target.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)event.target.close();}});
  document.querySelectorAll('[data-theme]').forEach(button=>button.addEventListener('click',()=>{appearance.theme=button.dataset.theme;applyAppearance(true);}));
  document.querySelectorAll('[data-accent]').forEach(button=>button.addEventListener('click',()=>{appearance.accent=button.dataset.accent;applyAppearance(true);}));
  $('motionToggle').addEventListener('change',()=>{appearance.motion=$('motionToggle').checked;applyAppearance(true);});
  $('materialToggle').addEventListener('change',()=>{appearance.material=$('materialToggle').checked;applyAppearance(true);});
  reduce.addEventListener('change',()=>applyAppearance());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)setPlaying(false);else refresh();});
  window.addEventListener('focus',()=>{if(!document.hidden)refresh();});
  window.addEventListener('pagehide',()=>{setPlaying(false);clearInterval(refreshTimer);resizeObserver?.disconnect();});
  window.addEventListener('pageshow',event=>{if(event.persisted){resizeObserver.observe($('orbitStage'));applyAppearance();refresh();startRefreshTimer();}});
  if(location.hash==='#appearance')openAppearance();
})();
