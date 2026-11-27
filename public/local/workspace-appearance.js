/* Synchronous head bootstrap: theme and layout must be ready before the first paint. */
(() => {
  'use strict';
  const root = document.documentElement;
  root.classList.add('workspace-shell-enabled');
  let value;
  try { value = JSON.parse(localStorage.getItem('commerce-cockpit-appearance') || '{}'); } catch {}
  root.dataset.cockpitTheme = value?.theme === 'light' ? 'light' : 'dark';
  root.dataset.cockpitAccent = ['ocean','emerald','violet'].includes(value?.accent) ? value.accent : 'ocean';
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const entry = ({'/':'overview','/app':'overview','/cockpit.html':'overview','/products':'products','/workspace.html':'products','/sourcing':'sourcing','/sourcing.html':'sourcing','/sourcing/free':'sourcing','/free-sourcing.html':'sourcing','/sourcing/listing':'listings','/listing-workflow.html':'listings','/tasks':'tasks','/settings':'settings','/merchant.html':'settings','/listings':'listings','/listing':'listings','/temu/listings':'listings','/temu-listings.html':'listings','/platform-listings.html':'listings'})[path] || 'content';
  root.dataset.workspaceEntry = entry;
  // The observer runs while HTML is parsed, before painting the initial navigation.
  // Waiting for the closing header also covers streamed/incremental document parsing.
  function markCurrent() {
    const header = document.querySelector('[data-workspace-shell="glass"]');
    if (!header?.querySelector('#workspaceShellSync')) return false;
    for (const link of header.querySelectorAll('[data-workspace-entry]')) {
      const current = link.dataset.workspaceEntry === entry;
      if (current) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
      const dot = link.querySelector('.ws-shell-active-dot'); if (dot) dot.hidden = !current;
    }
    return true;
  }
  if (!markCurrent()) {
    const observer = new MutationObserver(() => { if (markCurrent()) observer.disconnect(); });
    observer.observe(root,{childList:true,subtree:true});
    document.addEventListener('DOMContentLoaded',() => {markCurrent();observer.disconnect();},{once:true});
  }
})();
