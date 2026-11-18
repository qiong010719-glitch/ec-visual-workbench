/* Shared product and task views. Execution remains in the existing design/listing services. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const page = location.pathname.replace(/\/+$/, '') === '/tasks' ? 'tasks' : location.pathname.replace(/\/+$/, '') === '/content' ? 'content' : 'products';
  const platformName = id => id === 'amazon' ? 'Amazon 亚马逊' : id === 'temu' ? 'Temu' : '通用';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const placeholderIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m4 17 5-5 4 4 3-3 5 5"/><circle cx="15.5" cy="8.5" r="1.5"/></svg>';
  let workspace = null, loading = null, tokenPromise, contextSaving = false, editor = null, busyDialog = '', requestSequence = 0, appliedSequence = 0;
  const versionSelection = new Map();
  const statusLabels = {pending:'等待处理',queued:'排队中',running:'进行中',planning:'生成方案中',generating:'出图中',checking:'核对中',processing:'处理中',collecting:'采集中',publishing:'上架中',draft:'草稿',ready:'已就绪',completed:'已完成',complete:'已完成',succeeded:'已完成',success:'已完成',saved:'已保存',published:'已发布',failed:'失败',error:'失败',attention:'需要处理',partial:'部分完成',partial_succeeded:'部分完成',cancelled:'已取消',canceled:'已取消',stopped:'已停止',interrupted:'已中断',paused:'已暂停',not_started:'尚未开始',planned:'方案已就绪',needs_review:'待核对',awaiting_review:'待核对',prepared:'已准备',materialized:'已准备上架',exported:'已导出',unknown:'待核对'};
  const activeStatuses = new Set(['pending','queued','running','planning','generating','checking','processing','collecting','publishing']);
  const completeStatuses = new Set(['completed','complete','succeeded','success','saved','published','exported']);
  const versionReady = version => version?.status === 'completed' || (version?.source?.kind === 'draft' && version.status === 'draft');
  const attentionStatuses = new Set(['failed','error','attention','partial','partial_succeeded','interrupted','needs_review','awaiting_review','unknown']);
  const safeLink = value => {
    if (!value || typeof value !== 'string' || value.includes('\\')) return '';
    try { const url = new URL(value, location.origin); return url.origin === location.origin && ['http:','https:'].includes(url.protocol) ? url.pathname + url.search + url.hash : ''; } catch { return ''; }
  };
  const safeMedia = value => {
    if (!value || typeof value !== 'string') return '';
    try { const url = new URL(value, location.origin); return !url.username && !url.password && (url.protocol === 'https:' || url.origin === location.origin || (url.protocol === 'blob:' && value.startsWith('blob:' + location.origin))) ? value : ''; } catch { return ''; }
  };
  const date = value => {
    if (!value) return '时间未记录';
    const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? '时间未记录' : new Intl.DateTimeFormat('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(parsed);
  };
  const status = value => statusLabels[value] || String(value || '尚未开始');
  const statusClass = value => completeStatuses.has(value) ? 'is-success' : attentionStatuses.has(value) ? 'is-danger' : activeStatuses.has(value) ? 'is-current' : '';
  const image = (media, className = '', alt = '') => safeMedia(media?.url) ? `<img src="${escape(safeMedia(media.url))}" class="${className}" alt="${escape(alt || media.filename || '商品图片')}" loading="lazy">` : '';

  async function api(path, payload, binary = false) {
    const init = {cache:'no-store'};
    if (payload !== undefined) {
      tokenPromise ||= fetch('/api/session', {cache:'no-store'}).then(async response => { const data = await response.json(); if (!response.ok || !data.token) throw new Error(data.error || '无法连接本地工作台，请刷新页面'); return data.token; }).catch(error => { tokenPromise = null; throw error; });
      const token = await tokenPromise;
      init.method = 'POST'; init.headers = {'x-workbench-token':token};
      if (binary) init.body = payload;
      else { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(payload); }
    }
    const response = await fetch(path, init);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(result.error || result.message || `读取工作台失败（${response.status}）`); error.status = response.status; throw error; }
    return result;
  }
  function notice(message, error = false) { $('workspaceNotice').textContent = message; $('workspaceNotice').classList.toggle('is-error', error); $('workspaceNotice').hidden = !message; }
  function announceSnapshot(state) { document.dispatchEvent(new CustomEvent('workspace:changed', {detail:{workspace:state}})); }
  function applySnapshot(state) {
    if (!state || !Array.isArray(state.products) || !Array.isArray(state.tasks)) return;
    workspace = {...state, context:state.context || {}, stores:Array.isArray(state.stores) ? state.stores : []};
    $('workspaceLoading').hidden = true; $(page + 'Page').hidden = false;
    document.title = ({products:'商品库',content:'内容制作',tasks:'任务记录'})[page] + ' · 跨境电商工作台';
    if (page === 'products') renderProducts();
    else if (page === 'content') renderContent();
    else renderTasks();
  }
  async function refresh({quiet = false, force = false} = {}) {
    if (loading && !force) return loading;
    const sequence = ++requestSequence;
    const pending = api('/api/workspace').then(state => {
      if (sequence >= appliedSequence) { appliedSequence = sequence; applySnapshot(state); announceSnapshot(state); }
      return state;
    }).catch(error => { if (!quiet || !workspace) { $('workspaceLoading').hidden = true; notice(error.message + '。可点击顶部同步状态重试。', true); } throw error; });
    loading = pending;
    try { return await pending; } finally { if (loading === pending) loading = null; }
  }
  const selectedProduct = () => workspace?.products.find(product => product.id === workspace.context.productId);
  const selectedPlatform = () => workspace?.context.platform === 'temu' ? 'temu' : 'amazon';
  function navigate(path) { const safe = safeLink(path); if (safe) location.assign(safe); }
  async function saveContext(patch, {navigateTo} = {}) {
    if (contextSaving || !workspace) return false;
    contextSaving = true;
    for (const id of ['contentProduct','contentPlatform','contentStore']) $(id).disabled = true;
    $('contextSaveStatus').textContent = '正在同步…';
    try {
      await api('/api/workspace/context', {...patch, revision:workspace.context.revision});
      await refresh({force:true});
      if (navigateTo) navigate(navigateTo);
      return true;
    } catch (error) {
      await refresh({quiet:true,force:true}).catch(() => {});
      notice(error.status === 409 ? '工作台的当前选择已在其他页面更新。已读取最新状态，请重新选择。' : error.message, true);
      return false;
    } finally {
      contextSaving = false;
      for (const id of ['contentProduct','contentPlatform','contentStore']) $(id).disabled = false;
      if (page === 'content') renderContent();
      $('contextSaveStatus').textContent = '已与工作台同步';
    }
  }
  function selectProduct(productId, target = '/content') {
    if (!workspace.products.some(product => product.id === productId)) return;
    const query = new URLSearchParams({product:productId,platform:selectedPlatform()});
    return saveContext({productId}, {navigateTo:target + '?' + query});
  }
  function renderProducts() {
    const term = $('productSearch').value.trim().toLowerCase(), platform = $('productPlatformFilter').value;
    const products = workspace.products.filter(product => (!term || (product.name + ' ' + (product.description || '')).toLowerCase().includes(term)) && (platform === 'all' || (product.versions || []).some(version => version.platform === platform)));
    $('productCount').textContent = products.length === workspace.products.length ? `${products.length} 个商品` : `${products.length} / ${workspace.products.length} 个商品`;
    if (!products.length) {
      const filtered = workspace.products.length > 0;
      $('productGrid').innerHTML = `<div class="ws-empty"><span class="ws-empty-icon">${placeholderIcon}</span><h2>${filtered ? '没有匹配的商品' : '先添加一个商品'}</h2><p>${filtered ? '调整关键词或平台条件，查看其他商品。' : '导入桌面的商品图片文件夹，或新建商品并上传原图。之后的设计和成品都会留在同一份商品资料里。'}</p><div class="ws-actions">${filtered ? '<button class="ws-button" type="button" data-action="clear-product-filter">清除筛选</button>' : '<button class="ws-button" type="button" data-action="import">导入本地素材</button><button class="ws-button ws-primary" type="button" data-action="new-product">新建商品</button>'}</div></div>`;
      return;
    }
    $('productGrid').innerHTML = products.map(product => {
      const versions = product.versions || [], platforms = ['amazon','temu'].filter(target => versions.some(version => version.platform === target));
      const current = product.id === workspace.context.productId;
      const cover = product.images?.find(item => safeMedia(item.url)) || versions.flatMap(version => version.images || []).find(item => safeMedia(item.url));
      return `<article class="ws-product-card ${current ? 'is-selected' : ''}"><div class="ws-product-cover">${image(cover, '', product.name) || `<div class="ws-cover-empty">${placeholderIcon}<span>尚未添加原图</span></div>`}${current ? '<span class="ws-badge is-current">当前商品</span>' : ''}</div><div class="ws-product-body"><h2>${escape(product.name || '未命名商品')}</h2><p class="ws-product-description">${escape(product.description || '添加商品尺寸、材质和卖点，让各平台的制作使用同一份资料。')}</p><div class="ws-product-meta">${platforms.map(target => `<span class="ws-badge">${target === 'amazon' ? 'Amazon' : 'Temu'} ${versions.some(version => version.platform === target && version.images?.length && versionReady(version)) ? '成品' : '制作中'}</span>`).join('')}<span>${product.images?.length || 0} 张原图</span></div><div class="ws-card-actions"><button type="button" class="ws-button ws-primary ws-compact" data-action="open-content" data-product="${escape(product.id)}">进入制作</button><button type="button" class="ws-button ws-compact" data-action="edit-product" data-product="${escape(product.id)}">编辑资料</button></div></div></article>`;
    }).join('');
  }
  function options(element, items, value) {
    const html = items.map(item => `<option value="${escape(item.value)}">${escape(item.label)}</option>`).join('');
    if (element.innerHTML !== html) element.innerHTML = html;
    element.value = value;
  }
  function renderContent() {
    if (contextSaving) return;
    const product = selectedProduct(), platform = selectedPlatform(), stores = workspace.stores.filter(store => store.platform === platform);
    options($('contentProduct'), [{value:'',label:workspace.products.length ? '请选择商品' : '请先在商品库添加商品'},...workspace.products.map(product => ({value:product.id,label:product.name || '未命名商品'}))], product?.id || '');
    $('contentPlatform').value = platform;
    options($('contentStore'), [{value:'',label:stores.length ? '暂不关联店铺' : '该平台尚未绑定店铺'},...stores.map(store => ({value:store.key,label:`${store.name || store.expectedStore}${store.expectedSite ? ' · ' + store.expectedSite : ''}`}))], stores.some(store => store.key === workspace.context.storeKey) ? workspace.context.storeKey : '');
    const store = stores.find(store => store.key === workspace.context.storeKey);
    $('contentStoreHint').innerHTML = store ? `当前关联：${escape(store.name || store.expectedStore)}${store.expectedSite ? ' · ' + escape(store.expectedSite) : ''}。${store.executionSupported ? '完成图片后，可使用这个店铺进入统一上架流程。' : '可制作并保存图片；该平台的上架执行暂未接入。'} <a href="/settings" class="ws-text-link">管理连接</a>` : '未关联店铺也可以制作图片；上架前再选择已绑定的目标店铺。<a href="/settings" class="ws-text-link">管理连接</a>';
    $('contentProductSummary').innerHTML = product ? `${image(product.images?.[0], '', product.name)}<div><h3>${escape(product.name)}</h3><p>${escape(product.description || `${product.images?.length || 0} 张原图，可在单品设计中继续补充商品资料。`)}</p></div><button type="button" class="ws-button ws-compact" data-action="edit-product" data-product="${escape(product.id)}">编辑资料</button>` : '<div class="ws-selected-empty">可以直接开始单品设计，填写资料并上传原图；也可以选择商品库中已有的商品。 <a class="ws-text-link" href="/products">前往商品库 →</a></div>';
    $('singleDesignDescription').textContent = platform === 'amazon' ? '使用原有亚马逊主图、附图与 A+ 制作流程，按选定输出方案生成对应尺寸的图片。' : '使用 Temu 商品图制作流程，按 Temu 对应尺寸与图片规范生成成品。';
    $('designSpecification').innerHTML = (platform === 'amazon' ? ['主图 / 附图','标准 / 高级 A+','原有输出方案'] : ['1:1 商品图','1024 × 1024','≤ 2 MB']).map(item => `<span>${item}</span>`).join('');
    $('startSingleDesign').disabled = false;
    $('openImageEditor').disabled = !product;
    const batchQuery = new URLSearchParams(platform === 'amazon' ? {platform,view:'multisets'} : {mode:'images',platform});
    if (product) batchQuery.set(platform === 'amazon' ? 'product' : 'workspaceProduct',product.id);
    $('openBatchDesign').href = (platform === 'amazon' ? '/design?' : '/listings?') + batchQuery;
    $('openBatchDesign').innerHTML = (platform === 'amazon' ? '进入多套裂变' : '进入图片裂变上架') + ' <span aria-hidden="true">→</span>';
    $('batchDesignDescription').textContent = platform === 'amazon' ? '进入亚马逊设计工作区的多套裂变功能，围绕同一商品制作不同方向的主图、附图和 A+。' : '进入上架中心的图片裂变模式，使用本地素材、商品母稿和已绑定店铺继续处理。';
    $('batchDesignNote').textContent = platform === 'amazon' ? '沿用原有多套制作方式，完成后可到上架中心核对并导出资料包。' : '原图裂变、成品图片和工作台已有图片共用同一上架入口。';
    renderVersions(product);
    $('contextSaveStatus').textContent = '已与工作台同步';
    const url = new URL(location.href);
    if (product) url.searchParams.set('product', product.id); else url.searchParams.delete('product');
    url.searchParams.set('platform',platform);
    history.replaceState(null,'',url.pathname + url.search);
  }
  function platformVersions(product, platform) { return (product?.versions || []).filter(version => version.platform === platform).slice().sort((a,b) => String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || ''))); }
  function currentVersion(product, platform) {
    const versions = platformVersions(product, platform), selection = versionSelection.get(product?.id + ':' + platform);
    return versions.find((version,index) => String(version.id || index) === selection) || versions[0];
  }
  function listingTarget(platform) { return workspace.stores.find(store => store.platform === platform && store.key === workspace.context.storeKey); }
  function renderVersions(product) {
    if (!product) { $('platformVersions').innerHTML = '<div class="ws-empty" style="grid-column:1/-1"><h3>选择商品后查看平台成品</h3><p>每个平台的版本会保留在同一个商品下。</p></div>'; return; }
    $('platformVersions').innerHTML = ['amazon','temu'].map(platform => {
      const versions = platformVersions(product, platform), version = currentVersion(product,platform), images = version?.images || [], store = listingTarget(platform);
      const canList = images.length > 0 && versionReady(version) && (platform === 'amazon' || !!store?.executionSupported);
      let hint = '';
      if (images.length && !versionReady(version)) hint = '本套图片尚未全部完成。请在任务记录中处理后，再将完整成品交给上架中心。';
      else if (images.length && platform === 'amazon') hint = '进入上架中心核对图片并导出资料包；Amazon 自动发布暂未接入。';
      else if (images.length && !canList) {
        const supported = workspace.stores.some(store => store.platform === platform && store.executionSupported);
        hint = supported ? '在上方切换到该平台，并选择已绑定的目标店铺后，可使用这些成品去上架。' : '请先在连接设置中绑定该平台的店铺与可用上架连接。';
      }
      return `<article class="ws-version-card"><div class="ws-panel-heading"><h3>${platformName(platform)}</h3><span class="ws-badge ${statusClass(version?.status)}">${version ? escape(status(version.status)) : '尚未制作'}</span></div>${versions.length > 1 ? `<label class="ws-version-select">成品版本<select data-action="version-select" data-platform="${platform}">${versions.map((item,index) => `<option value="${escape(item.id || index)}" ${item === version ? 'selected' : ''}>${escape(date(item.createdAt || item.updatedAt))} · ${item.images?.length || 0} 张图片</option>`).join('')}</select></label>` : ''}${images.length ? `<div class="ws-version-thumbs">${images.slice(0,5).map(item => image(item)).join('')}</div><p>${images.length} 张图片${versions.length > 1 ? ` · 共 ${versions.length} 个版本` : ''}</p><div class="ws-card-actions"><button type="button" class="ws-button ws-compact" data-action="preview-version" data-platform="${platform}">查看图片</button><button type="button" class="ws-button ws-primary ws-compact" data-action="list-version" data-platform="${platform}" ${canList ? '' : 'disabled'}>${platform === 'amazon' ? '核对并导出' : '使用成品去上架'}</button></div>${hint ? `<p class="ws-unavailable">${hint}</p>` : `<p class="ws-unavailable">目标：${escape(store.name || store.expectedStore)}${store.expectedSite ? ' · ' + escape(store.expectedSite) : ''}</p>`}` : `<p>${version ? '当前版本还没有已完成的图片，可在任务记录中查看制作进度。' : '开始单品设计后，对应平台的成品会保存在这里。'}</p><div class="ws-version-count">${version ? '状态与原任务同步更新' : '商品原图与资料可直接共用'}</div><button type="button" class="ws-button ws-compact" data-action="design-platform" data-platform="${platform}">前往${platform === 'amazon' ? ' Amazon' : ' Temu'} 单品设计</button>`}</article>`;
    }).join('');
  }
  function renderTasks() {
    const term = $('taskSearch').value.trim().toLowerCase(), group = $('taskStatusFilter').value, platform = $('taskPlatformFilter').value;
    const records = workspace.tasks.filter(task => {
      const product = workspace.products.find(product => product.id === task.productId);
      return (!term || [task.title,task.type,product?.name].join(' ').toLowerCase().includes(term)) && (platform === 'all' || task.platform === platform) && (group === 'all' || (group === 'active' ? activeStatuses : group === 'complete' ? completeStatuses : attentionStatuses).has(task.status));
    });
    $('taskCount').textContent = records.length === workspace.tasks.length ? `${records.length} 条记录` : `${records.length} / ${workspace.tasks.length} 条记录`;
    $('taskRows').innerHTML = records.map(task => {
      const product = workspace.products.find(product => product.id === task.productId), link = safeLink(task.url);
      return `<tr><td><strong>${escape(task.title || '工作台任务')}</strong><small>${escape(task.type || '工作台任务')}${product ? ' · ' + escape(product.name) : ''}</small></td><td>${platformName(task.platform)}</td><td><span class="ws-badge ${statusClass(task.status)}">${escape(status(task.status))}</span></td><td class="ws-task-time">${escape(date(task.createdAt))}</td><td>${link ? `<a class="ws-text-link" href="${escape(link)}">查看任务 →</a>` : '<span class="ws-muted">暂无详情入口</span>'}</td></tr>`;
    }).join('');
    $('taskEmpty').hidden = records.length > 0;
    $('taskEmpty').innerHTML = workspace.tasks.length ? '<h3>没有符合条件的任务</h3><p>调整搜索或筛选条件，查看其他记录。</p>' : '<h3>还没有任务记录</h3><p>开始制作、选品或上架后，进度和结果会集中显示在这里。</p><a class="ws-button" href="/content">前往内容制作</a>';
  }

  function dialogError(id, error) { $(id).textContent = error || ''; $(id).hidden = !error; }
  function openEditor(id) {
    const product = workspace?.products.find(item => item.id === id);
    editor = {id:product?.id || '',images:(product?.images || []).map(item => ({...item}))};
    $('productDialogTitle').textContent = product ? '编辑商品资料' : '新建商品';
    $('editProductName').value = product?.name || ''; $('editProductDescription').value = product?.description || ''; $('productImageFiles').value = '';
    dialogError('productFormError',''); renderEditorImages(); $('productDialog').showModal();
  }
  function renderEditorImages() {
    $('editProductImages').innerHTML = editor.images.length ? editor.images.map((item,index) => `<div class="ws-edit-image">${image(item, '', index === 0 ? '产品主体图' : '商品参考图')}<span>${escape(item.filename || (index === 0 ? '产品主体图' : `参考图 ${index + 1}`))}</span><button type="button" data-action="remove-image" data-index="${index}" aria-label="移除第 ${index + 1} 张图片">×</button></div>`).join('') : '<div class="ws-images-empty">可添加商品原图，也可以稍后在单品设计中上传。</div>';
  }
  function closeDialog(id) { if (busyDialog !== id) $(id)?.close(); }
  function setDialogBusy(id, busy, label) {
    busyDialog = busy ? id : '';
    for (const control of $(id).querySelectorAll('button,input,textarea')) control.disabled = busy;
    const button = id === 'productDialog' ? $('saveProduct') : $('importProducts');
    button.textContent = busy ? label : id === 'productDialog' ? '保存商品' : '读取并导入';
  }
  async function saveProduct(event) {
    event.preventDefault(); if (!editor || busyDialog) return;
    const name = $('editProductName').value.trim(); if (!name) { dialogError('productFormError','请填写商品名称。'); $('editProductName').focus(); return; }
    dialogError('productFormError',''); setDialogBusy('productDialog',true,'正在保存…');
    try {
      for (const [index,item] of editor.images.entries()) {
        if (!item.file) continue;
        $('saveProduct').textContent = `上传图片 ${index + 1}/${editor.images.length}…`;
        const uploaded = await api('/api/media/up', item.file, true);
        if (!uploaded.url) throw new Error('图片上传未返回地址，请重试');
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        item.url = uploaded.url; delete item.file; delete item.previewUrl;
      }
      const payload = {name,description:$('editProductDescription').value.trim(),images:editor.images.map(({file,previewUrl,...item},index) => ({...item,category:item.category || (index ? '功能展示图' : '产品主体图')}))};
      const wasNew = !editor.id;
      const saved = await api('/api/workspace/products' + (editor.id ? '/' + encodeURIComponent(editor.id) : ''), payload);
      if (saved.id) editor.id = saved.id;
      await refresh({force:true});
      if (wasNew && saved.id) await saveContext({productId:saved.id});
      $('productDialog').close(); notice(wasNew ? '商品已加入商品库，可继续选择平台制作。' : '商品资料已保存，其他板块会同步使用这份资料。');
    } catch (error) { dialogError('productFormError',error.message); renderEditorImages(); }
    finally { setDialogBusy('productDialog',false); }
  }
  async function importProducts(event) {
    event.preventDefault(); if (busyDialog) return;
    dialogError('importFormError',''); setDialogBusy('importDialog',true,'正在读取素材…');
    try {
      const payload = {folder:$('importFolder').value.trim()}; if ($('importOutput').value.trim()) payload.outputParent = $('importOutput').value.trim();
      const result = await api('/api/workspace/import-folder',payload);
      await refresh({force:true});
      if (!workspace.context.productId && result.products?.[0]) await saveContext({productId:result.products[0].id});
      $('importDialog').close();
      const skipped = result.ignoredFolders?.length || 0;
      notice(`已导入 ${result.products?.length || 0} 个商品、${(result.products || []).reduce((total,product) => total + (product.images?.length || 0),0)} 张原图。${skipped ? `已跳过 ${skipped} 个生成结果或无原图目录。` : ''}可从商品库继续制作。`);
    } catch (error) { dialogError('importFormError',error.message); }
    finally { setDialogBusy('importDialog',false); }
  }
  async function browseFolder(target) {
    if (!window.desktop?.chooseFolder) { dialogError('importFormError','当前浏览器请直接粘贴本机文件夹完整路径；桌面应用支持浏览选择。'); $(target).focus(); return; }
    try { const result = await window.desktop.chooseFolder(); if (typeof result === 'string' && result) $(target).value = result; } catch (error) { dialogError('importFormError',error.message || '无法打开文件夹选择器'); }
  }
  function openPreview(platform) {
    const product = selectedProduct(), version = currentVersion(product,platform); if (!version?.images?.length) return;
    $('imagesDialogTitle').textContent = `${product.name} · ${platformName(platform)}`;
    $('imagesDialogDescription').textContent = `${version.images.length} 张成品图片。点击图片可查看原图；下载使用已保存的图片文件。`;
    $('versionImages').innerHTML = version.images.map((item,index) => {
      const source = safeMedia(item.originalImageUrl || item.url), name = item.filename || `${platform}-${index + 1}.png`;
      if (!source) return '';
      return `<figure class="ws-preview-image"><a href="${escape(source)}" target="_blank" rel="noopener" aria-label="查看第 ${index + 1} 张原图">${image(item,'',name)}</a><figcaption><span>${escape(item.slot || item.filename || `图片 ${index + 1}`)}</span><a href="${escape(source)}" download="${escape(name)}" target="_blank" rel="noopener">下载</a></figcaption></figure>`;
    }).join('');
    $('imagesDialog').showModal();
  }
  async function openDesign(platform = selectedPlatform(), view) {
    const product = selectedProduct();
    const query = new URLSearchParams({platform}); if (product) query.set('product',product.id); if (view) query.set('view',view);
    const patch = {productId:product?.id || '',platform};
    const store = workspace.stores.find(store => store.key === workspace.context.storeKey);
    if (store && store.platform !== platform) { patch.storeKey = ''; patch.erpKey = ''; }
    await saveContext(patch,{navigateTo:'/design?' + query});
  }
  async function listVersion(platform) {
    const product = selectedProduct(), version = currentVersion(product,platform), store = listingTarget(platform);
    if (!product || !version?.images?.length || !versionReady(version) || (platform !== 'amazon' && !store?.executionSupported)) return;
    const query = new URLSearchParams({mode:'images',platform,workspaceProduct:product.id,source:'generated'}); if (version.id) query.set('version',version.id);
    await saveContext({productId:product.id,platform,storeKey:store?.key || '',erpKey:store?.erpKey || ''},{navigateTo:'/listings?' + query});
  }

  document.addEventListener('click', event => {
    const close = event.target.closest('[data-close]'); if (close) { closeDialog(close.dataset.close); return; }
    const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'new-product') openEditor();
    else if (action === 'edit-product') openEditor(button.dataset.product);
    else if (action === 'import') { dialogError('importFormError',''); $('importDialog').showModal(); }
    else if (action === 'open-content') selectProduct(button.dataset.product);
    else if (action === 'clear-product-filter') { $('productSearch').value = ''; $('productPlatformFilter').value = 'all'; renderProducts(); }
    else if (action === 'remove-image' && editor && !busyDialog) { const [removed] = editor.images.splice(Number(button.dataset.index),1); if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl); renderEditorImages(); }
    else if (action === 'preview-version') openPreview(button.dataset.platform);
    else if (action === 'design-platform') openDesign(button.dataset.platform);
    else if (action === 'list-version') listVersion(button.dataset.platform);
  });
  document.addEventListener('change', event => { if (event.target.matches('[data-action="version-select"]')) { const product = selectedProduct(); if (product) { versionSelection.set(product.id + ':' + event.target.dataset.platform,event.target.value); renderVersions(product); } } });
  for (const id of ['productSearch','taskSearch']) $(id).addEventListener('input', () => workspace && (id === 'productSearch' ? renderProducts() : renderTasks()));
  $('productPlatformFilter').addEventListener('change', () => workspace && renderProducts());
  for (const id of ['taskStatusFilter','taskPlatformFilter']) $(id).addEventListener('change', () => workspace && renderTasks());
  $('contentProduct').addEventListener('change', () => saveContext({productId:$('contentProduct').value}));
  $('contentPlatform').addEventListener('change', () => { const platform = $('contentPlatform').value, current = workspace.stores.find(store => store.key === workspace.context.storeKey); saveContext({platform,...(current?.platform !== platform ? {storeKey:'',erpKey:''} : {})}); });
  $('contentStore').addEventListener('change', () => { const store = workspace.stores.find(store => store.key === $('contentStore').value); saveContext({storeKey:store?.key || '',erpKey:store?.erpKey || ''}); });
  $('startSingleDesign').addEventListener('click', () => openDesign());
  $('openImageEditor').addEventListener('click', () => openDesign(selectedPlatform(),'edit'));
  $('productForm').addEventListener('submit',saveProduct);
  $('importForm').addEventListener('submit',importProducts);
  $('browseImportFolder').addEventListener('click', () => browseFolder('importFolder'));
  $('browseImportOutput').addEventListener('click', () => browseFolder('importOutput'));
  $('productImageFiles').addEventListener('change', event => {
    if (!editor) return;
    const files = Array.from(event.target.files || []);
    if (editor.images.length + files.length > 8) { dialogError('productFormError','商品原图最多 8 张，请分开保存为不同商品。'); event.target.value = ''; return; }
    const invalid = files.find(file => !/\.(png|jpe?g|webp|avif)$/i.test(file.name) || file.size > 25 * 1024 * 1024 || file.size === 0);
    if (invalid) { dialogError('productFormError',`「${invalid.name}」不符合图片要求：支持 PNG、JPG、WebP、AVIF，每张不超过 25 MB。`); event.target.value = ''; return; }
    for (const file of files) { const previewUrl = URL.createObjectURL(file); editor.images.push({file,previewUrl,url:previewUrl,filename:file.name}); }
    dialogError('productFormError',''); renderEditorImages(); event.target.value = '';
  });
  for (const id of ['productDialog','importDialog','imagesDialog']) $(id).addEventListener('cancel', event => { if (busyDialog === id) event.preventDefault(); });
  $('productDialog').addEventListener('close', () => { for (const item of editor?.images || []) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); editor = null; });
  $('refreshTasks').addEventListener('click', async () => { $('refreshTasks').disabled = true; try { await refresh({force:true}); notice('任务记录已更新。'); } catch {} finally { $('refreshTasks').disabled = false; } });
  document.addEventListener('workspace:refresh', () => refresh({quiet:true}).catch(() => {}));
  window.addEventListener('focus', () => refresh({quiet:true}).catch(() => {}));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh({quiet:true}).catch(() => {}); });
  const timer = setInterval(() => { if (!document.hidden) refresh({quiet:true}).catch(() => {}); },15000);
  window.addEventListener('pagehide', () => clearInterval(timer),{once:true});

  async function initialize() {
    const initial = new URLSearchParams(location.search), requestedProduct = initial.get('product'), requestedPlatform = initial.get('platform');
    try {
      await refresh();
      if (page !== 'content') return;
      const patch = {};
      if (requestedProduct && workspace.products.some(product => product.id === requestedProduct) && requestedProduct !== workspace.context.productId) patch.productId = requestedProduct;
      if (['amazon','temu'].includes(requestedPlatform) && requestedPlatform !== workspace.context.platform) { patch.platform = requestedPlatform; const store = workspace.stores.find(store => store.key === workspace.context.storeKey); if (store?.platform !== requestedPlatform) { patch.storeKey = ''; patch.erpKey = ''; } }
      if (Object.keys(patch).length) await saveContext(patch);
      else if (requestedProduct && !workspace.products.some(product => product.id === requestedProduct)) notice('该商品已不在当前商品库中，请重新选择商品。',true);
    } catch {}
  }
  initialize();
})();
