/*
 * Fluid backgrounds for the commerce cockpit. Apache-2.0 shader adaptation.
 * Copyright 2026 csuyincs-creator (清晨方白晓), original fluidglass-ui shaders.
 * Source revision: 91f54e49a804ddb325503c7f8979b02a58e9aaa0.
 * Local lifecycle, rendering and palette adaptation: 2026-11-21.
 * License and change notice: /vendor/fluidglass/LICENSE and /vendor/fluidglass/NOTICE.
 */
(() => {
  'use strict';
  if (window.CockpitFluid) return;

  const VERTEX = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main(){ v_uv=a_position*.5+.5; gl_Position=vec4(a_position,0.0,1.0); }
  `;
  const FRAGMENT = `
    precision mediump float;
    varying vec2 v_uv;
    uniform vec2 u_resolution, u_mouse, u_mouseVelocity;
    uniform float u_mouseMix, u_time, u_speed, u_intensity, u_pointer, u_seed, u_surfaceOpacity;
    uniform vec3 u_colorA, u_colorB, u_colorC;
    float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
    float noise(vec2 p){
      vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x),f.y);
    }
    float fbm(vec2 p){
      float value=0.0,amp=.53;mat2 rot=mat2(.80,-.60,.60,.80);
      for(int i=0;i<5;i++){value+=amp*noise(p);p=rot*p*2.02+vec2(17.13,9.27);amp*=.49;}
      return value;
    }
    float softBlob(vec2 p,vec2 center,float radius,float softness){return 1.0-smoothstep(radius-softness,radius+softness,length(p-center));}
    void main(){
      vec2 uv=v_uv;float aspect=u_resolution.x/max(1.0,u_resolution.y);
      vec2 p=(uv-.5)*vec2(aspect,1.0),mouse=(u_mouse-.5)*vec2(aspect,1.0),delta=p-mouse;
      float dist=length(delta),mouseField=exp(-dist*dist*7.2)*u_mouseMix*u_pointer;
      vec2 normal=delta/max(dist,.035),tangent=vec2(-normal.y,normal.x);
      p+=normal*mouseField*.115+tangent*mouseField*(u_mouseVelocity.x-u_mouseVelocity.y)*.045;
      float t=u_time*u_speed;vec2 seedVec=vec2(u_seed*1.713,u_seed*.937);
      float w1=fbm(p*1.22+seedVec+vec2(t*.075,-t*.052));
      float w2=fbm(p*1.54-seedVec*.37+vec2(-t*.057,t*.064)+w1*.82);
      vec2 q=p+(vec2(w1,w2)-.5)*(.58*u_intensity);
      float broad=fbm(q*1.12+vec2(t*.041,-t*.033)),detail=fbm(q*2.18+vec2(-t*.083,t*.057)+broad*.95);
      float ribbon=.5+.5*sin(q.x*3.15+q.y*.76+detail*5.0+t*.25+u_seed);
      float colorMix=smoothstep(.16,.88,broad*.61+ribbon*.39);
      vec3 fluid=mix(u_colorA,u_colorB,colorMix);
      float shadow=smoothstep(.43,.84,detail*.69+(.5+.5*sin(q.y*4.2-q.x*.8-t*.17))*.31);
      fluid=mix(fluid,u_colorC,shadow*.74);
      float plume1=softBlob(p,vec2(aspect*.23+.12*sin(t*.08+u_seed),.16*cos(t*.11+u_seed)),.52,.38);
      float plume2=softBlob(p,vec2(aspect*.39+.10*cos(t*.07-u_seed),-.24+.11*sin(t*.09)),.43,.34);
      float haze=clamp(plume1*.72+plume2*.58,0.0,1.0);
      float reveal=smoothstep(.055,.735,uv.x+(.5-broad)*.27+.070*sin(uv.y*4.0+t*.12));
      reveal*=mix(.70,1.0,haze);reveal=clamp(reveal*u_intensity,0.0,1.0);
      float spec=pow(clamp(1.0-abs(detail-.52)*2.0,0.0,1.0),5.0)*reveal;
      float caustic=pow(clamp(.52+.48*sin((q.x-q.y)*5.2+detail*7.0-t*.18),0.0,1.0),7.0)*reveal;
      vec3 cyanGlow=mix(fluid,vec3(.34,1.0,.90),spec*.18+caustic*.09);
      cyanGlow*=.78+.25*haze;cyanGlow=mix(cyanGlow,cyanGlow*.70,u_surfaceOpacity*.34);
      float filament=smoothstep(.48,.86,detail)*reveal;
      float density=clamp(reveal*(.36+.48*haze)+filament*.22+mouseField*.28,0.0,1.0);
      float alpha=clamp(.035*haze+density*(.24+.50*u_intensity)+spec*.08+u_surfaceOpacity*density*.14,0.0,.92);
      float edgeFade=1.0-smoothstep(.70,1.08,length((uv-.5)*vec2(1.0,.92)));
      alpha*=edgeFade;cyanGlow=pow(max(cyanGlow,0.0),vec3(.94));
      gl_FragColor=vec4(cyanGlow,alpha);
    }
  `;
  const PALETTES = {
    cyan: ['#19cdbc','#3fc7ec','#134b59'],
    pink: ['#ec76b6','#eda27b','#6e4093'],
    blue: ['#5279e5','#689acb','#242d65'],
    chrome: ['#c8e4df','#91a6ae','#334650']
  };
  const VARIANTS = [
    {seed:1.7,speed:.74,intensity:1.02}, {seed:4.9,speed:.63,intensity:1.08},
    {seed:8.4,speed:.57,intensity:.98}, {seed:12.1,speed:.68,intensity:1.05}
  ];
  const instances = new Map();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const options = {motion:true,material:true};
  const uniforms = ['resolution','mouse','mouseVelocity','mouseMix','time','speed','intensity','pointer','seed','surfaceOpacity','colorA','colorB','colorC'];
  const rgb = hex => [1,3,5].map(index => parseInt(hex.slice(index,index+2),16)/255);
  let raf=0,lastFrame=0,clock=0,resizeObserver=null,intersectionObserver=null,listening=false,lifecycle=false,root=document;
  try {
    const saved=JSON.parse(localStorage.getItem('commerce-cockpit-appearance')||'null');
    for(const key of ['motion','material'])if(typeof saved?.[key]==='boolean')options[key]=saved[key];
  } catch (_) { /* Storage is optional; static CSS remains the fallback. */ }

  function release(item) {
    const gl=item.gl;
    if(gl&&!gl.isContextLost()){
      if(item.buffer)gl.deleteBuffer(item.buffer);
      if(item.program)gl.deleteProgram(item.program);
      for(const shader of item.shaders||[])gl.deleteShader(shader);
    }
    item.program=null;item.buffer=null;item.shaders=[];item.ready=false;
  }
  function fallback(item,reason='fallback') {
    release(item);item.failed=true;item.canvas.dataset.fluidState=reason;item.canvas.style.opacity='0';
  }
  function compile(gl,type,source) {
    const shader=gl.createShader(type);
    if(!shader)throw new Error('Shader unavailable');
    gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){gl.deleteShader(shader);throw new Error('Shader compilation failed');}
    return shader;
  }
  function prepare(item) {
    if(item.ready||item.failed||item.lost||!options.material)return;
    try {
      const gl=item.gl||(item.gl=item.canvas.getContext('webgl',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:false,preserveDrawingBuffer:false,powerPreference:'low-power'}));
      if(!gl)throw new Error('WebGL unavailable');
      const precision=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT);
      item.shaders=[compile(gl,gl.VERTEX_SHADER,VERTEX)];
      item.shaders.push(compile(gl,gl.FRAGMENT_SHADER,precision?.precision?FRAGMENT.replace('precision mediump float','precision highp float'):FRAGMENT));
      item.program=gl.createProgram();if(!item.program)throw new Error('Program unavailable');
      for(const shader of item.shaders)gl.attachShader(item.program,shader);
      gl.linkProgram(item.program);if(!gl.getProgramParameter(item.program,gl.LINK_STATUS))throw new Error('Shader linking failed');
      gl.useProgram(item.program);item.buffer=gl.createBuffer();if(!item.buffer)throw new Error('Buffer unavailable');
      gl.bindBuffer(gl.ARRAY_BUFFER,item.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      const position=gl.getAttribLocation(item.program,'a_position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      item.uniform=Object.fromEntries(uniforms.map(name=>[name,gl.getUniformLocation(item.program,'u_'+name)]));
      gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.clearColor(0,0,0,0);
      item.ready=true;item.canvas.dataset.fluidState='ready';item.canvas.style.opacity='1';
    } catch (_) { fallback(item); }
  }
  function size(item) {
    const bounds=item.canvas.getBoundingClientRect(),ratio=Math.min(window.devicePixelRatio||1,1.5);
    item.width=Math.max(1,Math.round(bounds.width*ratio));item.height=Math.max(1,Math.round(bounds.height*ratio));
    item.sized=bounds.width>0&&bounds.height>0;
    if(item.canvas.width!==item.width)item.canvas.width=item.width;
    if(item.canvas.height!==item.height)item.canvas.height=item.height;
  }
  function draw(item) {
    if(!item.ready||item.lost||!item.visible||!item.sized||!options.material||document.hidden)return;
    try {
      const gl=item.gl,u=item.uniform,palette=PALETTES[item.canvas.dataset.palette]||PALETTES.cyan;
      gl.viewport(0,0,item.width,item.height);gl.useProgram(item.program);
      gl.uniform2f(u.resolution,item.width,item.height);gl.uniform2f(u.mouse,item.x,item.y);
      gl.uniform2f(u.mouseVelocity,item.vx,item.vy);gl.uniform1f(u.mouseMix,reducedMotion.matches?0:item.mix);
      gl.uniform1f(u.time,clock+16);gl.uniform1f(u.speed,item.variant.speed);gl.uniform1f(u.intensity,item.variant.intensity);
      gl.uniform1f(u.pointer,.8);gl.uniform1f(u.seed,item.variant.seed);gl.uniform1f(u.surfaceOpacity,.08);
      gl.uniform3fv(u.colorA,rgb(palette[0]));gl.uniform3fv(u.colorB,rgb(palette[1]));gl.uniform3fv(u.colorC,rgb(palette[2]));
      gl.drawArrays(gl.TRIANGLES,0,6);item.vx*=.84;item.vy*=.84;if(!item.hover)item.mix*=.88;
    } catch (_) { fallback(item); }
  }
  const animate=()=>options.material&&options.motion&&!reducedMotion.matches&&!document.hidden&&Array.from(instances.values()).some(item=>item.ready&&item.visible&&item.sized&&!item.lost);
  function frame(timestamp) {
    raf=0;if(!animate()){lastFrame=0;return;}
    if(!lastFrame||timestamp-lastFrame>=1000/30){
      clock+=lastFrame?Math.min(.1,(timestamp-lastFrame)/1000):0;lastFrame=timestamp;
      for(const item of instances.values())draw(item);
    }
    raf=requestAnimationFrame(frame);
  }
  function syncLoop() {
    if(animate()){if(!raf){lastFrame=0;raf=requestAnimationFrame(frame);}}
    else{if(raf)cancelAnimationFrame(raf);raf=0;lastFrame=0;}
  }
  function refresh() {
    for(const item of instances.values()){
      if(options.material){prepare(item);size(item);if(item.ready){item.canvas.style.opacity='1';item.canvas.dataset.fluidState='ready';}draw(item);}
      else{item.canvas.style.opacity='0';item.canvas.dataset.fluidState='disabled';}
    }
    syncLoop();
  }
  function onAppearance(event){configure(event.detail||{});}
  function listen() {
    if(listening)return;listening=true;
    document.addEventListener('visibilitychange',refresh);document.addEventListener('cockpit:appearance-changed',onAppearance);
    reducedMotion.addEventListener('change',refresh);
    if(window.ResizeObserver)resizeObserver=new ResizeObserver(entries=>{
      for(const entry of entries){const item=instances.get(entry.target);if(item){size(item);draw(item);}}syncLoop();
    });
    else window.addEventListener('resize',refresh,{passive:true});
    if(window.IntersectionObserver)intersectionObserver=new IntersectionObserver(entries=>{
      for(const entry of entries){const item=instances.get(entry.target);if(item){item.visible=entry.isIntersecting;if(item.visible){size(item);draw(item);}}}syncLoop();
    },{threshold:0});
  }
  function mount(scope=document) {
    root=scope;listen();attachLifecycle();
    const canvases=Array.from(scope.querySelectorAll('.metric-card canvas.metric-fluid')).slice(0,4);
    const activeCanvases=new Set(canvases);
    for(const [canvas,item] of instances)if(!canvas.isConnected||!activeCanvases.has(canvas)){dispose(item);instances.delete(canvas);}
    for(const [index,canvas] of canvases.entries()){
      if(instances.has(canvas))continue;
      const item={canvas,variant:VARIANTS[index],visible:true,sized:false,ready:false,failed:false,lost:false,x:.7,y:.5,vx:0,vy:0,mix:0,hover:false,shaders:[]};
      item.host=canvas.closest('.metric-card')||canvas;
      item.move=event=>{
        if(!options.motion||reducedMotion.matches||!options.material)return;
        const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
        const x=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y=1-Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));
        item.vx=(x-item.x)*4;item.vy=(y-item.y)*4;item.x=x;item.y=y;item.hover=true;item.mix=1;
      };
      item.leave=()=>{item.hover=false;};
      item.contextLost=event=>{event.preventDefault();item.lost=true;item.ready=false;item.canvas.dataset.fluidState='fallback';item.canvas.style.opacity='0';syncLoop();};
      item.contextRestored=()=>{item.lost=false;item.failed=false;item.shaders=[];item.program=null;item.buffer=null;prepare(item);size(item);draw(item);syncLoop();};
      canvas.setAttribute('aria-hidden','true');canvas.style.pointerEvents='none';
      item.host.addEventListener('pointermove',item.move,{passive:true});item.host.addEventListener('pointerleave',item.leave,{passive:true});
      canvas.addEventListener('webglcontextlost',item.contextLost);canvas.addEventListener('webglcontextrestored',item.contextRestored);
      instances.set(canvas,item);resizeObserver?.observe(canvas);intersectionObserver?.observe(canvas);
    }
    refresh();return instances.size;
  }
  function configure(next={}) {
    for(const key of ['motion','material'])if(typeof next[key]==='boolean')options[key]=next[key];
    refresh();
  }
  function dispose(item) {
    resizeObserver?.unobserve(item.canvas);intersectionObserver?.unobserve(item.canvas);
    item.host.removeEventListener('pointermove',item.move);item.host.removeEventListener('pointerleave',item.leave);
    item.canvas.removeEventListener('webglcontextlost',item.contextLost);item.canvas.removeEventListener('webglcontextrestored',item.contextRestored);
    release(item);item.canvas.style.opacity='0';item.canvas.dataset.fluidState='fallback';
    // Keep the canvas context reusable for bfcache; all programs/buffers/shaders are released.
    item.gl=null;
  }
  function teardown() {
    if(raf)cancelAnimationFrame(raf);raf=0;lastFrame=0;
    for(const item of instances.values())dispose(item);instances.clear();
    resizeObserver?.disconnect();intersectionObserver?.disconnect();resizeObserver=null;intersectionObserver=null;
    document.removeEventListener('visibilitychange',refresh);document.removeEventListener('cockpit:appearance-changed',onAppearance);
    reducedMotion.removeEventListener('change',refresh);window.removeEventListener('resize',refresh);listening=false;
  }
  function onPageHide(){teardown();}
  function onPageShow(event){if(event.persisted)mount(root);}
  function attachLifecycle(){if(lifecycle)return;lifecycle=true;window.addEventListener('pagehide',onPageHide);window.addEventListener('pageshow',onPageShow);}
  function destroy(){teardown();window.removeEventListener('pagehide',onPageHide);window.removeEventListener('pageshow',onPageShow);document.removeEventListener('DOMContentLoaded',start);lifecycle=false;}
  function start(){mount(document);}
  window.CockpitFluid=Object.freeze({mount,configure,destroy});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
