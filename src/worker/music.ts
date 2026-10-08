// ดึงรายชื่อเพลงจาก playlist (Spotify หรือ Deezer) และหา preview 30 วินาที
// Spotify: อ่านจากหน้า embed สาธารณะก่อน (ไม่ต้องใช้คีย์ และมี preview ของ Spotify มาด้วย)
//          ถ้าไม่ได้ค่อยใช้ Web API แบบ client credentials (ถ้าตั้งคีย์ไว้)
// เพลงที่ไม่มี preview จาก Spotify จะไปค้นหาจาก Deezer แทน

import { answerVariants, normalize } from "../shared/match.ts";

export interface Track {
  title: string;
  artists: string[];
  cover?: string;
  isrc?: string;
  deezerId?: number;
  spotifyId?: string;
  spotifyPreview?: string;
}

export interface Playlist {
  name: string;
  tracks: Track[];
}

export interface ResolvedTrack extends Track {
  previewUrl: string;
  altTitle: string; // ชื่อเพลงจากแหล่งที่ได้ preview มา (เช่น Deezer) ใช้เป็นคำตอบสำรอง
}

export class UserError extends Error {}

const MAX_TRACKS = 300;

export async function loadPlaylist(input: string, env: Env): Promise<Playlist> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    const m = input.trim().match(/^spotify:playlist:([A-Za-z0-9]+)$/);
    if (m) return loadSpotify(m[1], env);
    throw new UserError("ลิงก์ไม่ถูกต้อง");
  }

  if (url.hostname.endsWith("spotify.com")) {
    const id = url.pathname.match(/\/playlist\/([A-Za-z0-9]+)/)?.[1];
    if (!id) throw new UserError("ไม่พบ playlist id ในลิงก์ Spotify");
    return loadSpotify(id, env);
  }

  if (url.hostname.endsWith("deezer.com") || url.hostname.endsWith("deezer.page.link")) {
    let path = url.pathname;
    // ลิงก์แชร์แบบสั้น (link.deezer.com/s/...) ต้องตาม redirect ก่อน
    if (!/\/playlist\/\d+/.test(path)) {
      const res = await fetch(url.toString(), { redirect: "follow" });
      path = new URL(res.url).pathname;
    }
    const id = path.match(/\/playlist\/(\d+)/)?.[1];
    if (!id) throw new UserError("ไม่พบ playlist id ในลิงก์ Deezer");
    return loadDeezer(id);
  }

  throw new UserError("รองรับเฉพาะลิงก์ playlist ของ Spotify หรือ Deezer");
}

// ---------- Spotify (client credentials ไม่มีใครต้องล็อกอิน) ----------

let spotifyToken: { value: string; expiresAt: number } | null = null;

