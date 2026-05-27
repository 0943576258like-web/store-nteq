# 🖥️ NTEQ Polymer — ระบบสต๊อก IT & แจ้งซ่อม

ระบบจัดการสต๊อกอุปกรณ์ IT และแจ้งซ่อมออนไลน์ สำหรับบริษัท NTEQ Polymer  
พัฒนาด้วย **Node.js + Express + PostgreSQL** และ Deploy บน **Render.com**

---

## 📋 ฟีเจอร์หลัก

- 🔐 **ระบบ Login** พร้อม JWT Token (4 ระดับสิทธิ์)
- 📦 **จัดการสต๊อก IT** — เพิ่ม/ลด/แก้ไข/ค้นหาสินค้า
- 📝 **ใบเบิกสินค้า** — สร้าง / อนุมัติ / จ่ายของ / ปฏิเสธ
- 🔧 **แจ้งซ่อม IT** — แจ้ง / ติดตาม / อัปเดตสถานะ
- 📊 **Dashboard & รายงาน** — สถิติ, กราฟ, ส่งออก Excel
- 🖨️ **พิมพ์ใบเบิก** — PDF พร้อม QR Code
- 👥 **จัดการผู้ใช้** — เพิ่ม/แก้ไข/เปิด-ปิดบัญชี
- 🗄️ **PostgreSQL** — ข้อมูลถาวร ไม่หายเมื่อ restart

---

## 👥 ระดับสิทธิ์ผู้ใช้

| Role | สิทธิ์ |
|------|--------|
| `admin` | ดูแลระบบทั้งหมด, จัดการผู้ใช้, ตั้งค่า |
| `manager` | อนุมัติใบเบิก, ดูรายงาน |
| `warehouse` / `itstock` | จ่ายสินค้า, จัดการสต๊อก |
| `staff` | สร้างใบเบิก, แจ้งซ่อม |

---

## 🛠️ Tech Stack

| ส่วน | เทคโนโลยี |
|------|-----------|
| Backend | Node.js + Express |
| Database | PostgreSQL |
| Authentication | JWT (jsonwebtoken) + bcryptjs |
| Frontend | HTML + CSS + Vanilla JS |
| Hosting | Render.com (Free Tier) |

---

## 🚀 วิธี Deploy บน Render.com

### ขั้นตอนที่ 1 — เตรียม GitHub Repository

```bash
# 1. สร้าง repo ใหม่บน github.com
# 2. Clone มาที่เครื่อง
git clone https://github.com/YOUR_USERNAME/nteq-it-stock.git
cd nteq-it-stock

# 3. คัดลอกไฟล์ทั้งหมดลงใน repo
# 4. Push ขึ้น GitHub
git add .
git commit -m "Initial commit: NTEQ IT Stock System"
git push origin main
```

โครงสร้างไฟล์ที่ต้องมี:
```
nteq-it-stock/
├── server.js
├── package.json
├── render.yaml
├── .gitignore
├── README.md
└── public/
    └── index.html
```

### ขั้นตอนที่ 2 — Deploy บน Render.com

