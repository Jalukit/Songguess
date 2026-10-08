// จุดเข้าของ Worker: สร้างห้อง และส่งต่อ websocket ไปยัง Durable Object ของห้องนั้น
// (หน้าเว็บ React ถูกเสิร์ฟจาก static assets โดยอัตโนมัติ)

export { Room } from "./room.ts";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ตัด 0/O, 1/I ที่สับสนง่ายออก

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

function roomStub(env: Env, code: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      for (let i = 0; i < 5; i++) {
        const code = randomCode();
        const res = await roomStub(env, code).fetch(`https://room/init?code=${code}`, { method: "POST" });
        if (res.ok) return Response.json({ code });
      }
      return Response.json({ error: "สร้างห้องไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 503 });
    }

    const ws = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{4})\/ws$/);
    if (ws) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected websocket", { status: 426 });
      }
      const code = ws[1].toUpperCase();
      const target = new URL(request.url);
      target.searchParams.set("code", code);
      return roomStub(env, code).fetch(new Request(target, request));
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
