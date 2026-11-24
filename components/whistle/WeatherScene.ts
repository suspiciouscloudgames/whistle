import * as THREE from "three";
import { makeDitheredSky } from "./DitheredSky.ts";
import type { Weather } from "../../lib/world.ts";
import { randomSequence } from "../../lib/terrain.ts";

export function makeWeather(size: number) {
  const group = new THREE.Group();
  group.name = "weather";
  const random = randomSequence(7319);
  const sky = makeDitheredSky();
  group.add(sky);
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
    sky.visible = !overview;
    sky.position.copy(camera.position);
    sky.material.uniforms.daylight.value=daylight;
    sky.material.uniforms.cloudAmount.value=weather === "clear" ? .25 : weather === "rain" ? 1 : .75;
    rain.visible=weather==="rain"; snow.visible=weather==="snow";
    if (weather==="clear" || weather==="cloud") return;
    const seconds=time*.001;
    const cx=overview?0:camera.position.x, cz=overview?0:camera.position.z;
    const radius=overview?size+3:14;
    const snowy=weather==="snow";
    for (let i=0; i<count; i++) {
      const p=seeds[i];
      const x=cx+wrap(p.x+seconds*(snowy?.2:.8)-cx,radius*2)-radius;
      const z=cz+wrap(p.z+(snowy?Math.sin(seconds*.7+p.phase)*.3:0)-cz,radius*2)-radius;
      const y=wrap(p.y-seconds*(snowy?.7:10),18)-1;
      if(snowy) {
        const offset=i*3;
        snowPositions[offset]=x; snowPositions[offset+1]=y; snowPositions[offset+2]=z;
      } else {
        const offset=i*6;
        rainPositions[offset]=x; rainPositions[offset+1]=y; rainPositions[offset+2]=z;
        rainPositions[offset+3]=x-.035; rainPositions[offset+4]=y+.4; rainPositions[offset+5]=z;
      }
    }
    (weather==="snow"?snowGeometry:rainGeometry).getAttribute("position").needsUpdate=true;
  }};
}
