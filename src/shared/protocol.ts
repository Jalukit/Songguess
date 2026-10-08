// ข้อความที่ส่งระหว่างหน้าเว็บกับห้อง (Durable Object) ผ่าน websocket

export type Phase = "lobby" | "loading" | "playing" | "reveal" | "ended";

export interface PlayerView {
  id: string;
  name: string;
  score: number;
  connected: boolean;
}

export type AnswerMode = "choice" | "type";

export interface Settings {
  rounds: number;
  seconds: number;
  mode: AnswerMode; // เลือกจาก 4 ตัวเลือก หรือพิมพ์ชื่อเพลงเอง
  blurCover: boolean; // แสดงปกอัลบั้มแบบเบลอเป็นคำใบ้
}

export const DEFAULT_SETTINGS: Settings = { rounds: 10, seconds: 30, mode: "choice", blurCover: true };

export interface RoundView {
  index: number; // เริ่มที่ 1
  total: number;
  previewUrl: string;
  startsAt: number; // เวลาของ server (ms) ที่ทุกคนเริ่มเล่นเพลงพร้อมกัน
  endsAt: number;
  options: string[] | null; // ตัวเลือก (โหมด choice) — ไม่บอกว่าข้อไหนถูกจนกว่าจะเฉลย
  cover: string | null; // ปกอัลบั้มสำหรับแสดงแบบเบลอ (ถ้าเปิดไว้)
  answered: string[]; // id ของคนที่ตอบแล้ว (โหมด choice)
  correct: { id: string; points: number }[];
}

export interface RevealView {
  title: string;
  artists: string[];
  cover?: string;
  correctOption: number | null;
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
  | { t: "choose"; index: number }
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
  options: 4,
};
