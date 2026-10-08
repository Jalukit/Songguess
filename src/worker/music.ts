// ดึงรายชื่อเพลงจาก playlist (Spotify หรือ Deezer) และหา preview 30 วินาทีจาก Deezer

import { normalize } from "../shared/match.ts";

export interface Track {
  title: string;
  artists: string[];
  cover?: string;
  isrc?: string;
  deezerId?: number;
}

export interface Playlist {
  name: string;
  tracks: Track[];
}

export interface ResolvedTrack extends Track {
  previewUrl: string;
  altTitle: string; // ชื่อเพลงฝั่ง Deezer ใช้เป็นคำตอบสำรอง
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
  const ok = (t: DeezerTrack | null): t is DeezerTrack => !!t && !!t.preview && t.readable !== false;
  const done = (t: DeezerTrack): ResolvedTrack => ({
    ...track,
    cover: track.cover ?? t.album?.cover_big,
    previewUrl: t.preview!,
    altTitle: t.title_short || t.title,
  });

  if (track.deezerId) {
    const t = await deezer<DeezerTrack>(`/track/${track.deezerId}`);
    return ok(t) ? done(t) : null;
  }

  if (track.isrc) {
    const t = await deezer<DeezerTrack>(`/track/isrc:${track.isrc}`);
    if (ok(t)) return done(t);
  }

  const artist = track.artists[0] ?? "";
  const queries = [`artist:"${artist}" track:"${track.title}"`, `${track.title} ${artist}`];
  const wantTitle = normalize(track.title);
  const wantArtist = normalize(artist);
  for (const q of queries) {
    const res = await deezer<{ data: DeezerTrack[] }>(`/search?q=${encodeURIComponent(q)}&limit=10`);
    const candidates = (res?.data ?? []).filter(ok);
    const best =
      candidates.find((t) => normalize(t.artist.name) === wantArtist && normalize(t.title).startsWith(wantTitle)) ??
      candidates.find((t) => normalize(t.artist.name) === wantArtist);
    if (best) return done(best);
  }
  return null;
}
