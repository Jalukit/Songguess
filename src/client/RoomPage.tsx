import { useEffect, useRef, useState } from "react";
import { audio, getVolume, setVolume } from "./audio.ts";
import { navigate } from "./nav.ts";
import { useRoom, useTicker, type GuessFeedback } from "./useRoom.ts";
import type { ClientMsg, PlayerView, RoomView } from "../shared/protocol.ts";

type Send = (msg: ClientMsg) => void;

export function RoomPage({ code, name }: { code: string; name: string }) {
  const { room, you, error, fatal, connected, feedback, send, serverNow } = useRoom(code, name);

  const leave = () => {
    send({ t: "leave" });
    audio.pause();
    navigate("/");
  };

  if (fatal) {
    return (
      <main className="home">
        <p className="error">{fatal}</p>
        <button className="primary" onClick={() => navigate("/")}>กลับหน้าแรก</button>
      </main>
    );
  }
  if (!room) return <main className="home muted">กำลังเชื่อมต่อห้อง {code}…</main>;

  const isHost = room.hostId === you;

  return (
    <div className="room">
      <header>
        <div className="code-box">
          <span className="muted">รหัสห้อง</span>
          <strong>{room.code}</strong>
          <CopyLink code={room.code} />
        </div>
        <div className="header-right">
          {!connected && <span className="badge warn">กำลังเชื่อมต่อใหม่…</span>}
          <Volume />
          <button className="ghost" onClick={leave}>ออกจากห้อง</button>
        </div>
      </header>

      {error && <div className="toast">{error}</div>}

      <div className="layout">
        <section className="main-panel">
          {room.phase === "lobby" && <Lobby room={room} isHost={isHost} send={send} error={error} />}
          {(room.phase === "loading" || room.phase === "playing" || room.phase === "reveal") && (
            <Game room={room} you={you} isHost={isHost} send={send} feedback={feedback} serverNow={serverNow} />
          )}
          {room.phase === "ended" && <Results room={room} you={you} isHost={isHost} send={send} />}
        </section>
        <Scoreboard room={room} you={you} />
      </div>
    </div>
  );
}

function CopyLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(`${location.origin}/r/${code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button className="ghost small" onClick={copy}>
      {copied ? "คัดลอกแล้ว ✓" : "คัดลอกลิงก์"}
    </button>
  );
}

function Volume() {
  const [v, setV] = useState(getVolume);
  return (
    <label className="volume" title="ระดับเสียง">
      🔊
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={v}
        onChange={(e) => {
          setV(Number(e.target.value));
          setVolume(Number(e.target.value));
        }}
      />
    </label>
  );
}

// ---------- Lobby ----------

function Lobby(props: { room: RoomView; isHost: boolean; send: Send; error: string | null }) {
  const { room, isHost, send, error } = props;
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  // ปลดสถานะ loading เมื่อ playlist เปลี่ยนหรือมี error กลับมา
  useEffect(() => setLoading(false), [room.playlist, error]);
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setLoading(false), 15_000);
    return () => clearTimeout(t);
  }, [loading]);

  if (!isHost) {
    return (
      <div className="card center">
        <h2>รอเจ้าของห้องเริ่มเกม…</h2>
        {room.playlist ? (
          <p>
            Playlist: <strong>{room.playlist.name}</strong> ({room.playlist.count} เพลง) · {room.settings.rounds} รอบ ·{" "}
            {room.settings.seconds} วินาที/รอบ
          </p>
        ) : (
          <p className="muted">ยังไม่ได้เลือก playlist</p>
        )}
        <p className="muted">ส่งรหัสห้อง <strong>{room.code}</strong> ให้เพื่อนเพื่อชวนมาเล่น</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>ตั้งค่าเกม</h2>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!url.trim()) return;
          setLoading(true);
          send({ t: "setPlaylist", url: url.trim() });
        }}
      >
        <input
          value={url}
          placeholder="วางลิงก์ playlist ของ Spotify หรือ Deezer"
          onChange={(e) => setUrl(e.target.value)}
        />
        <button disabled={loading}>{loading ? "กำลังโหลด…" : "โหลด"}</button>
      </form>
      <p className="hint">playlist ต้องตั้งเป็น public · เพลงที่หา preview ไม่เจอจะถูกข้ามอัตโนมัติ</p>

      {room.playlist && (
        <p className="playlist">
          ✅ <strong>{room.playlist.name}</strong> — {room.playlist.count} เพลง
        </p>
      )}

      <div className="settings">
        <label>
          จำนวนรอบ
          <select
            value={room.settings.rounds}
            onChange={(e) => send({ t: "settings", settings: { rounds: Number(e.target.value) } })}
          >
            {[5, 10, 15, 20, 30].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          เวลาต่อรอบ
          <select
            value={room.settings.seconds}
            onChange={(e) => send({ t: "settings", settings: { seconds: Number(e.target.value) } })}
          >
            {[10, 15, 20, 30].map((n) => (
              <option key={n} value={n}>{n} วินาที</option>
            ))}
          </select>
        </label>
      </div>

      <button className="primary big" disabled={!room.playlist} onClick={() => send({ t: "start" })}>
        เริ่มเกม ▶
      </button>
    </div>
  );
}

// ---------- Game ----------

function Game(props: {
  room: RoomView;
  you: string;
  isHost: boolean;
  send: Send;
  feedback: GuessFeedback | null;
  serverNow: () => number;
}) {
  const { room, you, isHost, send, feedback, serverNow } = props;
  const round = room.round;
  const [guess, setGuess] = useState("");
  const [blocked, setBlocked] = useState(false); // เบราว์เซอร์ไม่ยอมเล่นเสียงอัตโนมัติ
  const inputRef = useRef<HTMLInputElement>(null);
  useTicker(100);

  // เล่นเพลงให้ตรงกับเวลาของ server (ทุกคนได้ยินพร้อมกัน)
  const playAt = () => {
    if (!round) return;
    const offset = (serverNow() - round.startsAt) / 1000;
    audio.currentTime = Math.max(0, offset);
    audio.play().then(
      () => setBlocked(false),
      () => setBlocked(true),
    );
  };

  useEffect(() => {
    if (!round) return;
    audio.pause();
    audio.src = round.previewUrl;
    audio.load();
    setGuess("");
    const wait = round.startsAt - serverNow();
    const t = setTimeout(() => {
      playAt();
      inputRef.current?.focus();
    }, Math.max(0, wait));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.previewUrl, round?.startsAt]);

  useEffect(() => () => audio.pause(), []);

  if (room.phase === "loading" || !round) {
    return (
      <div className="card center">
        <div className="spinner" />
        <p className="muted">กำลังหาเพลงถัดไป…</p>
      </div>
    );
  }

  const now = serverNow();
  const countdown = Math.ceil((round.startsAt - now) / 1000);
  const total = round.endsAt - round.startsAt;
  const left = Math.max(0, round.endsAt - now);
  const youCorrect = round.correct.find((c) => c.id === you);
  const showFeedback = feedback && Date.now() - feedback.at < 2500 && feedback.result !== "correct";

  return (
    <div className="card">
      <div className="round-head">
        <span className="badge">รอบ {round.index}/{round.total}</span>
        {room.phase === "playing" && countdown <= 0 && <span className="time">{Math.ceil(left / 1000)} วิ</span>}
      </div>

      {room.phase === "playing" && (
        <div className="progress">
          <div style={{ width: `${countdown > 0 ? 100 : (left / total) * 100}%` }} />
        </div>
      )}

      {room.phase === "playing" && countdown > 0 && <div className="countdown">{countdown}</div>}

      {room.phase === "playing" && countdown <= 0 && (
        <>
          <div className="equalizer" aria-hidden>
            <i /><i /><i /><i /><i />
          </div>
          {youCorrect ? (
            <p className="correct">ถูกต้อง! +{youCorrect.points} คะแนน 🎉</p>
          ) : (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                if (!guess.trim()) return;
                send({ t: "guess", text: guess });
                setGuess("");
              }}
            >
              <input
                ref={inputRef}
                value={guess}
                placeholder="พิมพ์ชื่อเพลง แล้วกด Enter"
                onChange={(e) => setGuess(e.target.value)}
                autoComplete="off"
              />
              <button>ตอบ</button>
            </form>
          )}
          {showFeedback && (
            <p className={feedback.result === "close" ? "close" : "wrong"}>
              {feedback.result === "close" ? `"${feedback.text}" — เกือบแล้ว!` : `"${feedback.text}" ยังไม่ถูก`}
            </p>
          )}
          {blocked && (
            <button className="primary" onClick={playAt}>🔊 แตะเพื่อเปิดเสียง</button>
          )}
          {isHost && (
            <button className="ghost small skip" onClick={() => send({ t: "skip" })}>ข้ามเพลงนี้</button>
          )}
        </>
      )}

      {room.phase === "reveal" && room.reveal && (
        <div className="reveal">
          {room.reveal.cover && <img src={room.reveal.cover} alt="" />}
          <div>
            <p className="muted">เพลงนี้คือ</p>
            <h2>{room.reveal.title}</h2>
            <p>{room.reveal.artists.join(", ")}</p>
            <p className="muted">
              {round.correct.length === 0
                ? "ไม่มีใครตอบถูก 😅"
                : `ตอบถูก ${round.correct.length} คน`}
              {room.nextAt && ` · ${round.index < round.total ? "รอบถัดไป" : "สรุปผล"}ใน ${Math.max(0, Math.ceil((room.nextAt - now) / 1000))} วิ`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Results / Scoreboard ----------

function ranked(players: PlayerView[]) {
  return [...players].sort((a, b) => b.score - a.score);
}

function Results({ room, you, isHost, send }: { room: RoomView; you: string; isHost: boolean; send: Send }) {
  const list = ranked(room.players);
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <div className="card center">
      <h2>จบเกม!</h2>
      <ol className="podium">
        {list.map((p, i) => (
          <li key={p.id} className={p.id === you ? "me" : ""}>
            <span>{medals[i] ?? `${i + 1}.`}</span>
            <span className="name">{p.name}</span>
            <strong>{p.score}</strong>
          </li>
        ))}
      </ol>
      {isHost ? (
        <button className="primary big" onClick={() => send({ t: "backToLobby" })}>เล่นอีกครั้ง</button>
      ) : (
        <p className="muted">รอเจ้าของห้องเริ่มเกมใหม่…</p>
      )}
    </div>
  );
}

function Scoreboard({ room, you }: { room: RoomView; you: string }) {
  const correct = new Map(room.round?.correct.map((c) => [c.id, c.points]));
  return (
    <aside className="card scoreboard">
      <h3>ผู้เล่น ({room.players.length})</h3>
      <ul>
        {ranked(room.players).map((p) => (
          <li key={p.id} className={[p.id === you && "me", !p.connected && "offline"].filter(Boolean).join(" ")}>
            <span className="name">
              {p.id === room.hostId && "👑 "}
              {p.name}
              {p.id === you && " (คุณ)"}
            </span>
            {correct.has(p.id) && <span className="plus">+{correct.get(p.id)}</span>}
            <strong>{p.score}</strong>
          </li>
        ))}
      </ul>
    </aside>
  );
}
