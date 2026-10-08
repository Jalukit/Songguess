// 1 ห้อง = 1 Durable Object ถือ state และ websocket ของทุกคนในห้อง
// ใช้ WebSocket Hibernation: object หลับได้ระหว่างที่ไม่มีใครส่งอะไร จึงเก็บ state ไว้ใน storage
// ของ object เอง (ไม่ใช่ database ถาวร — ลบทิ้งทั้งหมดเมื่อทุกคนออกจากห้อง)

import { DurableObject } from "cloudflare:workers";
import { checkAnswer } from "../shared/match.ts";
import {
  LIMITS,
  type ClientMsg,
  type Phase,
  type RevealView,
  type RoomView,
  type ServerMsg,
  type Settings,
} from "../shared/protocol.ts";
import { loadPlaylist, resolvePreview, UserError, type ResolvedTrack, type Track } from "./music.ts";

const COUNTDOWN_MS = 2_500; // เวลาให้ทุกเครื่องโหลดเพลงก่อนเริ่มพร้อมกัน
const REVEAL_MS = 6_000;
const EMPTY_ROOM_TTL_MS = 3 * 60_000; // ห้องว่างนานเท่านี้แล้วลบทิ้ง
const MAX_SKIPS_PER_ROUND = 6; // หา preview ไม่เจอติดกันกี่เพลงถึงยอมแพ้

interface Player {
  id: string;
  name: string;
  score: number;
}

interface State {
  code: string;
  hostId: string | null;
  phase: Phase;
  players: Player[];
  settings: Settings;
  playlist: { name: string; count: number } | null;
  queuePos: number; // ตำแหน่งเพลงถัดไปใน tracks ที่สุ่มลำดับแล้ว
  roundIndex: number;
  roundTotal: number;
  current: (ResolvedTrack & { startsAt: number; endsAt: number }) | null;
  correct: { id: string; points: number }[];
  reveal: RevealView | null;
  deadline: number | null; // เวลาที่ต้องเปลี่ยน phase ถัดไป
  emptySince: number | null;
}

interface Attachment {
  playerId: string;
}