async function getSpotifyToken(env: Env): Promise<string> {
  if (spotifyToken && spotifyToken.expiresAt > Date.now() + 60_000) return spotifyToken.value;
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
    throw new UserError("server ยังไม่ได้ตั้งค่า Spotify — ใช้ลิงก์ playlist ของ Deezer แทนได้");
  }
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new UserError(`ขอ token จาก Spotify ไม่สำเร็จ (${res.status})`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  spotifyToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

interface SpotifyTrack {
  type?: string;
  is_local?: boolean;
  name: string;
  artists: { name: string }[];
  album?: { images?: { url: string }[] };
  external_ids?: { isrc?: string };
}

async function loadSpotify(id: string, env: Env): Promise<Playlist> {
  const embed = await loadSpotifyEmbed(id).catch((err) => {
    console.warn("spotify embed failed", err);
    return null;
  });
  if (embed?.tracks.length) return embed;
  if (env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET) return loadSpotifyApi(id, env);
  throw new UserError("ดึง playlist จาก Spotify ไม่ได้ (ต้องตั้งเป็น public) — ลองใช้ลิงก์ Deezer แทน");
}

interface EmbedTrack {
  uri: string;
  title: string;
  subtitle: string;
  entityType?: string;
  audioPreview?: { url?: string } | null;
}

/**
 * อ่านหน้า embed (open.spotify.com/embed/playlist/…) ที่ Spotify ให้เว็บอื่นแปะเครื่องเล่น
 * ไม่ใช่ API ทางการ ถ้า Spotify เปลี่ยนหน้าตา ส่วนนี้จะพังได้ จึงมี Web API + Deezer เป็นทางสำรอง
 * ข้อจำกัด: ได้เพลงสูงสุด 100 เพลงแรกของ playlist
 */
async function loadSpotifyEmbed(id: string): Promise<Playlist | null> {
  const res = await fetch(`https://open.spotify.com/embed/playlist/${id}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SongGuess)", "Accept-Language": "en" },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const json = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!json) return null;
  const entity = JSON.parse(json)?.props?.pageProps?.state?.data?.entity as
    | { name?: string; title?: string; trackList?: EmbedTrack[] }
    | undefined;
  if (!entity?.trackList) return null;

  const tracks: Track[] = entity.trackList
    .filter((t) => (t.entityType ?? "track") === "track" && t.title)
    .map((t) => ({
      title: t.title,
      artists: t.subtitle.split(/,\s*/).filter(Boolean),
      spotifyId: t.uri.split(":").pop(),
      spotifyPreview: t.audioPreview?.url || undefined,
    }));
  return { name: entity.name ?? entity.title ?? "Spotify playlist", tracks };
}

/** Web API แบบ client credentials — ได้ทุกเพลง แต่ไม่มี preview (ต้องไปหาจาก Deezer) */
async function loadSpotifyApi(id: string, env: Env): Promise<Playlist> {
  const token = await getSpotifyToken(env);
  const get = (path: string) =>
    fetch(`https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });

  const meta = await get(`/playlists/${id}?fields=name`);
  if (meta.status === 404) throw new UserError("ไม่พบ playlist (ต้องตั้งเป็น public)");
  if (!meta.ok) throw new UserError(`Spotify ตอบกลับ ${meta.status} — ลองใช้ลิงก์ Deezer แทน`);
  const { name } = (await meta.json()) as { name: string };

  // Spotify เปลี่ยน endpoint จาก /tracks เป็น /items ปี 2026 จึงลองทั้งสองแบบ
  let endpoint = "items";
  const tracks: Track[] = [];
  for (let offset = 0; tracks.length < MAX_TRACKS && offset < 1000; offset += 100) {
    let res = await get(`/playlists/${id}/${endpoint}?limit=100&offset=${offset}`);
    if (res.status === 404 && endpoint === "items" && offset === 0) {
      endpoint = "tracks";
      res = await get(`/playlists/${id}/${endpoint}?limit=100&offset=${offset}`);
    }
    if (!res.ok) throw new UserError(`ดึงเพลงจาก Spotify ไม่สำเร็จ (${res.status})`);
    const page = (await res.json()) as {
      items: { item?: SpotifyTrack | null; track?: SpotifyTrack | null }[];
      next: string | null;
    };
    for (const it of page.items) {
      const t = it.item ?? it.track;
      if (!t || t.is_local || (t.type && t.type !== "track")) continue;
      tracks.push({
        title: t.name,
        artists: t.artists.map((a) => a.name),
        cover: t.album?.images?.[0]?.url,
        isrc: t.external_ids?.isrc,
      });
    }
    if (!page.next) break;
  }
  return { name, tracks };
}

// ---------- Deezer (API สาธารณะ ไม่ต้องใช้ key) ----------

interface DeezerTrack {
  id: number;
  title: string;
  title_short?: string;
  preview?: string;
  readable?: boolean;
  artist: { name: string };
  album?: { cover_big?: string; cover_medium?: string };
  error?: unknown;
}

async function deezer<T>(path: string): Promise<T | null> {
  const res = await fetch(`https://api.deezer.com${path}`);
  if (!res.ok) return null;
  const data = (await res.json()) as T & { error?: unknown };
  return data.error ? null : data;
}

async function loadDeezer(id: string): Promise<Playlist> {
  const meta = await deezer<{ title: string }>(`/playlist/${id}`);
  if (!meta) throw new UserError("ไม่พบ playlist ของ Deezer (ต้องตั้งเป็น public)");
  const list = await deezer<{ data: DeezerTrack[] }>(`/playlist/${id}/tracks?limit=${MAX_TRACKS}`);
  const tracks = (list?.data ?? []).map((t) => ({
    title: t.title_short || t.title,
    artists: [t.artist.name],
    cover: t.album?.cover_big,
    deezerId: t.id,
  }));
  return { name: meta.title, tracks };
}

