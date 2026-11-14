import { useState } from "react";
import type { useDevicePosition } from "./useDevicePosition";

export default function DeviceControls({ device }: { device: ReturnType<typeof useDevicePosition> }) {
  const [url, setUrl] = useState("ws://127.0.0.1:5194");
  const [tagId, setTagId] = useState("0");
  return <fieldset><legend>PC 수신기 연결</legend>
    <label>수신기 주소<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} /></label>
    <label>관객 태그 ID<input value={tagId} maxLength={32} onChange={(event) => setTagId(event.target.value)} /></label>
    <button onClick={() => device.connect(url, tagId)} disabled={!url || !/^[a-zA-Z0-9_-]{1,32}$/.test(tagId)}>연결 / 다시 연결</button>
    <button onClick={device.disconnect} disabled={!device.connected}>연결 종료</button>
    <p id="device-status" role="status">{device.status}</p>
    {device.position ? <dl>
      <dt>X / Z (m)</dt><dd>{device.position.x.toFixed(3)} / {device.position.z.toFixed(3)}</dd>
      <dt>보드 높이 (m)</dt><dd>{device.position.boardHeight.toFixed(3)} ({device.position.heightSource === "fixed" ? "고정값" : "UWB 계산"})</dd>
      <dt>거리 오차 RMS (m)</dt><dd>{device.position.residual.toFixed(3)} · 앵커 {device.position.anchors}개</dd>
    </dl> : null}
    <p>PC 프로그램의 실제 장비·가상 장비를 같은 경로로 받습니다. 태그를 바꾼 뒤 다시 연결하세요.</p>
  </fieldset>;
}
