# 🎵 SongGuess

เกมทายชื่อเพลงกับเพื่อนแบบ realtime โดยเจ้าของห้องวางลิงก์ playlist แล้วทุกคนจะได้ฟังเพลงพร้อมกันและแข่งกันพิมพ์ชื่อเพลง ใครตอบถูกเร็วกว่าก็ได้คะแนนมากกว่า

- **หน้าเว็บ**: React + Vite
- **Realtime server**: Cloudflare Worker + Durable Object (1 ห้อง = 1 object) ไม่มี database
- **เพลง**: ดึงรายชื่อจาก playlist ของ Spotify (ใช้ client credentials) หรือ Deezer และใช้ preview 30 วินาทีจาก Deezer

## รันบนเครื่อง

```bash
npm install
cp .dev.vars.example .dev.vars   # ใส่ SPOTIFY_CLIENT_ID / SECRET (ไม่ใส่ก็ได้ ถ้าใช้แต่ลิงก์ Deezer)
npm run dev                      # http://localhost:5173
```

ถ้าจะทดสอบหลายคนบนเครื่องเดียว ให้เปิดหลายแท็บ เพราะแต่ละแท็บนับเป็นผู้เล่นคนละคน

```bash
npm test          # เทสต์ระบบตรวจคำตอบ
npm run typecheck
```

## ตั้งค่า Spotify

1. สร้างแอปที่ https://developer.spotify.com/dashboard (ไม่ต้องตั้ง redirect URI จริงจัง ใส่ `http://127.0.0.1:5173` ไปก็ได้)
2. คัดลอก Client ID และ Client Secret ไปใส่ใน `.dev.vars`
3. playlist ต้องตั้งเป็น **public**

> Spotify เปลี่ยนกฎของแอปใน Development Mode ช่วงต้นปี 2026 ถ้าโหลด playlist ของ Spotify แล้วขึ้น error 403 ให้ใช้ลิงก์ playlist ของ **Deezer** แทน
> (เช่น `https://www.deezer.com/playlist/3155776842`) ลิงก์ Deezer ใช้ได้เลยโดยไม่ต้องมีคีย์ และ server จะหา preview ได้แน่นอน

## Deploy ขึ้น Cloudflare (ฟรี)

```bash
npx wrangler login
npx wrangler secret put SPOTIFY_CLIENT_ID
npx wrangler secret put SPOTIFY_CLIENT_SECRET
npm run deploy
```

คำสั่งนี้จะได้ URL แบบ `https://songguess.<account>.workers.dev` ซึ่งเสิร์ฟทั้งหน้าเว็บและ websocket จาก Worker ตัวเดียว

## โครงสร้าง

```
src/
  shared/protocol.ts   รูปแบบข้อความระหว่าง client กับ server
  shared/match.ts      ตรวจคำตอบแบบยืดหยุ่น (ตัด feat./Remastered, ยอมให้พิมพ์ผิด, รองรับภาษาไทย)
  worker/index.ts      API สร้างห้อง และส่ง websocket ต่อให้ห้อง
  worker/room.ts       Durable Object ของห้อง เก็บผู้เล่น/รอบ/คะแนน และจับเวลาด้วย alarm
  worker/music.ts      ดึง playlist จาก Spotify/Deezer และหา preview จาก Deezer
  client/              หน้าเว็บ React (หน้าแรก, lobby, เกม, สรุปคะแนน)
```

## กติกาและพฤติกรรม

- รหัสห้องมี 4 ตัว เช่น `K7QX` และแชร์ลิงก์ `/r/K7QX` ให้เพื่อนได้
- แต่ละรอบ server เลือกเพลงจาก playlist ที่สุ่มลำดับไว้ แล้วนับถอยหลัง 2.5 วินาทีเพื่อให้ทุกเครื่องเริ่มเล่นพร้อมกัน
- คะแนนต่อรอบอยู่ระหว่าง 1000 ถึง 300 ตามความเร็วที่ตอบ และคนแรกที่ตอบถูกได้โบนัสอีก +100
- ถ้าตอบใกล้เคียงจะขึ้นว่า "เกือบแล้ว!" ส่วนเพลงที่หา preview ไม่เจอจะถูกข้ามไปเอง
- ถ้าทุกคนตอบถูกครบ รอบจะจบทันที และเจ้าของห้องกดข้ามเพลงได้
- รีเฟรชหน้าแล้วคะแนนไม่หาย ถ้าเจ้าของห้องหลุด สิทธิ์เจ้าของห้องจะย้ายไปให้คนถัดไป
- ถ้าห้องไม่มีคนอยู่นาน 3 นาที ข้อมูลของห้องจะถูกลบทิ้งทั้งหมด
