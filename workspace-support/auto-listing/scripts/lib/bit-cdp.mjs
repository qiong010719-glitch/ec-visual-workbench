import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {chromeConnection} from './chrome-cdp.mjs';
import {isExistingChromeEndpoint,existingChromeHandle,existingChromePage} from './chrome-existing.mjs';

export const root = new URL('../../', import.meta.url);
export const config = await readFile(new URL('config/test-draft.json', root), 'utf8').then(JSON.parse).catch(()=>null);

function local(url) {
  const parsed = new URL(url);
  if (!['http:', 'ws:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new Error('Unexpected non-local browser endpoint');
  }
}
async function request(url, body) {
  local(url);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(25000),
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(`Local API HTTP ${response.status}`);
  return response.json();
}
export async function bit(path, body = {}, browserConfig = config) {
  if(!browserConfig)throw new Error('请先配置比特浏览器');
  const result = await request(browserConfig.localApi + path, body);
  if (result.success !== true) throw new Error(`BitBrowser ${path} failed`);
  return result.data;
}
async function existingProcessConnection(config) {
  if (process.platform !== 'win32' || !/^[a-f0-9]{32}$/.test(config.browserId)) return null;
  // BitBrowser's manager can lose its PID registry while its profile is still open.
  // Only inspect listeners owned by the exact configured profile's browser process.
  const script = `$ErrorActionPreference='Stop'; $matchesForTask=@(Get-CimInstance Win32_Process -Filter "Name = 'BitBrowser.exe'" | Where-Object { $_.CommandLine -like '*${config.browserId}*' -and $_.CommandLine -notmatch '--type=' }); if($matchesForTask.Count -ne 1){exit 0}; $taskBrowserPid=$matchesForTask[0].ProcessId; @(Get-NetTCPConnection -State Listen -OwningProcess $taskBrowserPid | Where-Object { $_.LocalAddress -eq '127.0.0.1' } | Select-Object -ExpandProperty LocalPort) | ConvertTo-Json -Compress`;
  let stdout;
  try { ({ stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 45000, windowsHide: true })); }
  catch { throw new Error('无法及时核对比特窗口进程，请检查比特窗口是否打开后重试连接'); }
  if (!stdout.trim()) return null;
  const parsed = JSON.parse(stdout); const ports = Array.isArray(parsed) ? parsed : [parsed];
  for (const port of ports) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    const http = `http://127.0.0.1:${port}`;
    try {
      const response = await fetch(http + '/json/version', { redirect: 'error', signal: AbortSignal.timeout(2000) });
      if (!response.ok) continue;
      const version = await response.json();
      local(version.webSocketDebuggerUrl);
      if (Number(new URL(version.webSocketDebuggerUrl).port) !== port) continue;
      return { http, ws: version.webSocketDebuggerUrl, source: 'verified-profile-process', targets: () => request(http + '/json/list') };
    } catch { /* This listener is not a CDP endpoint. */ }
  }
  return null;
}
export async function connection(configOverride = config) {
  const config=configOverride;
  if(!config)throw new Error('请先配置比特浏览器');
  if(config.type==='chrome')return chromeConnection(config);
  const call=(route,body={})=>bit(route,body,config);
  await call('/health');
  const list = await call('/browser/list', { page: 0, pageSize: 10, seq: config.browserSequence });
  if (list?.list?.filter(item => item.id === config.browserId).length !== 1) throw new Error('Profile mismatch');
  const pids = await call('/browser/pids', { ids: [config.browserId] });
  if (!pids?.[config.browserId]) {
    const running = await existingProcessConnection(config);
    if (running) return running;
    throw new Error('Required BitBrowser profile is closed or has no verified debugging endpoint');
  }
  const info = await call('/browser/open', { id: config.browserId });
  const http = info.http.startsWith('http:') ? info.http : `http://${info.http}`;
  local(http); local(info.ws);
  return { http, ws: info.ws, targets: () => request(http + '/json/list') };
}
export async function connect(url) {
  if(isExistingChromeEndpoint(url))return existingChromeHandle(url);
  local(url);
  const ws = new WebSocket(url);
  const pending = new Map();
  const handlers = new Map();
  let sequence = 0;
  ws.addEventListener('message', event => {
    let message; try { message = JSON.parse(event.data); } catch { return; }
    if (message.method) {
      for (const handler of handlers.get(message.method) ?? []) handler(message.params);
      return;
    }
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id); clearTimeout(task.timer);
    if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
  });
  ws.addEventListener('close', () => {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('CDP disconnected')); }
    pending.clear();
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP connection timed out')), 15000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out; inspect state before retrying`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return {
    send,
    on(method, handler) {
      if (!handlers.has(method)) handlers.set(method, new Set());
      handlers.get(method).add(handler);
      return () => handlers.get(method)?.delete(handler);
    },
    async evaluate(fn, arg) {
      const expression = `(${fn.toString()})(${JSON.stringify(arg) ?? 'undefined'})`;
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    },
    close: () => ws.close(),
  };
}
export async function pageById(info, targetId) {
  if(isExistingChromeEndpoint(info.ws))return existingChromePage(info.ws,targetId);
  const target = (await info.targets()).find(item => item.id === targetId && item.type === 'page');
  if (!target) throw new Error('Required page is closed');
  return connect(target.webSocketDebuggerUrl);
}
export async function poll(fn, { timeout = 20000, interval = 500, label } = {}) {
  const started = Date.now();
  const deadline = Date.now() + timeout;
  while (true) {
    const value = await fn();
    if (value) return value;
    if (Date.now() >= deadline) {
      const error = new Error(label ? `等待「${label}」超时（${Math.round((Date.now()-started)/1000)} 秒），已停止，请核对当前页面。` : 'Expected page state was not observed; inspect before retrying');
      Object.assign(error, {code:'ERP_WAIT_TIMEOUT', waitLabel:label, waitMs:Date.now()-started});
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}
