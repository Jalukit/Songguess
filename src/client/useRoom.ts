import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMsg, RoomView, ServerMsg } from "../shared/protocol.ts";

export type GuessFeedback = Extract<ServerMsg, { t: "guessResult" }> & { at: number };

/** playerId ต่อแท็บ ต่อห้อง — รีเฟรชหน้าแล้วกลับมาเป็นคนเดิม คะแนนไม่หาย */
export function playerIdFor(code: string): string {
  const key = `sg:player:${code}`;
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

export function useRoom(code: string, name: string) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [you, setYou] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [feedback, setFeedback] = useState<GuessFeedback | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const clockOffset = useRef(0);

  useEffect(() => {
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const qs = new URLSearchParams({ name, playerId: playerIdFor(code) });
      const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${code}/ws?${qs}`);
      wsRef.current = ws;

      ws.onopen = () => {
        retry = 0;
        setConnected(true);
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMsg;
        if (msg.t === "state") {
          clockOffset.current = msg.room.serverNow - Date.now();
          setRoom(msg.room);
          setYou(msg.you);
        } else if (msg.t === "guessResult") {
          setFeedback({ ...msg, at: Date.now() });
        } else if (msg.t === "error") {
          setError(msg.message);
        }
      };
      ws.onclose = (e) => {
        setConnected(false);
        if (stopped) return;
        // 4000 = ถูกปฏิเสธ, 4001 = เปิดในแท็บอื่น, 1000 = ออกจากห้องเอง
        if (e.code === 4000 || e.code === 4001 || e.code === 1000) {
          setFatal(e.reason || "การเชื่อมต่อถูกปิด");
          return;
        }
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [code, name]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const send = useCallback((msg: ClientMsg) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const serverNow = useCallback(() => Date.now() + clockOffset.current, []);

  return { room, you, error, fatal, connected, feedback, send, serverNow };
}

/** re-render ทุก ๆ intervalMs สำหรับนาฬิกานับถอยหลัง */
export function useTicker(intervalMs = 200) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
}
