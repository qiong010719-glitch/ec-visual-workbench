/* Original scene implementation. Three.js r187 is vendored locally under MIT. */
(() => {
  'use strict';
  const stage = document.getElementById('orbitStage');
  const overlay = document.getElementById('cockpitIntro');
  const replay = document.getElementById('introReplay');
  if (!stage || window.CockpitScene) return;
  const cards = [...document.querySelectorAll('#moduleOrbit .module-card')];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let selected = Math.max(0,cards.findIndex(card=>card.getAttribute('aria-pressed')==='true'));
  let motion = document.body.dataset.motion !== 'off' && !reduce.matches;
  let accent = document.documentElement.dataset.cockpitAccent || 'ocean';
  let flat = stage.classList.contains('is-flat'), alive = true, inView = true;
  let renderer, scene, camera, composer, bloom, fxaa, outputPass, geometries = new Set(), materials = new Set(), textures = new Set();
  let frame = 0, introStart = 0, introActive = false, introTimer, safetyTimer, last = 0;
  let angle = -selected * Math.PI / 3, targetAngle = angle, dragOffset = 0, angularVelocity=0, dragging=false, hovered=-1, pointer = {x:0,y:0}, introPointer={x:0,y:0};
  let sceneTime=0, measuredFrames=0, frameDuration=0, qualityReduced=false, introVisual;
  let enteredAt = performance.now(), pendingPointer = null, hasMoved = false, environment;
  let previousFocus, introController;
  const objects = [], disposers = [];
  const on = (target,type,fn,options) => {target.addEventListener(type,fn,options);disposers.push(()=>target.removeEventListener(type,fn,options));};
  const geometry = value => (geometries.add(value),value);
  const material = value => (materials.add(value),value);
  const texture = value => (textures.add(value),value);
  const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));
  const status = document.createElement('span');
  status.className='scene-status';status.hidden=true;status.setAttribute('role','status');stage.append(status);
  const api = window.CockpitScene = {
    ready:false,
    select(index){
      selected=index;
      let wanted=-index*Math.PI/3;
      while(wanted-targetAngle>Math.PI)wanted-=Math.PI*2;
      while(wanted-targetAngle<-Math.PI)wanted+=Math.PI*2;
      targetAngle=wanted;if(!motion)angle=wanted;
      objects.forEach((item,i)=>{item.label.material.map=i===index?item.bright:item.muted;});
      requestFrame();
    },
    drag(dx){dragging=dx!==0;dragOffset=dx/Math.max(180,stage.clientWidth)*4.2;requestFrame();},
    releaseDrag(velocity){
      const predicted=targetAngle+dragOffset+clamp(velocity,-2,2)*.22;
      targetAngle=Math.round(predicted/(Math.PI/3))*Math.PI/3;dragOffset=0;dragging=false;
      angularVelocity=clamp(velocity,-2,2)*1.4;
      const index=((-Math.round(targetAngle/(Math.PI/3))%6)+6)%6;
      document.dispatchEvent(new CustomEvent('cockpit:select-module',{detail:{index}}));requestFrame();
    },
    destroy(){
      alive=false;cancelAnimationFrame(frame);clearTimeout(introTimer);clearTimeout(safetyTimer);
      observer.disconnect();resizeObserver.disconnect();introController?.abort();disposers.forEach(fn=>fn());
      document.getElementById('cockpitMain').inert=false;document.querySelector('.workbench-header').inert=false;
      overlay.hidden=true;composer?.passes.forEach(pass=>pass.dispose?.());composer?.dispose();renderer?.dispose();renderer?.domElement.remove();environment?.dispose();
      geometries.forEach(x=>x.dispose());materials.forEach(x=>x.dispose());textures.forEach(x=>x.dispose());
      api.ready=false;stage.dataset.scene='fallback';
    }
  };
  function restoreFallback(){
    api.ready=false;stage.dataset.scene='fallback';
    cards.forEach(card=>{card.style.width='';card.style.height='';});
    document.dispatchEvent(new CustomEvent('cockpit:select-module',{detail:{index:selected}}));
  }
  function requestFrame(){if(alive&&!frame&&!document.hidden)frame=requestAnimationFrame(tick);}
  const observer=new IntersectionObserver(entries=>{inView=entries[0].isIntersecting;requestFrame();});observer.observe(stage);
  const resizeObserver=new ResizeObserver(()=>{resize();requestFrame();});resizeObserver.observe(stage);
  function resize(){
    if(!renderer)return;
    const width=introActive?innerWidth:stage.clientWidth,height=introActive?innerHeight:stage.clientHeight;
    renderer.setSize(Math.max(width,1),Math.max(height,1),false);composer?.setSize(Math.max(width,1),Math.max(height,1));
    const dpr=renderer.getPixelRatio();fxaa?.uniforms.resolution.value.set(1/(width*dpr),1/(height*dpr));
    if(introVisual){introVisual.uniforms.pixelRatio.value=dpr;introVisual.uniforms.viewportHeight.value=height;}
    camera.aspect=width/Math.max(height,1);
    camera.position.set(0,introActive?.35:2.7,introActive?Math.max(8.6,5.7/camera.aspect):Math.max(10.2,15.2/Math.max(camera.aspect,.5)));
    camera.lookAt(0,introActive?.25:0,0);camera.updateProjectionMatrix();
  }
  function finishIntro(immediate=false){
    if(!introActive)return;
    introActive=false;last=0;measuredFrames=0;frameDuration=0;clearTimeout(safetyTimer);introController?.abort();
    introGroup.visible=false;world.visible=!flat;renderer.domElement.className='orbit-webgl';stage.prepend(renderer.domElement);scene.background=new THREE.Color(0x080f17);bloom.strength=.14;bloom.radius=.35;
    document.getElementById('cockpitMain').inert=false;document.querySelector('.workbench-header').inert=false;
    window.CockpitFluid?.configure({motion});
    overlay.classList.add('is-leaving');
    if(immediate)overlay.hidden=true;else introTimer=setTimeout(()=>{overlay.hidden=true;},680);
    document.body.classList.toggle('is-arriving',motion&&!immediate);
    enteredAt=performance.now();resize();requestFrame();
    if(overlay.contains(document.activeElement)) (previousFocus?.isConnected&&previousFocus!==document.body?previousFocus:replay).focus({preventScroll:true});
  }
  function startIntro(){
    if(!api.ready||!motion||reduce.matches){finishIntro(true);return;}
    clearTimeout(introTimer);clearTimeout(safetyTimer);introController?.abort();introController=new AbortController();
    previousFocus=document.activeElement;introActive=true;introStart=performance.now();overlay.dataset.phase='gather';world.visible=false;introGroup.visible=true;scene.background=new THREE.Color(0x04080e);bloom.strength=.85;bloom.radius=.72;
    overlay.classList.remove('is-leaving');overlay.hidden=false;document.body.classList.remove('is-arriving');
    renderer.domElement.className='';document.getElementById('introCanvas').append(renderer.domElement);
    document.getElementById('cockpitMain').inert=true;document.querySelector('.workbench-header').inert=true;
    window.CockpitFluid?.configure({motion:false});
    document.getElementById('introSkip').focus({preventScroll:true});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();finishIntro();}if(e.key==='Tab'){e.preventDefault();document.getElementById('introSkip').focus();}},{signal:introController.signal});
    safetyTimer=setTimeout(()=>finishIntro(true),10000);resize();requestFrame();
  }
  let THREE,world,introGroup,halo,raycaster,mouse;
  async function initialize(){
    try{
      THREE=await import('/vendor/three/three.module.js');
      const [{EffectComposer},{RenderPass},{UnrealBloomPass},{OutputPass},{ShaderPass},{FXAAShader}]=await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'),import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'),import('three/addons/postprocessing/OutputPass.js'),
        import('three/addons/postprocessing/ShaderPass.js'),import('three/addons/shaders/FXAAShader.js')]);
      if(!alive)return;
      renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'});
      renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.setClearColor(0x080f17,1);renderer.transmissionResolutionScale=.5;
      renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
      renderer.domElement.className='orbit-webgl';renderer.domElement.setAttribute('aria-hidden','true');stage.prepend(renderer.domElement);
      scene=new THREE.Scene();scene.background=new THREE.Color(0x080f17);camera=new THREE.PerspectiveCamera(35,1,.1,100);
      composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));
      bloom=new UnrealBloomPass(new THREE.Vector2(800,500),.14,.35,1.05);composer.addPass(bloom);
      outputPass=new OutputPass();composer.addPass(outputPass);fxaa=new ShaderPass(FXAAShader);composer.addPass(fxaa);
      world=new THREE.Group();scene.add(world);
      raycaster=new THREE.Raycaster();mouse=new THREE.Vector2();
      createEnvironment();createCards();createFloor();createIntro();
      world.add(new THREE.HemisphereLight(0xc9ddec,0x102330,1.1));
      const key=new THREE.DirectionalLight(0xe0f4ff,2.6);key.position.set(-3,5,5);world.add(key);
      const rim=new THREE.PointLight(0x9ac6f5,40,20);rim.position.set(4,2,-2);world.add(rim);
      const fill=new THREE.PointLight(0xd8cbb0,26,20);fill.position.set(-4,1,3);world.add(fill);
      api.ready=true;stage.dataset.scene='ready';stage.dataset.pipeline='physical-transmission+bloom+fxaa';api.select(selected);resize();renderFrame(performance.now());startIntro();requestFrame();
      on(renderer.domElement,'webglcontextlost',event=>{event.preventDefault();finishIntro(true);restoreFallback();replay.disabled=true;renderer.domElement.style.display='none';status.hidden=false;status.textContent='3D 渲染已暂停，可使用平面视图继续。';cancelAnimationFrame(frame);frame=0;});
    }catch(error){
      finishIntro(true);restoreFallback();composer?.passes.forEach(pass=>pass.dispose?.());composer?.dispose();renderer?.dispose();renderer?.domElement.remove();
      status.textContent='当前设备使用静态卡片视图。';replay.disabled=true;
      console.warn('Cockpit 3D unavailable; DOM navigation retained:',error.message);
    }
  }
  function createEnvironment(){
    // Linear floating-point studio lighting preserves highlight energy above 1.0.
    const width=512,height=256,data=new Float32Array(width*height*4);
    const lights=[[.17,.31,.025,.18,5.0,[.78,.91,1]],[.58,.19,.12,.025,3.8,[1,.94,.83]],[.85,.46,.018,.15,3.3,[.55,.77,1]]];
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const u=x/width,v=y/height,i=(y*width+x)*4,base=.012+.035*(1-v);
      data[i]=base*.7;data[i+1]=base*.88;data[i+2]=base;data[i+3]=1;
      for(const [cx,cy,sx,sy,power,color] of lights){const d=Math.exp(-Math.pow((u-cx)/sx,4)-Math.pow((v-cy)/sy,4))*power;for(let c=0;c<3;c++)data[i+c]+=d*color[c];}
    }
    const env=texture(new THREE.DataTexture(data,width,height,THREE.RGBAFormat,THREE.FloatType));env.mapping=THREE.EquirectangularReflectionMapping;env.needsUpdate=true;
    const pmrem=new THREE.PMREMGenerator(renderer);environment=pmrem.fromEquirectangular(env);scene.environment=environment.texture;pmrem.dispose();
  }
  function roundedShape(w,h,r){
    const s=new THREE.Shape(),x=-w/2,y=-h/2;s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;
  }
  function labelTexture(index,bright){
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=704;const c=canvas.getContext('2d');
    const title=cards[index].querySelector('.module-title').textContent,sub=cards[index].querySelector('.module-subtitle').textContent;
    c.strokeStyle=bright?'#c2fff0':'#b6d5e5';c.fillStyle=bright?'#d6fff5':'#c1d7e4';
    c.font='24px "Segoe UI",sans-serif';c.fillText(String(index+1).padStart(2,'0'),42,65);
    c.font='15px "Segoe UI",sans-serif';c.textAlign='right';c.fillText(['PRODUCT','DISCOVER','CREATE','LAUNCH','ACTIVITY','CONNECT'][index],468,62);c.textAlign='left';
    c.globalAlpha=.35;c.lineWidth=1;c.beginPath();c.moveTo(42,91);c.lineTo(470,91);c.stroke();c.globalAlpha=1;
    // The center is reserved for a lit, dimensional icon mesh above the glass.
    c.fillStyle=bright?'#effffb':'#dbe8f3';c.font='500 48px "Microsoft YaHei",sans-serif';c.fillText(title,42,548);
    c.fillStyle=bright?'#b9dadb':'#a8bdcc';c.font='25px "Microsoft YaHei",sans-serif';c.fillText(sub,42,593);
    c.globalAlpha=.4;c.fillRect(42,624,428,1);c.globalAlpha=1;c.font='18px "Segoe UI",sans-serif';c.fillText('WORKSPACE / '+String(index+1).padStart(2,'0'),42,661);c.font='30px sans-serif';c.fillText('↗',440,663);
    const map=texture(new THREE.CanvasTexture(canvas));map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());return map;
  }
  function createEmblem(index){
    const group=new THREE.Group();
    const silver=material(new THREE.MeshStandardMaterial({color:0xd9e7ef,metalness:.8,roughness:.19,envMapIntensity:1.8}));
    const ceramic=material(new THREE.MeshPhysicalMaterial({color:0xaed1dc,metalness:.18,roughness:.14,clearcoat:1,envMapIntensity:1.3}));
    const crystal=material(new THREE.MeshPhysicalMaterial({color:0xe6f7ff,roughness:.07,transmission:.9,thickness:.35,ior:1.46,envMapIntensity:1.4}));
    function add(geo,mat,x=0,y=0,z=0){const m=new THREE.Mesh(geometry(geo),mat);m.position.set(x,y,z);group.add(m);return m;}
    function plate(w,h,d,mat,x=0,y=0,z=0){const geo=new THREE.ExtrudeGeometry(roundedShape(w,h,.07),{depth:d,bevelEnabled:true,bevelSegments:3,bevelSize:.018,bevelThickness:.018,curveSegments:10});geo.translate(0,0,-d/2);return add(geo,mat,x,y,z);}
    if(index===0){
      const box=plate(.72,.72,.62,ceramic);box.rotation.set(.15,-.48,.06);
      const ribbon=add(new THREE.BoxGeometry(.065,.77,.65),silver);ribbon.rotation.copy(box.rotation);
    }else if(index===1){
      add(new THREE.TorusGeometry(.31,.056,12,56),silver,0,.08);
      add(new THREE.CylinderGeometry(.27,.27,.07,40),crystal,0,.08).rotation.x=Math.PI/2;
      add(new THREE.CapsuleGeometry(.052,.34,6,14),ceramic,.28,-.26).rotation.z=-.7;
    }else if(index===2){
      plate(.72,.61,.055,crystal,-.08,.1,-.09).rotation.z=-.16;
      plate(.72,.61,.06,ceramic,.07,-.07,.06).rotation.z=.12;
      const mountain=add(new THREE.ConeGeometry(.17,.25,3),silver,.02,-.09,.13);mountain.rotation.x=Math.PI/2;
      add(new THREE.SphereGeometry(.055,16,12),silver,.25,.08,.15);
    }else if(index===3){
      plate(.72,.59,.24,ceramic,0,-.11,0);
      add(new THREE.TorusGeometry(.22,.035,10,32,Math.PI),silver,0,.18,0);
      plate(.13,.13,.015,silver,0,-.1,.14).rotation.z=Math.PI/4;
    }else if(index===4){
      plate(.65,.86,.07,crystal);
      for(let i=0;i<3;i++){
        add(new THREE.BoxGeometry(.27,.035,.025),silver,.09,.23-i*.23,.07);
        const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(-.24,.23-i*.23,.07),new THREE.Vector3(-.19,.18-i*.23,.07),new THREE.Vector3(-.1,.3-i*.23,.07)]);
        add(new THREE.TubeGeometry(curve,8,.014,6,false),ceramic);
      }
    }else{
      for(let i=0;i<2;i++){
        add(new THREE.CapsuleGeometry(.025,.72,4,12),silver,0,.18-i*.36).rotation.z=Math.PI/2;
        add(new THREE.TorusGeometry(.105,.036,12,32),ceramic,i===0?-.16:.17,.18-i*.36,.07);
        add(new THREE.CylinderGeometry(.072,.072,.055,24),silver,i===0?-.16:.17,.18-i*.36,.07).rotation.x=Math.PI/2;
      }
    }
    return group;
  }
  function createCards(){
    const shape=roundedShape(2.26,3.06,.2);
    const slab=geometry(new THREE.ExtrudeGeometry(shape,{depth:.18,bevelEnabled:true,bevelSegments:5,steps:1,bevelSize:.045,bevelThickness:.045,curveSegments:18}));slab.translate(0,0,-.09);
    const face=geometry(new THREE.PlaneGeometry(2.12,2.92));
    const outlinePoints=shape.getPoints(100).map(p=>new THREE.Vector3(p.x,p.y,.137));outlinePoints.push(outlinePoints[0].clone());
    const outlineGeometry=geometry(new THREE.BufferGeometry().setFromPoints(outlinePoints));
    cards.forEach((card,index)=>{
      const group=new THREE.Group();group.userData.index=index;
      const glass=material(new THREE.MeshPhysicalMaterial({color:0xe7f0f5,metalness:0,roughness:.065,transmission:.98,thickness:.22,ior:1.46,clearcoat:.65,clearcoatRoughness:.06,envMapIntensity:1.1,attenuationColor:0xa7c7d9,attenuationDistance:1.2}));
      const body=new THREE.Mesh(slab,glass);body.userData.index=index;group.add(body);
      const edge=new THREE.Line(outlineGeometry,material(new THREE.LineBasicMaterial({color:0xaac4d6,transparent:true,opacity:.7})));group.add(edge);
      const backEdge=edge.clone();backEdge.position.z=-.27;backEdge.material=material(new THREE.LineBasicMaterial({color:0x8eabbc,transparent:true,opacity:.45}));group.add(backEdge);
      // A frosted inset supports text while the surrounding glass stays transmissive.
      const inset=new THREE.Mesh(geometry(new THREE.ShapeGeometry(roundedShape(2.07,.9,.1))),material(new THREE.MeshBasicMaterial({color:0x08131e,transparent:true,opacity:.88,depthWrite:false})));
      inset.position.set(0,-.99,.148);inset.renderOrder=4;group.add(inset);
      const bright=labelTexture(index,true),muted=labelTexture(index,false);
      const label=new THREE.Mesh(face,material(new THREE.MeshBasicMaterial({map:index===selected?bright:muted,transparent:true,depthWrite:false,toneMapped:false})));label.position.z=.155;label.renderOrder=6;group.add(label);
      const insetOutline=new THREE.Line(geometry(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.94,-.48,.15),new THREE.Vector3(.94,-.48,.15)])),material(new THREE.LineBasicMaterial({color:0xb6d7e5,transparent:true,opacity:.35})));group.add(insetOutline);
      const emblem=createEmblem(index);emblem.position.set(0,.35,.43);emblem.rotation.set(.1,.16,0);emblem.scale.setScalar(1.24);group.add(emblem);
      const highlight=new THREE.Mesh(geometry(new THREE.PlaneGeometry(.018,2.54)),material(new THREE.MeshBasicMaterial({color:new THREE.Color(1.2,1.6,1.8),transparent:true,opacity:.35,depthWrite:false})));highlight.position.set(-1.11,0,.14);group.add(highlight);
      world.add(group);objects.push({group,body,label,glass,edge,bright,muted,emblem,hover:0,focus:0,highlight,inset});
    });
  }
  function createFloor(){
    const podium=new THREE.Mesh(geometry(new THREE.CylinderGeometry(4,4.06,.06,120)),material(new THREE.MeshStandardMaterial({color:0x0b1721,metalness:.6,roughness:.34,envMapIntensity:.4})));podium.position.y=-1.72;world.add(podium);
    const ringMaterial=material(new THREE.MeshBasicMaterial({color:0x78b8c9,transparent:true,opacity:.16,side:THREE.DoubleSide,depthWrite:false}));
    [3.1,3.7,4.3].forEach((radius,i)=>{const ring=new THREE.Mesh(geometry(new THREE.RingGeometry(radius,radius+.008,160)),ringMaterial);ring.rotation.x=-Math.PI/2;ring.position.y=-1.63-i*.003;world.add(ring);});
    const glowCanvas=document.createElement('canvas');glowCanvas.width=128;glowCanvas.height=128;const c=glowCanvas.getContext('2d');const g=c.createRadialGradient(64,64,0,64,64,64);g.addColorStop(0,'#74e9ff55');g.addColorStop(.35,'#3f91ba22');g.addColorStop(1,'#244d7000');c.fillStyle=g;c.fillRect(0,0,128,128);
    halo=new THREE.Mesh(geometry(new THREE.PlaneGeometry(10,8)),material(new THREE.MeshBasicMaterial({map:texture(new THREE.CanvasTexture(glowCanvas)),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending})));halo.rotation.x=-Math.PI/2;halo.position.y=-1.65;world.add(halo);
    const points=[];for(let i=0;i<220;i++){const a=i*2.39996,r=2.5+(i%23)/5;points.push(Math.cos(a)*r,-1.6+(i%7)*.12,Math.sin(a)*r);}
    const geo=geometry(new THREE.BufferGeometry());geo.setAttribute('position',new THREE.Float32BufferAttribute(points,3));world.add(new THREE.Points(geo,material(new THREE.PointsMaterial({color:0x7ec8ec,size:.018,transparent:true,opacity:.45,depthWrite:false}))));
  }
  function createIntro(){
    introVisual=window.createCockpitAtmosphere(THREE,geometry,material);introGroup=introVisual.group;introGroup.visible=false;scene.add(introGroup);
  }
  function renderFrame(time){
    if(!renderer||!api.ready)return;
    const rawDt=last?(time-last)/1000:.016,dt=Math.min(.05,rawDt);last=time;
    if(motion)sceneTime+=dt;
    if(!motion){angle=targetAngle;angularVelocity=0;}
    else if(dragging){angle+=(targetAngle+dragOffset-angle)*(1-Math.exp(-dt*22));angularVelocity=0;}
    else{angularVelocity+=(targetAngle-angle)*85*dt;angularVelocity*=Math.exp(-dt*13);angle+=angularVelocity*dt;}
    if(introActive){
      const elapsed=(time-introStart)/1000;introVisual.update(elapsed,introPointer);
      overlay.dataset.phase=elapsed<1.7?'gather':elapsed<3.8?'orbit':'reveal';
      const dolly=clamp(elapsed/3.8,0,1),distance=Math.max(8.6,5.7/camera.aspect);
      camera.position.set(Math.sin(elapsed*.35)*.6+introPointer.x*.2,.45+introPointer.y*.12,distance*(1.1-dolly*.13));camera.lookAt(0,.35,0);
      if(elapsed>=5.15){finishIntro();return;}
    }else if(!flat){
      const arrival=motion?clamp((time-enteredAt)/1100,0,1):1;
      const introScale=.7+.3*(1-Math.pow(1-arrival,3));
      objects.forEach((item,index)=>{
        const theta=index*Math.PI/3+angle;
        const front=(Math.cos(theta)+1)/2;
        const ease=motion?1-Math.exp(-dt*8):1;item.hover+=((hovered===index?1:0)-item.hover)*ease;item.focus+=((index===selected?1:0)-item.focus)*ease;
        item.group.position.set(Math.sin(theta)*3.38*introScale,.07+(1-front)*1.0+item.focus*.16+item.hover*.12+Math.sin(sceneTime*.65+index)*.025*(motion?1:0)+(1-arrival)*.7,Math.cos(theta)*2.05+item.focus*.4);
        item.group.rotation.set(-.025+(motion?pointer.y:0)*item.hover*.13,-Math.sin(theta)*.85+(motion?pointer.x:0)*item.hover*.22,.018*Math.sin(theta));
        item.group.scale.setScalar((.72+front*.24+item.focus*.06)*introScale);
        item.emblem.rotation.y=.18+(motion?Math.sin(sceneTime*.5+index)*.12:0);
        item.glass.attenuationColor.set(index===selected?({ocean:0x9fd8dc,emerald:0xadd8be,violet:0xc0b6dc}[accent]||0x9fd8dc):0xb3c6db);
        item.glass.envMapIntensity=.9+item.focus*.45+item.hover*.2;
        item.edge.material.opacity=.4+item.focus*.45+item.hover*.1;
        item.highlight.material.opacity=.15+item.focus*.4;
        item.group.updateMatrixWorld();
        // Keep the keyboard target aligned to the visible mesh; pointer hits use raycasting.
        const center=item.group.position.clone().project(camera),top=new THREE.Vector3(0,1.55,0).applyMatrix4(item.group.matrixWorld).project(camera);
        const height=Math.abs(top.y-center.y)*stage.clientHeight*2,width=height*2.26/3.06;
        const card=cards[index];card.style.transform=`translate(${(center.x+1)*stage.clientWidth/2-width/2}px,${(1-center.y)*stage.clientHeight/2-height/2}px)`;card.style.width=width+'px';card.style.height=height+'px';
      });
    }
    composer.render(dt);
    if(motion&&rawDt>0&&rawDt<.5&&!introActive){
      measuredFrames++;frameDuration+=rawDt;
      if(measuredFrames===90){
        stage.dataset.fps=String(Math.round(measuredFrames/frameDuration));
        if(!qualityReduced&&frameDuration/measuredFrames>.036){qualityReduced=true;renderer.setPixelRatio(Math.min(renderer.getPixelRatio(),.85));composer.setPixelRatio(renderer.getPixelRatio());renderer.transmissionResolutionScale=.4;resize();stage.dataset.quality='balanced';}
        measuredFrames=0;frameDuration=0;
      }
    }
    stage.dataset.sceneFrames=String(renderer.info.render.frame);
  }
  function tick(time){
    frame=0;if(!alive||!api.ready||document.hidden)return;
    if(introActive||(!flat&&inView)){
      renderFrame(time);
      const unsettled=dragging||Math.abs(angle-targetAngle-dragOffset)>.001||Math.abs(angularVelocity)>.003||objects.some((item,index)=>Math.abs(item.hover-(hovered===index?1:0))>.002||Math.abs(item.focus-(selected===index?1:0))>.002);
      if(introActive||(motion&&(unsettled||time-enteredAt<1300)))requestFrame();else last=0;
    }
  }
  function hit(event){
    if(!api.ready||flat||introActive)return null;
    const rect=stage.getBoundingClientRect();mouse.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(mouse,camera);return raycaster.intersectObjects(objects.map(x=>x.body))[0]?.object.userData.index;
  }
  on(stage,'pointerdown',e=>{if(e.button===0&&!e.target.closest('.orbit-navigation')){pendingPointer={x:e.clientX,y:e.clientY};hasMoved=false;}});
  on(stage,'pointermove',e=>{
    if(pendingPointer&&Math.hypot(e.clientX-pendingPointer.x,e.clientY-pendingPointer.y)>9)hasMoved=true;
    const r=stage.getBoundingClientRect();pointer.x=(e.clientX-r.left)/r.width-.5;pointer.y=(e.clientY-r.top)/r.height-.5;
    if(!pendingPointer&&api.ready&&renderer){const index=hit(e);hovered=index==null?-1:index;renderer.domElement.style.cursor=hovered>=0?'pointer':'grab';}requestFrame();
  });
  on(stage,'pointerleave',()=>{pointer={x:0,y:0};hovered=-1;requestFrame();});
  on(stage,'pointercancel',()=>{pendingPointer=null;dragOffset=0;dragging=false;angularVelocity=0;requestFrame();});
  on(stage,'pointerup',e=>{
    if(!pendingPointer||hasMoved){pendingPointer=null;return;}pendingPointer=null;
    if(e.target.closest('.orbit-navigation'))return;const index=hit(e);if(index!==undefined&&index!==null)document.dispatchEvent(new CustomEvent('cockpit:select-module',{detail:{index}}));
  });
  on(stage,'dblclick',e=>{const index=hit(e);if(index!==undefined&&index!==null&&!hasMoved){document.dispatchEvent(new CustomEvent('cockpit:select-module',{detail:{index}}));document.getElementById('orbitQuickOpen').click();}});
  on(stage,'wheel',e=>{if(flat||!api.ready||!e.shiftKey)return;e.preventDefault();if(Math.abs(e.deltaY+e.deltaX)>12)document.dispatchEvent(new CustomEvent('cockpit:select-module',{detail:{index:(selected+(e.deltaY+e.deltaX>0?1:5))%6}}));},{passive:false});
  on(document,'cockpit:appearance-changed',e=>{
    motion=e.detail.motion&&!reduce.matches;flat=e.detail.view==='flat';accent=e.detail.accent;replay.disabled=!motion||!api.ready;
    if(!motion)finishIntro(true);if(world)world.visible=!flat&&!introActive;
    if(!flat){stage.scrollTop=0;stage.scrollLeft=0;resize();}requestFrame();
  });
  on(document,'visibilitychange',()=>{if(document.hidden){if(introActive)finishIntro(true);cancelAnimationFrame(frame);frame=0;}else{last=0;requestFrame();}});
  on(window,'resize',()=>{resize();requestFrame();});
  on(overlay,'pointermove',e=>{introPointer={x:(e.clientX/innerWidth-.5)*2,y:-(e.clientY/innerHeight-.5)*2};});
  on(replay,'click',startIntro);on(document.getElementById('introSkip'),'click',()=>finishIntro());
  on(window,'pagehide',e=>{if(e.persisted){cancelAnimationFrame(frame);frame=0;finishIntro(true);}else api.destroy();});
  on(window,'pageshow',e=>{if(e.persisted){last=0;resize();requestFrame();}});
  replay.disabled=!motion;initialize();
})();