/**
 * หา preview ของเพลงตอนเริ่มรอบ (URL ของ Deezer มีวันหมดอายุ จึงไม่ดึงล่วงหน้า)
 * คืน null ถ้าหาไม่เจอ ให้ข้ามเพลงนั้นไป
 */
export async function resolvePreview(track: Track): Promise<ResolvedTrack | null> {
  if (track.spotifyPreview) {
    return {
      ...track,
      cover: track.cover ?? (await spotifyCover(track.spotifyId)),
      previewUrl: track.spotifyPreview,
      altTitle: track.title,
    };
  }

  const ok = (t: DeezerTrack | null): t is DeezerTrack => !!t && !!t.preview && t.readable !== false;
  const done = (t: DeezerTrack): ResolvedTrack => ({
    ...track,
    cover: track.cover ?? t.album?.cover_big,
    previewUrl: t.preview!,
    altTitle: t.title_short || t.title,
  });

  if (track.deezerId) {
    const t = await deezer<DeezerTrack>(`/track/${track.deezerId}`);
    if (ok(t)) return done(t);
    // playlist เก่ามักชี้ไปที่ track id ที่ค่ายลบไปแล้ว แต่ยังมีเวอร์ชันใหม่ที่เล่นได้ → ค้นหาด้วยชื่อแทน
  }

  if (track.isrc) {
    const t = await deezer<DeezerTrack>(`/track/isrc:${track.isrc}`);
    if (ok(t)) return done(t);
  }

  // ชื่อศิลปินบางทีเป็น "bodyslam,Potato,ดา เอ็นโดรฟิน" รวมกันมา
  const artists = track.artists.flatMap((a) => a.split(/\s*[,&]\s*/)).filter(Boolean);
  const artist = artists[0] ?? "";
  const title = baseTitle(track.title);
  const wantTitles = new Set(titleKeys(track.title));
  const wantArtists = artists.map(compact).filter(Boolean);

  // "Room39" = "Room 39", "Justin" ≈ "Justin Mari"
  const artistMatches = (t: DeezerTrack) => {
    const got = compact(t.artist.name);
    return wantArtists.some((a) => got === a || got.includes(a) || a.includes(got));
  };
  // "Alright" = "มันเป็นใคร (Alright)", "I'm Sorry สีดา" = "I'm Sorry (สีดา)"
  const titleMatches = (t: DeezerTrack) => titleKeys(t.title).some((k) => wantTitles.has(k));

  // ชื่อหลักแบบสั้น เช่น "ความจริง-Truth" → "ความจริง" ใช้ค้นเมื่อชื่อเต็มค้นไม่เจอ
  const [full, ...others] = answerVariants(track.title);
  const short = others.find((v) => v !== full) ?? title;
  const queries = [
    ...new Set([`artist:"${artist}" track:"${title}"`, `${title} ${artist}`, `${short} ${artist}`, title]),
  ];
  for (const q of queries) {
    const res = await deezer<{ data: DeezerTrack[] }>(`/search?q=${encodeURIComponent(q)}&limit=15`);
    const candidates = (res?.data ?? []).filter(ok);
    const best = candidates.find((t) => artistMatches(t) && titleMatches(t));
    if (best) return done(best);
  }
  return null;
}

/** ปกอัลบั้มของเพลงจาก oEmbed ของ Spotify (ทางการ ไม่ต้องใช้คีย์) — หาไม่ได้ก็ไม่เป็นไร */
async function spotifyCover(id: string | undefined): Promise<string | undefined> {
  if (!id) return;
  try {
    const res = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${id}`);
    if (!res.ok) return;
    return ((await res.json()) as { thumbnail_url?: string }).thumbnail_url;
  } catch {
    return;
  }
}

/** ตัดวงเล็บและส่วนหลังขีดออก: `เจ็บที่ยังรู้สึก (เพลงประกอบซีรีส์ "U-Prince")` → `เจ็บที่ยังรู้สึก` */
function baseTitle(title: string): string {
  const t = title.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").split(/\s[-–—]\s/)[0].trim();
  return t || title;
}

function compact(s: string): string {
  return normalize(s).replace(/ /g, "");
}

/** ทุกชื่อที่ใช้เรียกเพลงนี้ได้ (ชื่อเต็ม, ชื่อไม่มีวงเล็บ, ชื่อในวงเล็บ) แบบไม่มีช่องว่าง */
function titleKeys(title: string): string[] {
  return answerVariants(title).map((v) => v.replace(/ /g, ""));
}
