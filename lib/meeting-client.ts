import { MEETING_PATH, onOwnMeetingFloor, type MeetingPosition, type MeetingPresence, type MeetingView } from "./meeting.ts";

export function meetingSocketURL(page:URL, endpoint?:string) {
  const url=new URL(endpoint || MEETING_PATH,page);
  if(url.protocol==="https:")url.protocol="wss:";
  else if(url.protocol==="http:")url.protocol="ws:";
  if(!["ws:","wss:"].includes(url.protocol) || page.protocol==="https:"&&url.protocol!=="wss:")
    throw Error("연결 서버 주소가 올바르지 않습니다.");
  url.hash="";
  return url;
}

export function sameMeetingPosition(a: MeetingPosition, b: MeetingPosition) {
  return Math.abs(a.x - b.x) < .0001 && Math.abs(a.z - b.z) < .0001 && Math.abs(a.yaw - b.yaw) < .0001 &&
    Math.abs((a.pitch ?? 0) - (b.pitch ?? 0)) < .0001 && a.grounded === b.grounded && !!a.falling === !!b.falling;
}

export function sameMeetingPresence(a: MeetingPresence, b: MeetingPresence) {
  return a.onlineCount === b.onlineCount && a.canWhistle === b.canWhistle &&
    a.turn?.owner === b.turn?.owner && a.turn?.partner === b.turn?.partner &&
    a.turn?.startedAt === b.turn?.startedAt && a.turn?.endsAt === b.turn?.endsAt &&
    a.turn?.tiles?.added.length === b.turn?.tiles?.added.length &&
    a.peers.length === b.peers.length && a.peers.every((peer, i) => {
      const next = b.peers[i];
      return peer.id === next.id && peer.slot === next.slot && peer.online === next.online && peer.playing === next.playing;
    });
}

export function resumeMeetingPosition(view: MeetingView, player: MeetingPosition | null): MeetingView {
  if (view.reset.reason !== "disconnect" || !player || !onOwnMeetingFloor(view.ownWorld, player)) return view;
  return { ...view, reset: { ...view.reset, player: { ...player } } };
}
