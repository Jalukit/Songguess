import { useEffect, useState } from "react";
import { unlockAudio } from "./audio.ts";
import { RoomPage } from "./RoomPage.tsx";
import { navigate } from "./nav.ts";
import { LIMITS } from "../shared/protocol.ts";

function roomFromPath(): string | null {
  return location.pathname.match(/^\/r\/([A-Za-z0-9]{4})$/)?.[1].toUpperCase() ?? null;
}

export function App() {
  const [code, setCode] = useState(roomFromPath);
  const [name, setName] = useState(() => localStorage.getItem("sg:name") ?? "");
  const [ready, setReady] = useState(false); // ยืนยันชื่อแล้วหรือยัง (ต้องกดปุ่มเพื่อปลดล็อกเสียงด้วย)

  useEffect(() => {
    const onPop = () => {
      setCode(roomFromPath());
      setReady(false);
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  const saveName = (n: string) => {
    setName(n);
    localStorage.setItem("sg:name", n);
  };

  if (code && ready && name.trim()) {
    return <RoomPage key={code} code={code} name={name.trim()} />;
  }

  return <Home code={code} name={name} onName={saveName} onEnter={(c) => {
    unlockAudio();
    if (c !== code) navigate(`/r/${c}`);
    setReady(true);
  }} />;
}

function Home(props: {
  code: string | null;
  name: string;
  onName: (n: string) => void;
  onEnter: (code: string) => void;
}) {
  const [joinCode, setJoinCode] = useState(props.code ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasName = props.name.trim().length > 0;

  const create = async () => {
    unlockAudio();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      const data = (await res.json()) as { code?: string; error?: string };
      if (!data.code) throw new Error(data.error);
      props.onEnter(data.code);
    } catch (e) {
      setError((e as Error).message || "สร้างห้องไม่สำเร็จ");
      setBusy(false);
    }
  };

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const c = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(c)) return setError("รหัสห้องต้องมี 4 ตัวอักษร");
    props.onEnter(c);
  };

  return (
    <main className="home">
      <h1>
        🎵 Song<span>Guess</span>
      </h1>
      <p className="muted">ฟังเพลงแล้วทายชื่อให้เร็วที่สุดกับเพื่อน ๆ</p>

      <label className="field">
        ชื่อของคุณ
        <input
          value={props.name}
          maxLength={LIMITS.maxNameLength}
          placeholder="เช่น ต้น"
          onChange={(e) => props.onName(e.target.value)}
          autoFocus
        />
      </label>

      {props.code ? (
        <button className="primary" disabled={!hasName} onClick={() => props.onEnter(props.code!)}>
          เข้าห้อง {props.code}
        </button>
      ) : (
        <>
          <button className="primary" disabled={!hasName || busy} onClick={create}>
            {busy ? "กำลังสร้าง…" : "สร้างห้องใหม่"}
          </button>
          <div className="divider">หรือ</div>
          <form className="row" onSubmit={join}>
            <input
              className="code-input"
              value={joinCode}
              maxLength={4}
              placeholder="K7QX"
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            />
            <button disabled={!hasName}>Join</button>
          </form>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
