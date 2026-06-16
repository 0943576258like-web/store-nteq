# SRP Real-Time Sync — วิธีติดตั้งและรัน

## โครงสร้างไฟล์
```
โฟลเดอร์งาน/
├── index.html       ← ไฟล์แอปหลัก
├── server.js        ← Node.js Server (Real-time Sync)
├── package.json     ← dependencies
└── srp_data.json    ← ข้อมูลที่บันทึกอัตโนมัติ (สร้างเองเมื่อรัน)
```

---

## ขั้นตอนติดตั้ง

### 1. ติดตั้ง Node.js
ดาวน์โหลดจาก https://nodejs.org (เลือก LTS)

### 2. วางไฟล์
วาง `index.html` และ `server.js` ไว้ในโฟลเดอร์เดียวกัน

### 3. ติดตั้ง dependencies
เปิด Terminal/Command Prompt ที่โฟลเดอร์นั้น แล้วพิมพ์:
```
npm install ws
```

### 4. รัน Server
```
node server.js
```

### 5. เปิดแอป
เปิดเบราว์เซอร์ทุกเครื่องที่:
```
http://IP_เครื่อง_Server:3000
```
เช่น `http://192.168.1.10:3000`

---

## การทำงาน

```
เครื่อง Admin บันทึกข้อมูล
        ↓
    WebSocket Push → Server
        ↓
    Server broadcast → ทุกเครื่อง
        ↓
ทุกเครื่องอัปเดตทันที (Real-time)
```

- **ข้อมูลถูกบันทึกลง `srp_data.json`** เมื่อ server restart ข้อมูลยังอยู่
- **WebSocket + REST fallback** — ถ้า WebSocket ขาด จะใช้ HTTP แทน
- **Admin เท่านั้น** ที่ส่ง push ได้ / User อ่านอย่างเดียว

---

## หมายเหตุ

- ทุกเครื่องต้องเปิดแอปผ่าน Server (URL เดียวกัน) ไม่ใช่เปิดไฟล์ HTML โดยตรง
- ถ้าต้องการใช้งาน port อื่น: `PORT=8080 node server.js`