export class Room extends DurableObject<Env> {
  private state: State | null = null;
  private tracks: Track[] | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<State>("state")) ?? null;
    });
  }

  // ---------- HTTP / websocket ----------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/init") {
      if (this.state) return new Response("taken", { status: 409 });
      await this.create(url.searchParams.get("code")!);
      return new Response("ok");
    }

    const playerId = url.searchParams.get("playerId") ?? "";
    const name = (url.searchParams.get("name") ?? "").trim().slice(0, LIMITS.maxNameLength);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    const reject = (message: string) => {
      server.send(JSON.stringify({ t: "error", message } satisfies ServerMsg));
      server.close(4000, message);
      return new Response(null, { status: 101, webSocket: client });
    };

    const s = this.state;
    if (!s) return reject("ไม่พบห้องนี้ (อาจหมดอายุแล้ว)");
    if (!/^[\w-]{8,64}$/.test(playerId)) return reject("playerId ไม่ถูกต้อง");
    if (!name) return reject("กรุณาใส่ชื่อ");

    // ถ้าคนเดิมเปิดหลายแท็บ ปิดอันเก่า
    for (const ws of this.socketsOf(playerId)) ws.close(4001, "เปิดห้องนี้ในแท็บอื่นแล้ว");

    let player = s.players.find((p) => p.id === playerId);
    if (!player) {
      if (s.players.length >= LIMITS.maxPlayers) return reject("ห้องเต็มแล้ว");
      player = { id: playerId, name, score: 0 };
      s.players.push(player);
    } else {
      player.name = name;
    }
    if (!s.hostId || !this.isConnected(s.hostId)) s.hostId = playerId;
    s.emptySince = null;

    server.serializeAttachment({ playerId } satisfies Attachment);
    await this.save();
    await this.schedule();
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const s = this.state;
    const { playerId } = ws.deserializeAttachment() as Attachment;
    if (!s || typeof raw !== "string") return;

    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const isHost = s.hostId === playerId;
    const hostOnly = () => {
      if (!isHost) this.send(ws, { t: "error", message: "เฉพาะเจ้าของห้องเท่านั้น" });
      return isHost;
    };

    try {
      switch (msg.t) {
        case "guess":
          return await this.guess(ws, playerId, String(msg.text ?? "").slice(0, 200));

        case "setPlaylist": {
          if (!hostOnly() || s.phase !== "lobby") return;
          const playlist = await loadPlaylist(String(msg.url ?? ""), this.env);
          if (playlist.tracks.length === 0) throw new UserError("playlist นี้ไม่มีเพลง");
          this.tracks = shuffle(playlist.tracks);
          await this.ctx.storage.put("tracks", this.tracks);
          s.playlist = { name: playlist.name, count: playlist.tracks.length };
          s.queuePos = 0;
          break;
        }

        case "settings": {
          if (!hostOnly() || s.phase !== "lobby") return;
          const { rounds, seconds } = msg.settings ?? {};
          if (typeof rounds === "number") s.settings.rounds = clamp(rounds, LIMITS.rounds);
          if (typeof seconds === "number") s.settings.seconds = clamp(seconds, LIMITS.seconds);
          break;
        }

        case "start":
          if (!hostOnly() || s.phase !== "lobby") return;
          if (!s.playlist) throw new UserError("ยังไม่ได้เลือก playlist");
          for (const p of s.players) p.score = 0;
          s.roundIndex = 0;
          s.roundTotal = Math.min(s.settings.rounds, s.playlist.count);
          await this.nextRound();
          break;

        case "skip":
          if (!hostOnly() || s.phase !== "playing") return;
          this.endRound();
          break;

        case "backToLobby":
          if (!hostOnly() || s.phase !== "ended") return;
          s.phase = "lobby";
          s.reveal = null;
          s.deadline = null;
          break;

        case "leave":
          s.players = s.players.filter((p) => p.id !== playerId);
          ws.close(1000, "left");
          this.afterDisconnect();
          break;

        default:
          return;
      }
    } catch (err) {
      const message = err instanceof UserError ? err.message : "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
      if (!(err instanceof UserError)) console.error(err);
      this.send(ws, { t: "error", message });
      return;
    }

    await this.save();
    await this.schedule();
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket) {
    ws.close();
    this.afterDisconnect();
    await this.save();
    await this.schedule();
    this.broadcast();
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }

  // ตัวจับเวลาของเกม (หมดเวลารอบ / เริ่มรอบถัดไป / ลบห้องว่าง)
  async alarm() {
    const s = this.state;
    if (!s) return;
    const now = Date.now();

    if (s.emptySince !== null && now >= s.emptySince + EMPTY_ROOM_TTL_MS) {
      await this.ctx.storage.deleteAll();
      this.state = null;
      this.tracks = null;
      return;
    }

    if (s.deadline !== null && now >= s.deadline - 50) {
      if (s.phase === "playing") this.endRound();
      else if (s.phase === "reveal") await this.nextRound();
    }

    await this.save();
    await this.schedule();
    this.broadcast();
  }

  // ---------- game logic ----------

  private async create(code: string) {
    this.state = {
      code,
      hostId: null,
      phase: "lobby",
      players: [],
      settings: { rounds: 10, seconds: 30 },
      playlist: null,
      queuePos: 0,
      roundIndex: 0,
      roundTotal: 0,
      current: null,
      correct: [],
      reveal: null,
      deadline: null,
      emptySince: Date.now(),
    };
    await this.save();
    await this.schedule();
  }

  private async nextRound() {
    const s = this.state!;
    if (s.roundIndex >= s.roundTotal) return this.finish();

    s.phase = "loading";
    s.reveal = null;
    this.broadcast();

    const tracks = await this.getTracks();
    let resolved: ResolvedTrack | null = null;
    for (let tries = 0; !resolved && tries < MAX_SKIPS_PER_ROUND && s.queuePos < tracks.length; tries++) {
      resolved = await resolvePreview(tracks[s.queuePos++]);
    }
    if (!resolved) {
      // หาเพลงที่มี preview ไม่ได้แล้ว จบเกมเท่าที่เล่นไป
      s.roundTotal = s.roundIndex;
      return this.finish();
    }

    // เล่นเพลงวนจนหมด playlist แล้ว สุ่มลำดับใหม่
    if (s.queuePos >= tracks.length) {
      this.tracks = shuffle(tracks);
      s.queuePos = 0;
      await this.ctx.storage.put("tracks", this.tracks);
    }

    const startsAt = Date.now() + COUNTDOWN_MS;
    s.roundIndex++;
    s.current = { ...resolved, startsAt, endsAt: startsAt + s.settings.seconds * 1000 };
    s.correct = [];
    s.phase = "playing";
    s.deadline = s.current.endsAt;
  }

  private endRound() {
    const s = this.state!;
    const cur = s.current!;
    s.phase = "reveal";
    s.reveal = { title: cur.title, artists: cur.artists, cover: cur.cover };
    s.deadline = s.roundIndex >= s.roundTotal ? Date.now() + REVEAL_MS / 2 : Date.now() + REVEAL_MS;
  }

  private finish() {
    const s = this.state!;
    s.phase = "ended";
    s.current = null;
    s.deadline = null;
  }

  private async guess(ws: WebSocket, playerId: string, text: string) {
    const s = this.state!;
    const cur = s.current;
    const now = Date.now();
    if (s.phase !== "playing" || !cur || now < cur.startsAt) return;
    if (s.correct.some((c) => c.id === playerId)) return;

    const result = checkAnswer(text, [cur.title, cur.altTitle]);
    if (result !== "correct") {
      this.send(ws, { t: "guessResult", result, text });
      return;
    }

    // ตอบเร็วได้คะแนนมาก (1000 → 300) + โบนัสคนแรก
    const elapsed = Math.min(1, (now - cur.startsAt) / (cur.endsAt - cur.startsAt));
    const points = Math.round(1000 - 700 * elapsed) + (s.correct.length === 0 ? 100 : 0);
    const player = s.players.find((p) => p.id === playerId);
    if (!player) return;
    player.score += points;
    s.correct.push({ id: playerId, points });
    this.send(ws, { t: "guessResult", result, points, text });

    const connected = s.players.filter((p) => this.isConnected(p.id));
    if (connected.every((p) => s.correct.some((c) => c.id === p.id))) this.endRound();

    await this.save();
    await this.schedule();
    this.broadcast();
  }

  private afterDisconnect() {
    const s = this.state;
    if (!s) return;
    if (s.hostId && !this.isConnected(s.hostId)) {
      s.hostId = s.players.find((p) => this.isConnected(p.id))?.id ?? s.hostId;
    }
    if (this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN).length === 0) {
      s.emptySince ??= Date.now();
    }
  }

  // ---------- helpers ----------

  private async getTracks(): Promise<Track[]> {
    this.tracks ??= (await this.ctx.storage.get<Track[]>("tracks")) ?? [];
    return this.tracks;
  }

  private async save() {
    if (this.state) await this.ctx.storage.put("state", this.state);
  }

  private async schedule() {
    const s = this.state;
    if (!s) return;
    const times = [s.deadline, s.emptySince !== null ? s.emptySince + EMPTY_ROOM_TTL_MS : null].filter(
      (t): t is number => t !== null,
    );
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times));
    else await this.ctx.storage.deleteAlarm();
  }

  private socketsOf(playerId: string): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter(
        (ws) =>
          ws.readyState === WebSocket.OPEN &&
          (ws.deserializeAttachment() as Attachment | null)?.playerId === playerId,
      );
  }

  private isConnected(playerId: string) {
    return this.socketsOf(playerId).length > 0;
  }

  private view(): RoomView {
    const s = this.state!;
    const playing = (s.phase === "playing" || s.phase === "reveal") && s.current;
    return {
      code: s.code,
      hostId: s.hostId,
      phase: s.phase,
      players: s.players.map((p) => ({ ...p, connected: this.isConnected(p.id) })),
      settings: s.settings,
      playlist: s.playlist,
      // ไม่ส่งชื่อเพลงไปตอนกำลังเล่น ส่งแค่ URL ของเสียง
      round: playing
        ? {
            index: s.roundIndex,
            total: s.roundTotal,
            previewUrl: s.current!.previewUrl,
            startsAt: s.current!.startsAt,
            endsAt: s.current!.endsAt,
            correct: s.correct,
          }
        : null,
      reveal: s.reveal,
      nextAt: s.phase === "reveal" ? s.deadline : null,
      serverNow: Date.now(),
    };
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket ปิดไปแล้ว
    }
  }

  private broadcast() {
    if (!this.state) return;
    const room = this.view();
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att && ws.readyState === WebSocket.OPEN) this.send(ws, { t: "state", room, you: att.playerId });
    }
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function clamp(n: number, { min, max }: { min: number; max: number }) {
  return Math.max(min, Math.min(max, Math.round(n)));
}
