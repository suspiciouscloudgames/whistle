import type { MeetingSession } from "./ConnectedWorld";
import { LOCAL_SIZE, meetingLocal } from "@/lib/meeting";
import type { MeetingVisuals } from "./MeetingScene";

export function MeetingOverlay({ meeting }: {meeting:MeetingSession}) {
  const {view,presence}=meeting;
  const online = (c:{members:string[];online?:boolean}) => c.online!==false && meeting.status === "online" && c.members.every(id => presence.peers.some(p => p.id === id && p.online));
  const place=(p:{x:number;z:number})=>{const q=meetingLocal(view.slot,p);return{
    left:`${Math.max(0,Math.min(100,(q.x+.5)/LOCAL_SIZE*100))}%`,top:`${Math.max(0,Math.min(100,(q.z+.5)/LOCAL_SIZE*100))}%`};};
  const tile=(p:{x:number;z:number})=>{const q=meetingLocal(view.slot,p);return{
    left:`${q.x/LOCAL_SIZE*100}%`,top:`${q.z/LOCAL_SIZE*100}%`,width:`${100/LOCAL_SIZE}%`,height:`${100/LOCAL_SIZE}%`};};
  const own=meeting.positionRef.current ?? presence.peers.find(p=>p.id===view.id)?.player;
  return <div className="meeting-map-layer">
    {view.signals.filter(s=>s.to===view.id).map(s=><span key={s.id} className="meeting-map-signal" style={place(s)} role="img"
      aria-label="도착한 기호" data-meeting-signal={s.id} data-signal-x={s.x} data-signal-z={s.z}>◇</span>)}
    {view.connections.filter(c=>c.members[0]===view.id).map(c=><span key={c.id} style={tile(c)} role="img" aria-label={!online(c)?"연결이 끊긴 발판":c.opened ? "열린 연결 발판" : "연결 발판: 밟아서 상대 세계 열기"}
      className={`meeting-map-connection${online(c) ? "" : " disconnected"}`} data-connection-online={online(c)} data-connection-opened={!!c.opened} data-connection={c.id} data-connection-x={c.x} data-connection-z={c.z}>
      {c.opened&&<i />}</span>)}
    {view.approaches.map(c=><span key={c.id} style={tile(c)} role="img" aria-label={online(c)?"연결 위치: 이웃의 재료를 사용하고 이곳까지 바닥을 이어주세요":"연결이 끊긴 자리"}
      className={`meeting-map-approach${online(c) ? "" : " disconnected"}`} data-approach={c.id} data-approach-online={online(c)} data-approach-x={c.x} data-approach-z={c.z} />)}
    {own&&<span className="meeting-map-player" style={place(own)} role="img" aria-label="내 위치" />}
  </div>;
}
export function meetingVisuals(meeting:MeetingSession, local=false):MeetingVisuals {
  const {view,presence}=meeting;
  const connections = view.connections.map(c => ({...c, online: c.online!==false && meeting.status === "online" && c.members.every(id => presence.peers.some(p => p.id === id && p.online))}));
  const approaches = view.approaches.map(c=>({...c,online:c.online!==false && meeting.status === "online" && c.members.every(id=>presence.peers.some(p=>p.id===id&&p.online))}));
  return local ? {
    signals:view.signals.filter(s=>s.to===view.id).map(s=>({...s,...meetingLocal(view.slot,s)})),
    connections:connections.filter(c=>c.members[0]===view.id).map(c=>({...c,...meetingLocal(view.slot,c),cells:c.cells?.map(cell=>meetingLocal(view.slot,cell))})),
    approaches:approaches.map(c=>({...c,...meetingLocal(view.slot,c)})),
    peers:[],
  } : {signals:view.signals.filter(s=>s.to===view.id),connections,approaches,
    peers:[]};
}
