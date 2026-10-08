// ข้อความที่ส่งระหว่างหน้าเว็บกับห้อง (Durable Object) ผ่าน websocket

export type Phase = "lobby" | "loading" | "playing" | "reveal" | "ended";

export interface PlayerView {
  id: string;
  name: string;
  score: number;
  connected: boolean;
}

export interface Settings {
  rounds: number;
  seconds: number;
}

export interface RoundView {
  index: number; // เริ่มที่ 1
  total: number;
  previewUrl: string;
  startsAt: number; // เวลาของ server (ms) ที่ทุกคนเริ่มเล่นเพลงพร้อมกัน
  endsAt: number;
  correct: { id: string; points: number }[];
}

export interface RevealView {
  title: string;
  artists: string[];
  cover?: string;
}

export interface RoomView {
  code: string;
  hostId: string | null;
  phase: Phase;
  players: PlayerView[];
  settings: Settings;
  playlist: { name: string; count: number } | null;
  round: RoundView | null;
  reveal: RevealView | null;
  nextAt: number | null; // เวลาที่จะเริ่มรอบถัดไป (ตอน reveal)
  serverNow: number;
}

export type ClientMsg =
  | { t: "setPlaylist"; url: string }
  | { t: "settings"; settings: Partial<Settings> }
  | { t: "start" }
  | { t: "guess"; text: string }
  | { t: "skip" }
  | { t: "backToLobby" }
  | { t: "leave" };

export type ServerMsg =
  | { t: "state"; room: RoomView; you: string }
  | { t: "guessResult"; result: "correct" | "close" | "wrong"; points?: number; text: string }
  | { t: "error"; message: string };

export const LIMITS = {
  maxPlayers: 20,
  maxNameLength: 20,
  rounds: { min: 1, max: 30 },
  seconds: { min: 10, max: 30 }, // preview ของ Deezer ยาว 30 วินาที
};
