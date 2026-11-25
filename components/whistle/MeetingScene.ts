import * as THREE from "three";
import { MEETING_LEMON, connectionCells, type MeetingSignal, type ConnectionTile } from "@/lib/meeting";
import type { MeetingTrail } from "@/lib/meeting-trail";
import { floorHeight } from "@/lib/terrain";
import type { World } from "@/lib/world";

export type MeetingVisuals = {
  approaches: (ConnectionTile & {online?:boolean})[];
  signals: MeetingSignal[]; connections: (ConnectionTile & { online?: boolean })[]; peerTrail?: MeetingTrail;
};
export function createMeetingScene(size: number) {
  const group = new THREE.Group(); group.name = "meeting";
  const objects = new Map<string, THREE.Group>();
  const toScene = (n: number) => n * 2 - size + 1;
  const ink = new THREE.MeshBasicMaterial({ color: 0x161616, fog: false });
  const paper = new THREE.MeshBasicMaterial({ color: 0xf5f5f5, fog: false });
  const edge = new THREE.LineBasicMaterial({ color: 0x161616, fog: false });
  const sync = (state: MeetingVisuals | undefined, world: World, camera: THREE.Camera, time: number) => {
    group.visible = !!state; if (!state) return;
    const active = new Set<string>();
    const get = (id: string, build: (g: THREE.Group) => void) => {
      active.add(id); let g = objects.get(id);
      if (!g) { g = new THREE.Group(); g.name = id; build(g); objects.set(id, g); group.add(g); }
      return g;
    };
    for (const signal of state.signals) {
      const g = get(signal.id, g => {
        const face = new THREE.Mesh(new THREE.PlaneGeometry(.53, .53), paper); face.rotation.z = Math.PI/4; g.add(face);
        const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0,.4,.01), new THREE.Vector3(.4,0,.01), new THREE.Vector3(0,-.4,.01), new THREE.Vector3(-.4,0,.01)]), edge);
        g.add(line);
        const core = new THREE.Mesh(new THREE.CircleGeometry(.06, 12), ink); core.position.z = .02; g.add(core);
      });
      const height = floorHeight(world, signal.x, signal.z, []) ?? 0;
      g.position.set(toScene(signal.x), height + 1.15 + Math.sin(time*.0015)*.05, toScene(signal.z));
      g.quaternion.copy(camera.quaternion);
    }
    for (const approach of state.approaches) {
      const g = get(`approach-${approach.id}`,g=>{
        const geometry = new THREE.BufferGeometry().setFromPoints([[-.95,-.95],[.95,-.95],[.95,.95],[-.95,.95],[-.95,-.95]].map(([x,z])=>new THREE.Vector3(x,.035,z)));
        const line = new THREE.Line(geometry,new THREE.LineDashedMaterial({color:MEETING_LEMON,dashSize:.15,gapSize:.1}));
        line.name="approach-outline";line.computeLineDistances();g.add(line);
        const base=new THREE.Mesh(new THREE.PlaneGeometry(1.94,1.94),ink);
        base.rotation.x=-Math.PI/2;base.position.y=.025;base.name="disconnected-base";g.add(base);
      });
      g.position.set(toScene(approach.x),0,toScene(approach.z));
      (g.children[0] as THREE.Line<THREE.BufferGeometry,THREE.LineDashedMaterial>).material.color.set(approach.online===false?"#111111":MEETING_LEMON);
      g.getObjectByName("disconnected-base")!.visible=approach.online===false&&!!approach.built;
    }
    for (const original of state.connections) for (const [index, cell] of connectionCells(original).entries()) {
      const connection = {...original,...cell,id:`${original.id}-${index}`};
      const g = get(connection.id, g => {
        const surface = new THREE.Mesh(new THREE.PlaneGeometry(1.94, 1.94),
          new THREE.MeshBasicMaterial({ color: MEETING_LEMON, side: THREE.DoubleSide }));
        surface.name = "connection-surface"; surface.rotation.x = -Math.PI / 2; surface.position.y = .025; g.add(surface);
        const corners: THREE.Vector3[] = [];
        for (const [x,z] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
          corners.push(new THREE.Vector3(x*.82,.035,z*.49),new THREE.Vector3(x*.82,.035,z*.82),
            new THREE.Vector3(x*.82,.035,z*.82),new THREE.Vector3(x*.49,.035,z*.82));
        }
        g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(corners), edge));
        const dot = new THREE.Mesh(new THREE.CircleGeometry(.13, 24), ink); dot.rotation.x = -Math.PI/2;
        dot.position.y = .05; dot.name = "opened"; g.add(dot);
      });
      g.position.set(toScene(connection.x), 0, toScene(connection.z));
      const surface = g.getObjectByName("connection-surface") as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
      surface.material.color.set(connection.online === false ? "#111111" : MEETING_LEMON);
      g.getObjectByName("opened")!.visible = !!original.opened;
    }
    for (const [id,g] of objects) if (!active.has(id)) {
      g.traverse(o => { const mesh=o as THREE.Mesh; mesh.geometry?.dispose(); if (["connection-surface","approach-outline"].includes(mesh.name)) (mesh.material as THREE.Material).dispose(); });
      group.remove(g); objects.delete(id);
    }
  };
  return { group, sync };
}
