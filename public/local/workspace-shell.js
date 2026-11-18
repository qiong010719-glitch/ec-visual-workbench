/* Navigation only: keep the existing business containers and action handlers intact. */
(() => {
  'use strict';
  const entries = [
    {id:'products',label:'商品库',url:'/products'},
    {id:'sourcing',label:'选品与采集',url:'/sourcing'},
    {id:'content',label:'内容制作',url:'/content'},
    {id:'listings',label:'上架中心',url:'/listings?mode=images'},
    {id:'tasks',label:'任务记录',url:'/tasks'},
    {id:'settings',label:'连接设置',url:'/settings'}
  ];
  function activeEntry() {
    const path = location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/products') return 'products';
    if (path === '/sourcing') return 'sourcing';
    if (path === '/listings' || path === '/listing' || path === '/temu/listings') return 'listings';
    if (path === '/tasks') return 'tasks';
    if (path === '/settings') return 'settings';
    return 'content';
  }
  function mount() {
    if (document.documentElement.classList.contains('workspace-shell-enabled')) return;
    document.documentElement.classList.add('workspace-shell-enabled');
    let header = document.querySelector('header.workbench-header');
    if (!header) { header = document.createElement('header'); document.body.prepend(header); }
    header.classList.add('workbench-header','workspace-shell');
    header.setAttribute('aria-label','跨境电商工作台导航');
    // The design page reserves space inside its own pane layout.
    if (!document.documentElement.classList.contains('temu-theme') && !document.querySelector('.purah-pad .main-content')) document.body.classList.add('has-workbench-header');
    const active = activeEntry();
    header.innerHTML = '<a class="workbench-brand" href="/products" aria-label="跨境电商工作台，前往商品库"><span class="workbench-logo" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/></svg></span><span class="ws-shell-brand-copy"><span>跨境电商工作台</span><span id="workspaceShellContext" class="ws-shell-context">商品与设置统一同步</span></span></a><nav class="workbench-nav" aria-label="工作台六个入口">' + entries.map(entry => `<a href="${entry.url}"${entry.id === active ? ' aria-current="page"' : ''}>${entry.label}</a>`).join('') + '</nav><button id="workspaceShellSync" class="ws-shell-sync" type="button" data-state="loading" title="刷新商品、当前选择与连接状态"><span class="ws-shell-sync-dot" aria-hidden="true"></span><span>同步中</span></button>';
    const context = document.getElementById('workspaceShellContext'), sync = document.getElementById('workspaceShellSync');
    let inFlight = null, epoch = 0, lastWorkspace = null;
    function showState(state) {
      if (!state || !Array.isArray(state.products)) return;
      lastWorkspace = state;
      const current = state.context || {}, pageDesign=window.WorkspaceDesignBoot;
      const pagePlatform=pageDesign?.platform||(window.WorkspacePageBoot?.page!=='settings'&&window.WorkspacePageBoot?.platform)||current.platform;
      const product = state.products.find(product => product.id === (pageDesign?pageDesign.productId:current.productId)), store = state.stores?.find(store => store.key === current.storeKey&&store.platform===pagePlatform);
      const platform = pagePlatform === 'temu' ? 'Temu' : pagePlatform === 'amazon' ? 'Amazon' : '';
      const details = [platform,product?.name || (store?.name || store?.expectedStore) || '请选择商品'].filter(Boolean);
      context.textContent = details.join(' · ');
      context.title = [platform,product?.name,store?.name || store?.expectedStore,store?.expectedSite].filter(Boolean).join(' · ');
      sync.dataset.state = 'ready'; sync.lastElementChild.textContent = '已同步';
      sync.title = '商品、平台和连接设置与整个工作台共用；点击刷新';
    }
    async function refresh() {
      if (inFlight) return inFlight;
      const started = epoch;
      sync.dataset.state = 'loading'; sync.lastElementChild.textContent = '同步中';
      inFlight = fetch('/api/workspace',{cache:'no-store'}).then(async response => {
        const result = await response.json(); if (!response.ok) throw new Error(result.error || '工作台连接失败');
        if (started === epoch) showState(result);
      }).catch(error => { if (started === epoch) { sync.dataset.state = 'error'; sync.lastElementChild.textContent = '重试同步'; sync.title = error.message; if (!lastWorkspace) context.textContent = '暂时无法读取共享资料'; } }).finally(() => { inFlight = null; });
      return inFlight;
    }
    document.addEventListener('workspace:changed', event => { if (event.detail?.workspace) { epoch++; showState(event.detail.workspace); } });
    sync.addEventListener('click', () => { document.dispatchEvent(new CustomEvent('workspace:refresh')); refresh(); });
    // Old business pages have no shared-view controller, so the shell refreshes their context.
    const isWorkspacePage = document.body.classList.contains('workspace-page');
    window.addEventListener('focus', () => { if (!isWorkspacePage) refresh(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !isWorkspacePage) refresh(); });
    const timer = setInterval(() => { if (!document.hidden && !isWorkspacePage) refresh(); },15000);
    window.addEventListener('pagehide', () => clearInterval(timer),{once:true});
    refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',mount,{once:true}); else mount();
})();
