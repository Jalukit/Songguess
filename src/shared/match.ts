// ตรวจคำตอบแบบยืดหยุ่น: ไม่สนตัวพิมพ์เล็กใหญ่ ตัด (feat. …) / - Remastered ออก และยอมให้พิมพ์ผิดเล็กน้อย

export type MatchResult = "correct" | "close" | "wrong";

const VERSION_WORDS =
  /\b(feat|ft|featuring|with|remaster(ed)?|live|version|ver|edit|mix|remix|radio|acoustic|demo|mono|stereo|deluxe|bonus|explicit|clean|instrumental|from|original|soundtrack|ost)\b/i;

/** แปลงข้อความให้อยู่ในรูปมาตรฐานสำหรับเทียบกัน (ยังเก็บสระ/วรรณยุกต์ไทยไว้) */
export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** ตัวเลือกคำตอบที่ยอมรับได้จากชื่อเพลงหนึ่งชื่อ */
export function answerVariants(title: string): string[] {
  const out = new Set<string>();
  const add = (s: string) => {
    const n = normalize(s);
    if (n) out.add(n);
  };

  add(title);

  // ตัดวงเล็บทั้งหมด: "รักแรก (First Love) [Remastered]" -> "รักแรก"
  const noBrackets = title.replace(/\([^)]*\)|\[[^\]]*\]|（[^）]*）/g, " ");
  add(noBrackets);

  // ตัดส่วนหลังขีด: "Song - 2011 Remaster" -> "Song"
  const beforeDash = noBrackets.split(/\s[-–—]\s/)[0];
  add(beforeDash);

  // ตัด feat. ที่ไม่ได้อยู่ในวงเล็บ: "Song feat. X" -> "Song"
  add(beforeDash.replace(/\s(feat\.?|ft\.?|featuring)\s.*$/i, ""));

  // ชื่อในวงเล็บที่ไม่ใช่คำบอกเวอร์ชัน มักเป็นชื่ออีกภาษา: "ดาว (Star)" -> "star"
  for (const m of title.matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)) {
    const inner = m[1] ?? m[2] ?? "";
    if (!VERSION_WORDS.test(inner)) add(inner);
  }

  return [...out];
}

/** ระยะห่างของคำ (สลับตัวอักษรที่ติดกันนับเป็น 1 ครั้ง) */
function editDistance(a: string, b: string): number {
  const A = [...a];
  const B = [...b];
  const d = Array.from({ length: A.length + 1 }, (_, i) =>
    Array.from({ length: B.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= A.length; i++) {
    for (let j = 1; j <= B.length; j++) {
      const cost = A[i - 1] === B[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && A[i - 1] === B[j - 2] && A[i - 2] === B[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[A.length][B.length];
}

/** จำนวนตัวอักษรที่ยอมให้ผิดได้ ตามความยาวของคำตอบ */
function allowedTypos(length: number): number {
  if (length <= 3) return 0;
  if (length <= 6) return 1;
  if (length <= 12) return 2;
  return 3;
}

/** เทียบคำที่ผู้เล่นพิมพ์กับชื่อเพลงทุกชื่อที่ยอมรับ (เช่นชื่อจาก Spotify และจาก Deezer) */
export function checkAnswer(guess: string, titles: string[]): MatchResult {
  const g = normalize(guess).replace(/ /g, "");
  if (!g) return "wrong";

  let best: MatchResult = "wrong";
  for (const title of titles) {
    for (const variant of answerVariants(title)) {
      const v = variant.replace(/ /g, "");
      const len = [...v].length;
      const dist = editDistance(g, v);
      if (dist <= allowedTypos(len)) return "correct";
      const closeByTypos = dist <= allowedTypos(len) + 2 && len > 3;
      const closeByPrefix = [...g].length >= Math.max(3, len * 0.5) && v.startsWith(g);
      if (closeByTypos || closeByPrefix) best = "close";
    }
  }
  return best;
}
