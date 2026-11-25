import * as THREE from "three";
import { PIXEL_PALETTE_GLSL } from "./PixelPalette.ts";

export function applyPixelMaterials(root: THREE.Object3D, daylight = { value: 1 }, floating = false) {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const ground = ["continuous-ground", "distant-ground", "terrain-bank"].includes(object.name);
    const bark = object.name === "generated-trunks";
    const grass = object.name === "grass-tufts";
    const leaves = object.name.startsWith("generated-leaves-");
    if (!ground && !bark && !grass && !leaves) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial) || material.userData.pixelInk) continue;
      material.userData.pixelInk = true;
      material.userData.floatingGround = ground && floating;
      const previous = material.onBeforeCompile;
      const key = material.customProgramCacheKey();
      material.customProgramCacheKey = () => key + `|pixel-ink-${object.name}`;
      material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer);
        shader.uniforms.inkDaylight = daylight;
        shader.vertexShader = "varying vec3 inkPosition; varying float inkSlope;\n" + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
          inkPosition = position;
          inkSlope = 1.0 - abs(normal.y);
        `);
        shader.fragmentShader = "uniform float inkDaylight; varying vec3 inkPosition; varying float inkSlope;\n" + shader.fragmentShader;
        if (ground) shader.fragmentShader = shader.fragmentShader.replace(/void\s+main\s*\(\s*\)\s*\{/, "#include <shadowmask_pars_fragment>\nvoid main() {");
        shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", `
          #ifndef USE_MAP
          ${ground ? `
            diffuseColor.rgb = vec3(mix(.018, .58, inkDaylight) + inkSlope * .035);
          ` : bark ? `
            float furrow = sin(inkPosition.x * 43.0 + inkPosition.z * 37.0
              + sin(inkPosition.y * 3.0) * 1.6);
            float barkDetail = 1.0 - smoothstep(.4, 2.0, fwidth(furrow));
            float groove = smoothstep(-.65, .45, furrow);
            float finePhase = inkPosition.x * 131.0 + inkPosition.z * 113.0
              + sin(inkPosition.y * 7.0) * 2.0;
            float fineFade = 1.0 - smoothstep(.5, 2.4, fwidth(finePhase));
            float fineGrain = sin(finePhase) * sin(inkPosition.y * 53.0);
            diffuseColor.rgb = vec3(mix(.23, .12 + groove * .24, barkDetail) + fineGrain * fineFade * .045);
          ` : grass ? `
            diffuseColor.rgb = vec3(clamp(dot(diffuseColor.rgb, vec3(.2126, .7152, .0722)) * 2.5, .1, .72));
          ` : `
            float leafTone=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
            diffuseColor.rgb=vec3(clamp(.14+leafTone*.95,.18,.66));
          `}
          #endif
          #include <roughnessmap_fragment>
        `);
      };
      material.needsUpdate = true;
    }
  });
}

export function makePixelRenderer(renderer: THREE.WebGLRenderer, daylight = {value: 1}, samples = 0) {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: true,
    samples,
    count: 2,
  });
  const pixelFootprint = {value: 1};
  const maskMaterials = new WeakMap<THREE.Material, { name: string; color: { value: number }; detail: { value: number }; soft: { value: number } }>();
  const clearColor = new THREE.Color();
  const maskClear = new Float32Array([0, 0, 0, 1]);
  const prepareColorMask = (scene: THREE.Scene) => {
    scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.material) return;
      for (const surface of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        let color = maskMaterials.get(surface);
        if (color?.name === object.name) continue;
        const keep = ["symbol-content", "surface-image", "dithered-sky", "meteor-shower", "connection-surface", "approach-outline", "peer-movement-trail"].includes(object.name);
        const stone = object.name === "scattered-stones" || object.name === "stones-surface-image";
        const kind = ["grass-understory", "hole-bottom", "world-horizon"].includes(object.name) ? 0
          : ["continuous-ground", "distant-ground", "terrain-bank"].includes(object.name) ? 1
          : object.name === "grass-tufts" ? 2 : object.name === "generated-trunks" ? 3
          : stone ? 4 : object.name === "generated-water" ? 5 : object.name === "cloud" ? 6
          : object.name.startsWith("generated-leaves-") ? 8 : 7;
        const detail = kind / 8;
        if (!color) {
          color = { name: object.name, color: { value: keep ? 1 : 0 }, detail: { value: detail }, soft: { value: stone ? 1 : 0 } };
          maskMaterials.set(surface, color);
          const preserve = color;
          const previous = surface.onBeforeCompile;
          const key = surface.customProgramCacheKey();
          surface.customProgramCacheKey = () => key + "|pixel-mrt";
          surface.onBeforeCompile = (shader, gl) => {
            previous.call(surface, shader, gl);
            shader.uniforms.pixelKeepColor = preserve.color;
            shader.uniforms.pixelSurfaceDetail = preserve.detail;
            shader.uniforms.pixelSoftSurface = preserve.soft;
            shader.uniforms.pixelDaylight = daylight;
            shader.uniforms.pixelFootprint = pixelFootprint;
            shader.fragmentShader = shader.fragmentShader.replace(/\/\/ pixel-mask-start[\s\S]*?\/\/ pixel-mask-end/g, "");
            if (!shader.fragmentShader.includes("out vec4 pixelMask;"))
              shader.fragmentShader = "layout(location = 1) out vec4 pixelMask;\nuniform float pixelKeepColor; uniform float pixelSurfaceDetail; uniform float pixelSoftSurface; uniform float pixelDaylight; uniform float pixelFootprint;\n" + shader.fragmentShader;
            if (!shader.vertexShader.includes("varying vec3 pixelSurfacePosition;")) {
              shader.vertexShader = "varying vec3 pixelSurfacePosition;\n" + shader.vertexShader;
              shader.vertexShader = shader.vertexShader.replace(/void\s+main\s*\(\s*\)\s*\{/, `void main() {
                pixelSurfacePosition = position;
                #ifdef USE_INSTANCING
                  pixelSurfacePosition = (instanceMatrix * vec4(position,1.0)).xyz;
                #endif
              `);
            }
            if (!shader.fragmentShader.includes("varying vec3 pixelSurfacePosition;"))
              shader.fragmentShader = "varying vec3 pixelSurfacePosition;\n" + shader.fragmentShader;
            if (!shader.fragmentShader.includes("float pixelTone(")) shader.fragmentShader=PIXEL_PALETTE_GLSL+shader.fragmentShader;
            const projected = shader.fragmentShader.includes("vec4 skinColor");
            shader.fragmentShader = shader.fragmentShader.replace(/}\s*$/, `
              // pixel-mask-start
              float sourceCoverage = pixelKeepColor;
                ${projected ? `
                  #ifdef USE_MAP
                    sourceCoverage = max(sourceCoverage, skinColor.a * skinOpacity);
                  #endif
                ` : ""}
              float surfaceKind = floor(pixelSurfaceDetail*8.0+.5);
              vec2 dotUv = vec2(pixelSurfacePosition.x+pixelSurfacePosition.z*.71,
                pixelSurfacePosition.y+pixelSurfacePosition.z*.31)*64.0;
              if (surfaceKind == 5.0) dotUv=pixelSurfacePosition.xz*96.0;
              if (surfaceKind == 1.0) dotUv=pixelSurfacePosition.xz*120.0;
              ${object.name === "terrain-bank" ? `dotUv=vec2(pixelSurfacePosition.x+pixelSurfacePosition.z*.71,pixelSurfacePosition.y)*72.0;` : ""}
              if (surfaceKind == 3.0) dotUv*=vec2(1.0,.8);
              if (surfaceKind == 6.0) dotUv=pixelSurfacePosition.xy*vec2(128.0,64.0);
              vec2 patchCell=floor(dotUv/8.0);
              float surfacePatch=fract(sin(dot(patchCell,vec2(39.346,11.135)))*47453.5453);
              if (surfaceKind == 3.0) dotUv/=vec2(1.0,2.0);
              if (surfaceKind == 5.0) dotUv/=vec2(1.5,1.0);
              float footprint=max(length(dFdx(dotUv)),length(dFdy(dotUv)))*pixelFootprint;
              float pixelFineFade=1.0-smoothstep(.75,1.5,footprint);
              float detailFade=1.0-smoothstep(.75,1.5,footprint/3.0);
              vec2 dotCell=floor(dotUv), da=mod(dotCell,2.0), db=mod(floor(dotCell/2.0),2.0);
              float dotThreshold=(4.0*(2.0*da.x+3.0*da.y-4.0*da.x*da.y)
                +2.0*db.x+3.0*db.y-4.0*db.x*db.y+.5)/16.0;
              float surfaceGrain=fract(sin(dot(dotCell,vec2(12.9898,78.233)))*43758.5453);
              if (surfaceKind == 1.0) dotThreshold=mix(dotThreshold,surfaceGrain,.65);
              if (surfaceKind == 2.0) dotThreshold=fract(dotThreshold*.5+mod(dotCell.y,3.0)/3.0);
              if (surfaceKind == 3.0) dotThreshold=mix(dotThreshold,mod(dotCell.x+floor(dotCell.y/3.0),4.0)/4.0,.6);
              if (surfaceKind == 4.0) dotThreshold=mix(dotThreshold,surfaceGrain,.55);
              if (surfaceKind == 5.0) dotThreshold=mix(dotThreshold,surfaceGrain,.8);
              if (surfaceKind == 6.0) dotThreshold=mix(dotThreshold,surfaceGrain,.3);
              if (surfaceKind == 8.0) dotThreshold=mix(dotThreshold,surfaceGrain,.85);
              vec2 coarseCell=floor(dotUv/3.0), ca=mod(coarseCell,2.0), cb=mod(floor(coarseCell/2.0),2.0);
              float coarseThreshold=(4.0*(2.0*ca.x+3.0*ca.y-4.0*ca.x*ca.y)+2.0*cb.x+3.0*cb.y-4.0*cb.x*cb.y+.5)/16.0;
              float coarseGrain=fract(sin(dot(coarseCell,vec2(12.9898,78.233)))*43758.5453);
              if (surfaceKind == 4.0 || surfaceKind == 8.0) coarseThreshold=mix(coarseThreshold,coarseGrain,.6);
              if (surfaceKind == 5.0) coarseThreshold=mix(coarseThreshold,coarseGrain,.8);
              dotThreshold=mix(coarseThreshold,dotThreshold,pixelFineFade);
              ${stone ? `
                vec3 stoneCell=floor(pixelSurfacePosition*64.0);
                vec3 stoneCoarse=floor(pixelSurfacePosition*(64.0/3.0));
                float stoneFineGrain=fract(sin(dot(stoneCell,vec3(12.9898,78.233,37.719)))*43758.5453);
                float stoneCoarseGrain=fract(sin(dot(stoneCoarse,vec3(12.9898,78.233,37.719)))*43758.5453);
                dotThreshold=mix(stoneCoarseGrain,stoneFineGrain,pixelFineFade);
              ` : ""}
              float surfaceLight=pixelDisplay(dot(gl_FragColor.rgb,vec3(.2126,.7152,.0722)));
              ${surface instanceof THREE.MeshStandardMaterial && (stone || object.name === "generated-trunks" || object.name === "grass-tufts" || object.name.startsWith("generated-leaves-")) ? `
                if (${stone ? "true" : "sourceCoverage < .01"}) {
                  float facing=abs(dot(normalize(vNormal),normalize(vViewPosition)));
                  float rim=1.0-smoothstep(${stone ? ".05,.38" : ".12,.62"},facing);
                  float crease=1.0-smoothstep(.12,.3,surfaceLight);
                  float coverage=${object.name === "generated-trunks" ? "1.0-rim*.24-crease*.035"
                    : object.name.startsWith("generated-leaves-") ? "1.0-rim*.3-crease*.055"
                    : stone ? "1.0-rim*(.3+surfacePatch*.2)" : "1.0-rim*.12"};
                  vec2 edgeUv=dotUv*.55;
                  float edgeFade=1.0-smoothstep(.8,2.0,max(length(dFdx(edgeUv)),length(dFdy(edgeUv))));
                  float edgeGrain=fract(sin(dot(floor(edgeUv),vec2(12.9898,78.233)))*43758.5453);
                  if (edgeGrain > mix(1.0,coverage,edgeFade)) discard;
                }
              ` : object.name === "cloud" ? `
                float cloudCoverage=smoothstep(.12,.75,gl_FragColor.a);
                if (cloudCoverage < mix(.5,dotThreshold,detailFade)) discard;
                gl_FragColor.a=1.0;
              ` : object.name === "generated-water" ? `
                if (smoothstep(0.0,.045,depth) < surfaceGrain*detailFade) discard;
              ` : ""}
              if (sourceCoverage < .01 && surfaceKind > .5 && surfaceKind != 7.0) {
                float nightLight=.16+smoothstep(.004,.42,surfaceLight)*.32;
                float ink=mix(nightLight,mix(.48,surfaceLight,.74),pixelDaylight);
                float shade=pixelTone(ink,dotThreshold,detailFade);
                ${object.name === "generated-water" ? `
                  float reflectedTone=pixelTone(surfaceLight,.5,.15);
                  float ridge=smoothstep(.1,.65,crest+fineCrest*.4);
                  float rippleDots=step(dotThreshold,ridge*.85)*detailFade;
                  float highlight=min(reflectedTone+mix(.035,.07,pixelDaylight),.98);
                  vec2 markCell=mix(coarseCell,dotCell,step(.5,pixelFineFade));
                  float markKind=waterHash(floor(dotUv/12.0)+vec2(3.7,11.2));
                  vec2 markSize=markKind < .5 ? vec2(1.0) : markKind < .8 ? vec2(2.0) : vec2(3.0,1.0);
                  vec2 markOrigin=floor(markCell/markSize)*markSize;
                  float markThreshold=waterHash(markOrigin+vec2(17.3,8.1));
                  float markShape=1.0;
                  if (markKind >= .5 && markKind < .8)
                    markShape=1.0-step(1.5,mod(markCell.x,2.0)+mod(markCell.y,2.0));
                  float waveDetail=smoothstep(.008,.04,abs(waveFacing));
                  float shadeDots=step(markThreshold,waterShade*.55*waveDetail)*markShape*detailFade;
                  float markTint=waterHash(markOrigin+vec2(41.7,29.3));
                  float inkTone=markTint < .5 ? -.055 : markTint < .82 ? -.028 : markTint < .94 ? .035 : .065;
                  float shadeCore=smoothstep(.55,.85,waterShade);
                  float pooledTone=reflectedTone-.028*shadeCore+inkTone*shadeDots*mix(.55,1.0,pixelDaylight);
                  shade=mix(max(pooledTone,.025),highlight,rippleDots*mix(.23,.35,step(.6,markTint)));
                  vec2 rippleGrainUv=waterWorldPosition.xz*64.0;
                  vec2 rippleGrainCell=floor(rippleGrainUv);
                  float rippleGrainFootprint=max(length(dFdx(rippleGrainUv)),length(dFdy(rippleGrainUv)))*pixelFootprint;
                  float rippleGrainFade=1.0-smoothstep(1.0,2.5,rippleGrainFootprint);
                  float rippleGrainMask=smoothstep(.025,.18,crest+fineCrest*.55);
                  float rippleGrainDot=step(.64,waterHash(rippleGrainCell+vec2(23.7,5.1)));
                  float rippleGrainTint=waterHash(rippleGrainCell+vec2(7.3,41.9));
                  float rippleGrainTone=(step(.5,rippleGrainTint)*2.0-1.0)
                    *mix(.035,.065,fract(rippleGrainTint*2.0));
                  shade=clamp(shade+rippleGrainTone*rippleGrainDot*rippleGrainMask*rippleGrainFade
                    *mix(.65,1.0,pixelDaylight),.025,.98);
                ` : ""}
                if (surfaceKind == 1.0) {
                  ${surface.userData.pixelInk && ["continuous-ground", "distant-ground", "terrain-bank"].includes(object.name) ? `
                    float groundDetail=max(smoothstep(.035,.22,inkSlope),(1.0-getShadowMask())*.65);
                    float groundNight=.18+smoothstep(.004,.42,surfaceLight)*.37;
                    float groundInk=mix(groundNight,surfaceLight,pixelDaylight);
                    shade=pixelTone(groundInk,dotThreshold,detailFade);
                    float nightGroundVisibility=1.0-smoothstep(18.0,60.0,length(vViewPosition));
                    shade=mix(${surface.userData.floatingGround ? "mix(.12,.9,pixelDaylight)" : "pixelHorizon(pixelDaylight)"},shade,
                      groundDetail*.7*mix(nightGroundVisibility,1.0,pixelDaylight));
                  ` : "shade=ink;"}
                }
                gl_FragColor.rgb=vec3(pixelLinear(shade));
              }
              ${stone && !surface.userData.sourceText ? `
                if(sourceCoverage >= .01){
                  float imageTone=pixelTone(surfaceLight,dotThreshold,detailFade*.85);
                  float imageLuma=max(dot(gl_FragColor.rgb,vec3(.2126,.7152,.0722)),.002);
                  gl_FragColor.rgb*=clamp(pixelLinear(imageTone)/imageLuma,.45,1.8);
                }
              ` : ""}
              ${object.name === "abstract-ladders" ? `
                float ladderLight=mix(.16+smoothstep(.004,.42,surfaceLight)*.32,mix(.48,surfaceLight,.74),pixelDaylight);
                gl_FragColor.rgb=vec3(pixelLinear(pixelTone(ladderLight,dotThreshold,detailFade)));
              ` : ""}
              ${object.name === "world-horizon" ? `gl_FragColor.rgb=vec3(pixelLinear(pixelHorizon(pixelDaylight)));` : ""}
              pixelMask = vec4(sourceCoverage, pixelSurfaceDetail * (1.0-sourceCoverage), pixelSoftSurface * (1.0-sourceCoverage), gl_FragColor.a);
              // pixel-mask-end
            }`);
          };
          surface.needsUpdate = true;
        }
        color.name = object.name;
        color.color.value = keep ? 1 : 0;
        color.detail.value = detail;
        color.soft.value = stone ? 1 : 0;
      }
    });
  };
  const material = new THREE.ShaderMaterial({
    uniforms: { source: { value: target.textures[0] }, colorMask: { value: target.textures[1] }, worldResolution: {value: new THREE.Vector2(1,1)} },
    depthTest: false,
    depthWrite: false,
    vertexShader: `
      varying vec2 screenUv;
      void main() {
        screenUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D source;
      uniform sampler2D colorMask;
      uniform vec2 worldResolution;
      varying vec2 screenUv;
      void main() {
        vec2 pixelUv=(floor(screenUv*worldResolution)+.5)/worldResolution;
        vec3 color = texture2D(source, pixelUv).rgb;
        vec3 worldDisplay=mix(color*12.92,1.055*pow(max(color,vec3(0.0)),vec3(1.0/2.4))-.055,
          step(vec3(.0031308),color));
        float tone=dot(worldDisplay,vec3(.2126,.7152,.0722));
        vec3 nativeColor=texture2D(source,screenUv).rgb;
        vec3 displayColor = mix(nativeColor * 12.92, 1.055 * pow(max(nativeColor, vec3(0.0)), vec3(1.0/2.4))-.055,
          step(vec3(.0031308), nativeColor));
        float preserve = step(.001,texture2D(colorMask,screenUv).r);
        gl_FragColor = vec4(mix(vec3(tone), displayColor, preserve), 1.0);
      }
    `,
  });
  const geometry = new THREE.PlaneGeometry(2, 2);
  const screen = new THREE.Scene();
  screen.add(new THREE.Mesh(geometry, material));
  const camera = new THREE.Camera();
  return {
    resize(width: number, height: number) {
      const pixelSize = Math.max(1, Math.round(height / 540));
      const w = Math.max(1, Math.ceil(width / pixelSize));
      const h = Math.max(1, Math.ceil(height / pixelSize));
      renderer.setSize(width, height, false);
      const native=renderer.getDrawingBufferSize(new THREE.Vector2());
      target.setSize(native.x, native.y);
      material.uniforms.worldResolution.value.set(w,h);
      pixelFootprint.value=native.y/h;
    },
    render(scene: THREE.Scene, sceneCamera: THREE.Camera) {
      prepareColorMask(scene);
      renderer.setRenderTarget(target);
      const background = scene.background;
      const autoClear = renderer.autoClear;
      const clearAlpha = renderer.getClearAlpha();
      renderer.getClearColor(clearColor);
      try {
        if (background && "isColor" in background) {
          renderer.setClearColor(background, 1);
          scene.background = null;
        }
        renderer.state.buffers.color.setMask(true);
        renderer.state.buffers.depth.setMask(true);
        renderer.clear();
        const gl = renderer.getContext() as WebGL2RenderingContext;
        gl.clearBufferfv(gl.COLOR, 1, maskClear);
        renderer.autoClear = false;
        renderer.render(scene, sceneCamera);
      } finally {
        scene.background = background;
        renderer.autoClear = autoClear;
        renderer.setClearColor(clearColor, clearAlpha);
      }
      renderer.setRenderTarget(null);
      renderer.render(screen, camera);
    },
    dispose() {
      target.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
