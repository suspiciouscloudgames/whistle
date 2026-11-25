import type { MeetingPresence } from "./meeting.ts";

export const TRAIL_LIFETIME_MS = 1500;
export const TRAIL_LENGTH_TILES = 1.8;
export const TRAIL_CAPACITY = 32;

export type TrailPoint = { x: number; z: number; time: number; distance: number };

export class MeetingTrail {
  readonly points: TrailPoint[] = [];
  private peerId?: string;
  private leftFloor = false;

  clear() {
    this.points.length = 0;
    this.peerId = undefined;
    this.leftFloor = false;
  }

  receive(presence: MeetingPresence, self: string, partner: string | undefined, now: number) {
    const connected = partner && partner !== self && presence.canWhistle && !presence.turn &&
      presence.peers.some(p => p.id === self && p.online && p.playing);
    const peer = connected ? presence.peers.find(p => p.id === partner) : undefined;
    const player = peer?.player;
    if (!peer?.online || !peer.playing) {
      this.clear();
      return;
    }
    if (this.peerId !== peer.id) this.clear();
    if (!player?.grounded || player.falling) {
      this.leftFloor = true;
      return;
    }
    const last = this.points.at(-1);
    let distance = 0;
    if (last) {
      const step = Math.hypot(player.x - last.x, player.z - last.z);
      if (step < .005) {
        this.leftFloor = false;
        return;
      }
      const elapsed = now - last.time;
      if (this.leftFloor || elapsed >= TRAIL_LIFETIME_MS || step > Math.min(.9, .35 + elapsed * .003))
        this.clear();
      else distance = last.distance + step;
    }
    this.leftFloor = false;
    this.peerId = peer.id;
    this.points.push({ x: player.x, z: player.z, time: now, distance });
    while (this.points.length > TRAIL_CAPACITY || now - this.points[0].time >= TRAIL_LIFETIME_MS ||
      distance - this.points[0].distance > TRAIL_LENGTH_TILES) this.points.shift();
  }
}
