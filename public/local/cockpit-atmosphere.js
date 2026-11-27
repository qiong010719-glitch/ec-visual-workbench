/* GPU particle choreography, authored for this workspace. No external assets. */
window.createCockpitAtmosphere = function (T, ownGeometry, ownMaterial) {
  const group=new T.Group(),cloud=new T.Group();group.add(cloud);
  const uniforms={time:{value:0},gather:{value:0},dissolve:{value:0},pixelRatio:{value:1},viewportHeight:{value:800},pointer:{value:new T.Vector2()}};
  const count=18000,positions=new Float32Array(count*3),seeds=new Float32Array(count),sizes=new Float32Array(count);
  const rand=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
  for(let i=0;i<count;i++){
    const y=1-2*(i+.5)/count,r=Math.sqrt(1-y*y),a=i*2.3999632297;
    const shell=1.48+rand(i+38)*.12;
    positions.set([Math.cos(a)*r*shell,y*shell,Math.sin(a)*r*shell],i*3);
    seeds[i]=rand(i);sizes[i]=rand(i+61);
  }
  const geo=ownGeometry(new T.BufferGeometry());geo.setAttribute('position',new T.BufferAttribute(positions,3));geo.setAttribute('seed',new T.BufferAttribute(seeds,1));geo.setAttribute('sizeSeed',new T.BufferAttribute(sizes,1));
  const mat=ownMaterial(new T.ShaderMaterial({uniforms,transparent:true,depthWrite:false,blending:T.AdditiveBlending,
    vertexShader:`
      attribute float seed,sizeSeed;uniform float time,gather,dissolve,pixelRatio,viewportHeight;uniform vec2 pointer;
      varying vec3 vColor;varying float vAlpha,vSpark;
      mat2 rotate(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
      void main(){
        vec3 n=normalize(position),p=position;
        float wave=sin(n.x*7.+time*.68)*cos(n.y*6.-time*.48)+sin(n.z*9.+n.y*3.+time*.4)*.42;
        p+=n*wave*.12;
        p.xz=rotate(time*.11+wave*.06)*p.xz;
        vec3 start=position*(2.5+seed*3.5);start.xz=rotate(seed*6.28+time*.3)*start.xz;start.y*=.55;
        p=mix(start,p,gather);
        float explode=dissolve*dissolve;p+=n*explode*(3.+seed*7.);p.xz=rotate(explode*(1.+seed))*p.xz;
        p.xy+=pointer*.075*(.3+seed);
        vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
        float front=smoothstep(-1.5,1.5,p.z),spark=pow(sizeSeed,55.);
        float ribbon=pow(.5+.5*sin(n.y*16.+n.x*3.+wave*1.7+time*.42),8.);
        float brightness=.3+front*.5+ribbon*.65+spark*2.3;
        vColor=mix(vec3(.28,.52,.68),vec3(.82,.94,1.),front*.8+ribbon*.2)*brightness;
        vColor+=vec3(.5,.31,.12)*pow(seed,28.);
        vAlpha=(.35+front*.6)*(.2+gather*.8)*(1.-dissolve);
        vSpark=spark;
        float point=(1.5+sizeSeed*1.3+spark*4.8)*pixelRatio*clamp(viewportHeight/800.,.7,1.7)*8./-mv.z;
        gl_PointSize=clamp(point,1.,18.);
      }`,
    fragmentShader:`varying vec3 vColor;varying float vAlpha,vSpark;
      void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;
      float core=exp(-r*r*8.),halo=exp(-r*r*2.)*.18;
      gl_FragColor=vec4(vColor*(1.+vSpark*2.),(core+halo)*vAlpha);}`
  }));const points=new T.Points(geo,mat);cloud.add(points);
  // Fine orbital paths carry moving light, rather than uniform decorative rings.
  const trails=[];
  for(let i=0;i<5;i++){
    const curve=new T.CatmullRomCurve3(Array.from({length:100},(_,j)=>{
      const a=j/99*Math.PI*2;return new T.Vector3(Math.cos(a)*(1.96+i*.12),Math.sin(a)*(1.42+i*.1),Math.sin(a*2+i)*.12);
    }),true);
    const u={time:uniforms.time,dissolve:uniforms.dissolve,gather:uniforms.gather,offset:{value:i*.19}};
    const trail=new T.Mesh(ownGeometry(new T.TubeGeometry(curve,180,.006,5,true)),ownMaterial(new T.ShaderMaterial({uniforms:u,transparent:true,depthWrite:false,blending:T.AdditiveBlending,
      vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`uniform float time,offset,gather,dissolve;varying vec2 vUv;
      void main(){float d=fract(vUv.x-time*.055+offset);float trail=exp(-d*19.);float crest=exp(-d*90.);
      vec3 color=mix(vec3(.18,.4,.58),vec3(.8,.93,1.),trail);float strength=.035+trail*.55+crest*2.;
      gl_FragColor=vec4(color*(.4+crest*3.),strength*gather*(1.-dissolve));}`
    })));
    trail.rotation.set(.45+i*.55,i*.47,.25+i*.4);cloud.add(trail);trails.push(trail);
  }
  // Soft atmosphere gives the point cloud a readable volume and a luminous rim.
  const core=new T.Mesh(ownGeometry(new T.SphereGeometry(1.48,64,48)),ownMaterial(new T.ShaderMaterial({uniforms,transparent:true,depthWrite:false,blending:T.AdditiveBlending,
    vertexShader:`varying vec3 vNormal,vView;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vNormal=normalize(normalMatrix*normal);vView=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}`,
    fragmentShader:`uniform float gather,dissolve;varying vec3 vNormal,vView;void main(){float f=pow(1.-abs(dot(vNormal,vView)),3.5);gl_FragColor=vec4(vec3(.12,.38,.6)*(f*.7+.025),gather*(1.-dissolve)*(.06+f*.32));}`
  })));cloud.add(core);
  const dustPositions=[],dustColors=[];
  for(let i=0;i<900;i++){
    dustPositions.push((rand(i+700)-.5)*22,(rand(i+1300)-.5)*14,-3-rand(i+2100)*8);
    const b=.1+Math.pow(rand(i+4000),7)*1.4;dustColors.push(b*.55,b*.76,b);
  }
  const dustGeo=ownGeometry(new T.BufferGeometry());dustGeo.setAttribute('position',new T.Float32BufferAttribute(dustPositions,3));dustGeo.setAttribute('color',new T.Float32BufferAttribute(dustColors,3));
  const dust=new T.Points(dustGeo,ownMaterial(new T.PointsMaterial({size:.018,vertexColors:true,transparent:true,opacity:.6,depthWrite:false,blending:T.AdditiveBlending})));group.add(dust);
  return {group,uniforms,update(elapsed,pointer){
    uniforms.time.value=elapsed;uniforms.pointer.value.set(pointer.x,pointer.y);
    uniforms.gather.value=1-Math.pow(1-Math.min(elapsed/1.7,1),3);
    uniforms.dissolve.value=Math.max(0,Math.min((elapsed-3.8)/1.3,1));
    cloud.rotation.set(-.08+Math.sin(elapsed*.22)*.06,elapsed*.075,.12);
    cloud.position.y=.35;dust.rotation.z=elapsed*.004;
    core.scale.setScalar(.8+uniforms.gather.value*.2);
  }};
};
