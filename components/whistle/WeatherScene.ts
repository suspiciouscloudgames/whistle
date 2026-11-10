import * as THREE from "three";
import type { Weather } from "../../lib/world.ts";
import { randomSequence } from "../../lib/terrain.ts";

export function makeWeather(size: number) {
  const group = new THREE.Group();
  group.name = "weather";
  const random = randomSequence(7319);
  const cloudCanvas = document.createElement("canvas");
  cloudCanvas.width = 256; cloudCanvas.height = 128;
  const ctx = cloudCanvas.getContext("2d")!;
  for (let i = 0; i < 24; i++) {
    const x = 40 + random() * 176, y = 40 + random() * 48, radius = 22 + random() * 24;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, "rgba(255,255,255,.25)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient; ctx.fillRect(x-radius, y-radius, radius*2, radius*2);
  }
  const cloudMap = new THREE.CanvasTexture(cloudCanvas);
  const clouds = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const material = new THREE.SpriteMaterial({ map: cloudMap, transparent: true, depthWrite: false, fog: false, opacity: .48 });
    const sprite = new THREE.Sprite(material);
    // Stagger apparent altitude as well as distance so clouds do not form a ring.
    const angle = (i + (random() - .5) * .7) * Math.PI * 2 / 9;
    const distance = size + 6 + random() * 18;
    const elevation = .12 + ((i * 5) % 9) / 8 * .5 + random() * .08;
    sprite.position.set(
      Math.cos(angle) * distance,
      2 + Math.tan(elevation) * distance,
      Math.sin(angle) * distance,
    );
    sprite.scale.set(13 + random()*11, 3.5 + random()*3, 1);
    clouds.add(sprite);
  }
  group.add(clouds);
  const count = 420;
  const seeds = Array.from({length:count}, () => ({x:random()*40, z:random()*40, y:random()*18, phase:random()*6.28}));
  const rainPositions = new Float32Array(count*6), snowPositions = new Float32Array(count*3);
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute("position", new THREE.BufferAttribute(rainPositions,3).setUsage(THREE.DynamicDrawUsage));
  const rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({color:0xc7d3dd,transparent:true,opacity:.5,depthWrite:false}));
  rain.frustumCulled = false; rain.name = "rain";
  const flakeCanvas = document.createElement("canvas"); flakeCanvas.width=flakeCanvas.height=32;
  const flake = flakeCanvas.getContext("2d")!;
  const fade = flake.createRadialGradient(16,16,0,16,16,16);
  fade.addColorStop(0,"#fff"); fade.addColorStop(.4,"#fff"); fade.addColorStop(1,"rgba(255,255,255,0)");
  flake.fillStyle=fade; flake.fillRect(0,0,32,32);
  const snowGeometry = new THREE.BufferGeometry();
  snowGeometry.setAttribute("position",new THREE.BufferAttribute(snowPositions,3).setUsage(THREE.DynamicDrawUsage));
  const snow = new THREE.Points(snowGeometry,new THREE.PointsMaterial({map:new THREE.CanvasTexture(flakeCanvas),color:0xffffff,size:.065,transparent:true,opacity:.9,depthWrite:false}));
  snow.frustumCulled=false; snow.name="snow";
  group.add(rain,snow);
  const wrap = (v:number, width:number) => ((v%width)+width)%width;
  return { group, update(time:number, weather:Weather, camera:THREE.Camera, daylight:number, overview:boolean) {
    clouds.visible=weather!=="clear"; rain.visible=weather==="rain"; snow.visible=weather==="snow";
    if (weather==="clear") return;
    const seconds=time*.001;
    clouds.rotation.y = seconds*.002;
    for(const child of clouds.children) (child as THREE.Sprite).material.color.setScalar(.35+daylight*.5);
    if(weather==="cloud") return;
    const cx=overview?0:camera.position.x, cz=overview?0:camera.position.z;
    const radius=overview?size+3:14;
    seeds.forEach((p,i)=>{
      const snowy=weather==="snow";
      const x=cx+wrap(p.x+seconds*(snowy?.2:.8)-cx,radius*2)-radius;
      const z=cz+wrap(p.z+(snowy?Math.sin(seconds*.7+p.phase)*.3:0)-cz,radius*2)-radius;
      const y=wrap(p.y-seconds*(snowy?.7:10),18)-1;
      if(snowy) snowPositions.set([x,y,z],i*3);
      else rainPositions.set([x,y,z,x-.035,y+.4,z],i*6);
    });
    (weather==="snow"?snowGeometry:rainGeometry).getAttribute("position").needsUpdate=true;
  }};
}
