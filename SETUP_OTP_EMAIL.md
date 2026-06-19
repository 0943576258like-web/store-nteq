# ตั้งค่าระบบส่ง OTP ทางอีเมล (Outlook / Microsoft 365)

ระบบลืมรหัสผ่านตอนนี้ส่งอีเมล OTP จริงผ่าน `server.js` โดยใช้ SMTP ของ Outlook/M365
(ไม่ใช่ `mailto:` แบบเดิมที่ต้องพึ่งโปรแกรมอีเมลบนเครื่องผู้ใช้)

## 1. ติดตั้ง dependency ใหม่

```bash
npm install
```

(`package.json` เพิ่ม `nodemailer` ให้แล้ว)

## 2. ตั้งค่าบัญชีอีเมลที่จะใช้ส่ง OTP

คัดลอกไฟล์ `.env.example` เป็น `.env`:

```bash
cp .env.example .env
```

แก้ไขค่าในไฟล์ `.env`:

```
SMTP_USER=you@yourcompany.com
SMTP_PASS=รหัสผ่านบัญชีอีเมลจริง
```

> บัญชีนี้ไม่ได้เปิด 2FA จึงใช้รหัสผ่านปกติได้เลย
> ถ้าภายหลังเปิด 2FA ต้องเปลี่ยนไปสร้าง **App Password** แทนแล้วใส่ใน `SMTP_PASS` แทนรหัสผ่านเดิม

**ห้าม commit ไฟล์ `.env` เข้า git** — เพิ่มบรรทัดนี้ในไฟล์ `.gitignore`:
```
.env
```

## 3. รันเซิร์ฟเวอร์ให้โหลดค่าจาก .env

ติดตั้ง `dotenv` (ใช้ครั้งเดียว):
```bash
npm install dotenv
```

แล้วรันด้วยคำสั่งนี้แทน `npm start`:
```bash
node -r dotenv/config server.js
```

หรือจะ export ตัวแปรเองทาง terminal ก่อนรันก็ได้ (ไม่ต้องใช้ dotenv):
```bash
export SMTP_USER=you@yourcompany.com
export SMTP_PASS=yourpassword
node server.js
```

## 4. ทดสอบ

เปิดเว็บ → กด "ลืมรหัสผ่าน?" → กรอกอีเมลที่ผูกกับบัญชีผู้ใช้ในระบบ → กด "ส่ง OTP ไปยังอีเมล"

ดู log ที่ terminal:
- `[OTP] ส่งสำเร็จไปยัง xxx@xxx.com` → สำเร็จ เช็คกล่องจดหมาย (และ Junk/Spam)
- `[OTP] ส่งล้มเหลว: ...` → อ่าน error message เพื่อแก้ปัญหา (เช่น รหัสผ่านผิด, SMTP ถูกบล็อก)
- `SMTP_USER / SMTP_PASS ยังไม่ได้ตั้งค่า` → ลืมตั้งค่า .env หรือไม่ได้รันด้วย dotenv

## 5. ถ้า frontend (index.html) อยู่คนละโดเมน/พอร์ตกับ server.js

ปกติถ้าเปิด `index.html` ผ่าน `http://localhost:3000` (ที่ server.js เสิร์ฟให้) จะใช้ได้ทันที
แต่ถ้า frontend แยก host ออกไป ให้เพิ่มบรรทัดนี้ใน `<head>` ของ index.html ก่อน script OTP:

```html
<script>window.SRP_API_BASE = 'https://your-server-domain.com';</script>
```

## หมายเหตุด้านความปลอดภัย

- OTP ถูกสร้างและตรวจสอบที่ฝั่ง **server** เท่านั้น (เก็บใน memory ของ server.js) ไม่ใช่ฝั่ง client อีกต่อไป
  ป้องกันการแก้ JavaScript ฝั่งเบราว์เซอร์เพื่อปลอม OTP
- OTP มีอายุ 10 นาที และใช้ได้ครั้งเดียว (ลบออกจาก store ทันทีที่ตรวจสอบผ่าน)
- พอร์ต SMTP ที่ใช้คือ 587 (STARTTLS) ตามมาตรฐานของ Outlook/M365
