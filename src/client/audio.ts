// ใช้ <audio> ตัวเดียวทั้งแอป แล้ว "ปลดล็อก" ตอนผู้ใช้กดปุ่มครั้งแรก
// (Safari/iOS ไม่ยอมให้เล่นเสียงถ้าไม่เคยเรียก play() ระหว่างที่ผู้ใช้กดอะไรสักอย่าง)

export const audio = new Audio();
audio.preload = "auto";

const SILENT =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

let unlocked = false;

export function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  audio.src = SILENT;
  audio.play().catch(() => {
    unlocked = false;
  });
}

export function getVolume(): number {
  const v = Number(localStorage.getItem("sg:volume"));
  return Number.isFinite(v) && localStorage.getItem("sg:volume") !== null ? v : 0.8;
}

export function setVolume(v: number) {
  audio.volume = v;
  localStorage.setItem("sg:volume", String(v));
}

audio.volume = getVolume();