1. ไปที่ [render.com](https://render.com) → สมัครบัญชีฟรี
2. กด **New** → **Blueprint**
3. เชื่อม GitHub → เลือก repo `nteq-it-stock`
4. Render จะอ่าน `render.yaml` อัตโนมัติ → กด **Apply**
5. รอ **5–10 นาที** ให้ระบบ build
6. ได้ URL: `https://nteq-it-stock.onrender.com`

> ✅ Render จะสร้าง **Web Service** และ **PostgreSQL Database** ให้อัตโนมัติ  
> ✅ ตัวแปร `DATABASE_URL` จะถูกตั้งค่าให้อัตโนมัติ — ไม่ต้องแก้ไขเอง

### ขั้นตอนที่ 3 — เข้าใช้งานครั้งแรก

เปิด URL แล้ว Login ด้วยบัญชีเริ่มต้น:

| Username | Password | Role |
|----------|----------|------|
| `admin` | `1234` | ผู้ดูแลระบบ |
| `manager` | `1234` | ผู้จัดการ |
| `itstock` | `1234` | เจ้าหน้าที่ IT |
| `staff` | `1234` | พนักงาน |

> ⚠️ **ควรเปลี่ยนรหัสผ่านทันทีหลัง Deploy**

---

## 💻 รันบนเครื่อง Local (สำหรับนักพัฒนา)

### ติดตั้ง Dependencies

```bash
npm install
```

### ตั้งค่า Environment Variable

```bash
# สร้างไฟล์ .env
cp .env.example .env
```

แก้ไขไฟล์ `.env`:
```env
DATABASE_URL=postgresql://username:password@localhost:5432/nteq_stock
JWT_SECRET=your-secret-key-change-this
PORT=3000
NODE_ENV=development
```

### รัน Server

```bash
# Development mode (auto-restart)
npm run dev

# Production mode
npm start
```

เปิดเบราว์เซอร์ที่ `http://localhost:3000`

---

## 🔌 API Endpoints

### Authentication
| Method | Endpoint | คำอธิบาย |
|--------|----------|----------|
| POST | `/api/login` | Login → ได้ JWT Token |
| GET | `/api/me` | ดูข้อมูลผู้ใช้ปัจจุบัน |

### สต๊อก (Stock)
| Method | Endpoint | คำอธิบาย | สิทธิ์ |
|--------|----------|----------|--------|
| GET | `/api/stock` | ดูสต๊อกทั้งหมด | ทุกคน |
| POST | `/api/stock` | เพิ่มสินค้าใหม่ | admin, itstock |
| PUT | `/api/stock/:id` | แก้ไขข้อมูลสินค้า | admin, itstock |
| DELETE | `/api/stock/:id` | ลบสินค้า | admin |
| POST | `/api/stock/:id/adjust` | ปรับจำนวนสต๊อก | admin, itstock, warehouse |

### ใบเบิก (Requests)
| Method | Endpoint | คำอธิบาย | สิทธิ์ |
|--------|----------|----------|--------|
| GET | `/api/requests` | ดูใบเบิกทั้งหมด | ทุกคน |
| POST | `/api/requests` | สร้างใบเบิกใหม่ | ทุกคน |
| PUT | `/api/requests/:id/approve` | อนุมัติ | manager, admin |
| PUT | `/api/requests/:id/reject` | ปฏิเสธ | manager, admin |
| PUT | `/api/requests/:id/issue` | จ่ายสินค้า (หักสต๊อก) | itstock, warehouse, admin |
| DELETE | `/api/requests/:id` | ลบใบเบิก | admin |

### แจ้งซ่อม (Repairs)
| Method | Endpoint | คำอธิบาย | สิทธิ์ |
|--------|----------|----------|--------|
| GET | `/api/repairs` | ดูรายการแจ้งซ่อม | ทุกคน |
| POST | `/api/repairs` | แจ้งซ่อมใหม่ | ทุกคน |
| PUT | `/api/repairs/:id/status` | อัปเดตสถานะ | itstock, admin |
| DELETE | `/api/repairs/:id` | ลบรายการ | admin |

### ผู้ใช้ (Users)
| Method | Endpoint | คำอธิบาย | สิทธิ์ |
|--------|----------|----------|--------|
| GET | `/api/users` | ดูผู้ใช้ทั้งหมด | admin |
| POST | `/api/users` | เพิ่มผู้ใช้ | admin |
| PUT | `/api/users/:id` | แก้ไขผู้ใช้ | admin |
| DELETE | `/api/users/:id` | ลบผู้ใช้ | admin |

### สถิติ (Stats)
| Method | Endpoint | คำอธิบาย |
|--------|----------|----------|
| GET | `/api/stats` | ข้อมูล Dashboard |
| GET | `/api/stats/monthly` | สถิติรายเดือน |

---

## 🗄️ โครงสร้าง Database (PostgreSQL)

```sql
-- ผู้ใช้งาน
users (id, username, password_hash, name, role, dept, active, created_at)

-- สินค้าในสต๊อก
stock (id, name, category, qty, min_qty, unit, location, img, created_at)

-- ใบเบิกสินค้า
requests (id, req_no, requester_name, dept, status, items_json, 
          created_at, approved_at, issued_at, note)

-- แจ้งซ่อม
repairs (id, reporter_name, emp_id, dept, device_type, problem, 
         status, technician, created_at, updated_at, note)
```

---

## ⚙️ Environment Variables

| ตัวแปร | คำอธิบาย | ค่าเริ่มต้น |
|--------|----------|------------|
| `DATABASE_URL` | PostgreSQL connection string | (จาก Render อัตโนมัติ) |
| `JWT_SECRET` | Secret key สำหรับ JWT | `nteq-secret-2024` |
| `PORT` | Port ของ server | `3000` |
| `NODE_ENV` | Environment | `production` |

> ⚠️ **สำคัญ**: เปลี่ยน `JWT_SECRET` ให้เป็นค่าที่ปลอดภัยก่อน Deploy จริง!

---

## 🔒 ความปลอดภัย

- รหัสผ่านเข้ารหัสด้วย **bcrypt** (salt rounds = 10)
- ทุก API ใช้ **JWT Token** (หมดอายุ 8 ชั่วโมง)
- ตรวจสอบสิทธิ์ทุก endpoint
- ป้องกัน SQL Injection ด้วย Parameterized Query

---

## 📝 หมายเหตุสำหรับ Render Free Tier

| ข้อจำกัด | รายละเอียด |
|----------|-----------|
| Web Service | Sleep หลังไม่มีการใช้งาน 15 นาที (wake up ~30 วินาที) |
| PostgreSQL | ฟรี 90 วัน จากนั้น $7/เดือน |
| Storage | 1 GB |
| Bandwidth | 100 GB/เดือน |

> 💡 **Tip**: ใช้ [UptimeRobot](https://uptimerobot.com) ping ทุก 10 นาที เพื่อป้องกัน sleep (ฟรี)

---

## 🆘 แก้ปัญหาที่พบบ่อย

**❓ เข้าระบบไม่ได้หลัง Deploy ครั้งแรก**
> รอ 2-3 นาที ให้ Database initialize เสร็จก่อน แล้ว refresh หน้าเว็บ

**❓ ข้อมูลหาย**
> ตรวจสอบว่า `DATABASE_URL` ถูกตั้งค่าใน Render Environment ถูกต้อง

**❓ Deploy ไม่สำเร็จ**
> ดู Logs ใน Render Dashboard → กด **Logs** ที่ Web Service

---

## 📞 ติดต่อ

**NTEQ Polymer — IT Department**  
ระบบพัฒนาโดยทีม IT ภายในบริษัท
