import { useCallback, useEffect, useState } from "react";
import { parseBridgeMessage, TRACKING_TIMEOUT_MS, type PositionMessage } from "../lib/uwb/protocol";

export function useDevicePosition(enabled: boolean) {
  const [request, setRequest] = useState<{ url: string; tagId: string } | null>(null);
  const [position, setPosition] = useState<PositionMessage | null>(null);
  const [status, setStatus] = useState("PC 수신기에 연결하세요.");
  const connect = useCallback((url: string, tagId: string) => {
    setPosition(null);
    setRequest({ url, tagId });
  }, []);
  const disconnect = useCallback(() => {
    setRequest(null); setPosition(null); setStatus("연결 종료 · 오디오 정지");
  }, []);

  useEffect(() => {
    setPosition(null);
    if (!enabled || !request) return;
    let socket: WebSocket;
    try {
      const url = new URL(request.url);
      if (!["ws:", "wss:"].includes(url.protocol)) throw new Error();
      socket = new WebSocket(url);
    } catch { setStatus("WebSocket 주소를 확인하세요."); return; }
    let disposed = false;
    let lastReceived = 0;
    let lastSequence = -1;
    setStatus("PC 수신기에 연결 중");
    const clear = (message: string) => { setPosition(null); setStatus(message); };
    socket.onopen = () => { if (!disposed) setStatus(`태그 ${request.tagId} 데이터 대기`); };
    socket.onmessage = (event) => {
      if (disposed) return;
      try {
        if (typeof event.data !== "string") throw new Error();
        const message = parseBridgeMessage(event.data);
        if (message.tagId !== request.tagId || message.seq <= lastSequence) return;
        lastSequence = message.seq;
        lastReceived = performance.now();
        if (message.type === "invalid") { clear(`${message.error} · 오디오 정지`); return; }
        setPosition(message);
        setStatus(`태그 ${message.tagId} 수신 중 · ${message.heightSource === "fixed" ? "높이 고정" : "높이 UWB 계산"}`);
      } catch { clear("수신 데이터 오류 · 오디오 정지"); }
    };
    socket.onerror = () => { if (!disposed) { lastReceived = 0; clear("PC 수신기 연결 실패 · 오디오 정지"); } };
    socket.onclose = () => { if (!disposed) { lastReceived = 0; clear("PC 수신기 연결 끊김 · 오디오 정지"); } };
    const timer = window.setInterval(() => {
      if (lastReceived && performance.now() - lastReceived > TRACKING_TIMEOUT_MS) {
        lastReceived = 0;
        clear("1초 동안 위치 수신 없음 · 오디오 정지");
      }
    }, 100);
    const connectionTimeout = window.setTimeout(() => {
      if (socket.readyState === WebSocket.CONNECTING) socket.close();
    }, 5000);
    return () => {
      disposed = true;
      window.clearInterval(timer); window.clearTimeout(connectionTimeout);
      socket.close();
    };
  }, [enabled, request]);

  return { position: enabled && request ? position : null, status, connect, disconnect, connected: !!request };
}
