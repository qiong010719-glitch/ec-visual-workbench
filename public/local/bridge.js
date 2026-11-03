/* Local service adapters. No original accounts, databases, buckets or webhooks are contacted. */
(() => {
  const nativeFetch = window.fetch.bind(window);
  let modelStatus;
  const imageModelStatus = () => modelStatus ||= nativeFetch('/api/status').then(async response => {
    if (!response.ok) throw new Error('无法读取可用生图模型，请刷新页面后重试。');
    const status = await response.json();
    // Older running servers only honor their configured default. Never advertise Sunburst there.
    return {...status,imageModels:status.imageModels || [{id:status.model,label:status.model === 'gpt-image-2' ? 'GPT Image 2' : status.model}]};
  });
  const ready = nativeFetch('/api/session').then(async response => {
    if (!response.ok) throw new Error('本地服务连接失败');
    const session = await response.json();
    localStorage.setItem('hyrule_terminal_auth', 'GRANTED');
    return session;
  });
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/api/') && url.pathname !== '/api/session') {
      if(['/api/agent','/api/generate','/api/ultra_generate','/api/inpaint'].includes(url.pathname) && typeof init.body==='string') {
        let payload;
        try {payload=JSON.parse(init.body);}catch{}
        if(payload && typeof payload==='object') {
          if(url.pathname !== '/api/agent') {
            if(payload.model === undefined)payload.model=document.getElementById('modelChoice')?.value;
            const status=await imageModelStatus();
            if(!status.imageModels.some(option=>option.id===payload.model))return new Response(JSON.stringify({error:'当前服务不支持所选生图模型，请刷新页面并重新选择。请求尚未提交。'}),{status:409,headers:{'Content-Type':'application/json'}});
          }
          if(url.pathname !== '/api/inpaint' && !payload.mobile_reformat){
            payload.reference_ids ??= window.__designReferenceIds || [];
            payload.visual_style ??= window.getLocalVisualStyle?.(payload.generation_mode || payload.mode) || 'scene_advertising';
          }
          init={...init,body:JSON.stringify(payload)};
        }
      }
      const session = await ready;
      const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
      headers.set('X-Workbench-Token', session.token);
      return nativeFetch(input, {...init, headers});
    }
    return nativeFetch(input, init);
  };
  const authClient = {auth:{
    async getSession() {const s = await ready; return {data:{session:{access_token:s.token,user:s.user}}};},
    async signInWithPassword() {return this.getSession();},
    async signUp() {return {error:{message:'此版本为本机工作台，无需创建在线账户。'}};},
    async resend() {return {error:{message:'本地版本未连接邮件服务。'}};},
    async resetPasswordForEmail() {return {error:{message:'本地版本无需在线账户密码。'}};}
  }};
  async function upload(blob) {
    const response = await fetch('/api/media/up', {method:'POST',body:blob});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '上传失败');
    return data.url;
  }
  const subscriptions = new Map();
  function ref(key) {
    const reference = {
      on(_event, callback) {
        reference.off(); let stopped = false, timer, last = '';
        const poll = async () => {
          try {
            const response = await fetch('/api/tasks/' + key);
            if (!response.ok) throw new Error('无法读取任务状态');
            const data = await response.json(), serialized = JSON.stringify(data);
            if (!stopped && serialized !== last) {
              last = serialized;
              if (key.startsWith('agent_tasks/') && data?.status === 'completed' && data.result) {
                window.dispatchEvent(new CustomEvent('local-design-plan', {detail:{taskId:key.split('/')[1],...data}}));
              }
              if (data?.status === 'failed') window.dispatchEvent(new CustomEvent('local-task-failure',{detail:data}));
              callback({val:() => data});
              if(key.startsWith('hyrule_tasks/') && data)window.dispatchEvent(new CustomEvent('local-image-task-update',{detail:{...data,taskId:key.split('/')[1]}}));
            }
          } catch(error) {if (!stopped) console.warn('[local tasks]',error.message);}
          if (!stopped) timer = setTimeout(poll,1500);
        };
        subscriptions.set(key,() => {stopped = true; clearTimeout(timer);}); poll();
      },
      off() {subscriptions.get(key)?.(); subscriptions.delete(key);},
      async once() {const response = await fetch('/api/tasks/' + key);const value = await response.json();return {val:() => value};},
      child(child) {return ref(key + '/' + child);}
    };
    return reference;
  }
  function storageRef() {
    let uploaded;
    return {
      child() {return storageRef();},
      put(blob) {
        const promise = upload(blob).then(url => {uploaded = url;return {ref:{getDownloadURL:async () => url}};});
        promise.on = (_event, progress, error, complete) => {
          promise.then(() => {progress?.({bytesTransferred:blob.size,totalBytes:blob.size}); complete?.();},error);
        };
        return promise;
      },
      async getDownloadURL() {if (!uploaded) throw new Error('图片尚未上传');return uploaded;}
    };
  }
  window.firebase = {initializeApp() {}, database:() => ({ref}),storage:() => ({ref:storageRef})};
  window.LocalWorkbench = {authClient,ready,upload,imageModelStatus};
})();
