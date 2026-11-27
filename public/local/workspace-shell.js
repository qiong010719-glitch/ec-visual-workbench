/* Commerce glass shell. Business containers, handlers and shared state stay intact. */
(() => {
  'use strict';
  const appearanceKey = 'commerce-cockpit-appearance';
  function applyAppearance(value) {
    const root = document.documentElement;
    root.dataset.cockpitTheme = value?.theme === 'light' ? 'light' : 'dark';
    root.dataset.cockpitAccent = ['ocean','emerald','violet'].includes(value?.accent) ? value.accent : 'ocean';
  }
  try { applyAppearance(JSON.parse(localStorage.getItem(appearanceKey) || '{}')); } catch (_) { applyAppearance({}); }
  window.addEventListener('storage', event => { if (event.key === appearanceKey) { try { applyAppearance(JSON.parse(event.newValue || '{}')); } catch (_) {} } });
  const icons = {
    overview:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M14 17.5h7m-3.5-3.5v7"/>',
    products:'<path d="m12 3 9 5-9 5-9-5Zm-9 5v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5"/>',
    sourcing:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5m-13-10h5m-2.5-2.5v5"/>',
    content:'<path d="m13 3 1.8 5.2L20 10l-5.2 1.8L13 17l-1.8-5.2L6 10l5.2-1.8ZM5 15l1 3 3 1-3 1-1 3-1-3-3-1 3-1ZM20 2v4m-2-2h4"/>',
    listings:'<path d="M5 11v9h14v-9M3 7l2-4h14l2 4v4a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0ZM9 20v-6h6v6"/>',
    tasks:'<path d="M8 5h12M8 12h12M8 19h12m-17-14 1 1 2-3m-3 9 1 1 2-3m-3 9 1 1 2-3"/>',
    settings:'<path d="M9 3h6l.7 2.4 2.2 1.3 2.4-.6 3 5-1.8 1.8v2.4l1.8 1.8-3 5-2.4-.6-2.2 1.3L15 25H9l-.7-2.4-2.2-1.3-2.4.6-3-5 1.8-1.8v-2.4L.7 10.9l3-5 2.4.6 2.2-1.3Z" transform="translate(1.7 0) scale(.78)"/><circle cx="11" cy="11" r="3"/>',
    appearance:'<path d="M4 7h16M4 17h16M8 4v6m8 4v6"/>',
    chevron:'<path d="m9 6 6 6-6 6"/>',
    globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>'
  };
  const icon = name => '<svg viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + '</svg>';
  const entries = [
    {id:'overview',label:'工作台总览',url:'/cockpit.html'},
    {id:'products',label:'商品库',url:'/products'},
    {id:'sourcing',label:'选品与采集',url:'/sourcing'},
    {id:'content',label:'内容制作',url:'/content'},
    {id:'listings',label:'上架中心',url:'/listings?mode=images'},
    {id:'tasks',label:'任务记录',url:'/tasks'},
    {id:'settings',label:'设置',url:'/settings'}
  ];
  function activeEntry() {
    const path = location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/cockpit.html') return 'overview';
    if (path === '/products') return 'products';
    if (path === '/sourcing/listing' || path === '/listing-workflow.html') return 'listings';
    if (path === '/sourcing' || path === '/sourcing/free' || path === '/free-sourcing.html') return 'sourcing';
    if (path === '/listings' || path === '/listing' || path === '/temu/listings') return 'listings';
    if (path === '/tasks') return 'tasks';
    if (path === '/settings') return 'settings';
    return 'content';
  }
  function mount() {
    document.documentElement.classList.add('workspace-shell-enabled');
    if (!document.querySelector('link[data-glass-business]')) {
      const styles = document.createElement('link'); styles.rel = 'stylesheet'; styles.href = '/local/workspace-glass-business.css'; styles.dataset.glassBusiness = ''; document.head.append(styles);
    }
    let header = document.querySelector('header.workbench-header');
    if (!header) { header = document.createElement('header'); document.body.prepend(header); }
    if (header.dataset.workspaceShellBound === 'true') return;
    header.dataset.workspaceShellBound = 'true';
    header.classList.add('workbench-header','workspace-shell');
    header.setAttribute('aria-label','跨境电商工作台导航');
    // The design page reserves space inside its own pane layout.
    if (!document.documentElement.classList.contains('temu-theme') && !document.querySelector('.purah-pad .main-content')) document.body.classList.add('has-workbench-header');
    const active = activeEntry();
    for (const link of header.querySelectorAll('[data-workspace-entry]')) {
      const current = link.dataset.workspaceEntry === active;
      if (current) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
      const dot = link.querySelector('.ws-shell-active-dot'); if (dot) dot.hidden = !current;
    }
    // Production HTML already contains the final navigation; only hydrate it.
    if (!header.querySelector('#workspaceShellMenu')) header.innerHTML = '<a class="workbench-brand" href="/cockpit.html" aria-label="跨境工作台，前往总览"><span class="workbench-logo" aria-hidden="true">' + icon('globe') + '</span><span class="ws-shell-brand-copy"><span>跨境工作台</span><span class="ws-shell-brand-subtitle">Commerce workspace</span></span></a><button id="workspaceMenuToggle" class="ws-shell-menu-toggle" type="button" aria-label="展开工作台导航" aria-expanded="false" aria-controls="workspaceShellMenu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button><div id="workspaceShellMenu" class="ws-shell-menu"><div class="ws-shell-nav-caption">工作空间</div><nav class="workbench-nav" aria-label="工作台导航">' + entries.map(entry => `<a href="${entry.url}"${entry.id === active ? ' aria-current="page"' : ''}>${icon(entry.id)}<span>${entry.label}</span>${entry.id === active ? '<i class="ws-shell-active-dot" aria-hidden="true"></i>' : ''}</a>`).join('') + '</nav><div class="ws-shell-bottom"><div class="ws-shell-platforms"><span class="ws-shell-platform amazon">a</span><span class="ws-shell-platform temu">T</span><span>多平台协作</span></div><button id="workspaceShellAppearance" class="ws-shell-appearance" type="button">' + icon('appearance') + '<span>外观与动效</span>' + icon('chevron') + '</button><div class="ws-shell-local"><span class="ws-shell-local-icon">' + icon('globe') + '</span><div><strong>本机工作区</strong><span id="workspaceShellContext" class="ws-shell-context">读取共享资料…</span></div></div><button id="workspaceShellSync" class="ws-shell-sync" type="button" data-state="loading" title="刷新商品、当前选择与连接状态"><span class="ws-shell-sync-dot" aria-hidden="true"></span><span>同步中</span></button></div></div>';
    const menuToggle = document.getElementById('workspaceMenuToggle');
    function closeMenu() { header.classList.remove('is-menu-open'); menuToggle.setAttribute('aria-expanded','false'); menuToggle.setAttribute('aria-label','展开工作台导航'); }
    menuToggle.addEventListener('click', () => {
      const opened = !header.classList.contains('is-menu-open'); header.classList.toggle('is-menu-open',opened); menuToggle.setAttribute('aria-expanded',String(opened)); menuToggle.setAttribute('aria-label',opened ? '收起工作台导航' : '展开工作台导航');
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
    document.addEventListener('click', event => { if (!header.contains(event.target)) closeMenu(); });
    document.getElementById('workspaceShellAppearance').addEventListener('click', () => {
      closeMenu();
      if (document.body.classList.contains('cockpit-page')) document.dispatchEvent(new Event('cockpit:appearance'));
      else location.assign('/cockpit.html#appearance');
    });
    const context = document.getElementById('workspaceShellContext'), sync = document.getElementById('workspaceShellSync');
    let inFlight = null, epoch = 0, lastWorkspace = null;
    function showState(state) {
      if (!state || !Array.isArray(state.products)) return;
      lastWorkspace = state;
      const current = state.context || {}, pageDesign=window.WorkspaceDesignBoot;
      const pagePlatform=document.body.classList.contains('free-sourcing-view')?'temu':document.body.classList.contains('fixed-listing-view')?(document.getElementById('templatePlatform')?.value||'temu'):pageDesign?.platform||(window.WorkspacePageBoot?.page!=='settings'&&window.WorkspacePageBoot?.platform)||current.platform;
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
