# ระบบเบิกจ่ายสินค้าคลัง v2.0

## โครงสร้างไฟล์
```
project/
  index.html     หน้าเว็บหลัก (HTML + CSS)
  app.js         JavaScript ทั้งหมด (เชื่อมกับ API)
  server.js      Express.js + SQLite backend
  package.json   dependencies
  warehouse.db   สร้างอัตโนมัติเมื่อรันครั้งแรก
```

## วิธีติดตั้ง
```bash
npm install
npm start
# เปิด http://localhost:3000
```

## บัญชีทดสอบ
| Username  | Password | Role       |
|-----------|----------|------------|
| admin     | 1234     | ผู้ดูแลระบบ |
| manager   | 1234     | ผู้จัดการ   |
| warehouse | 1234     | คลังสินค้า  |
| staff     | 1234     | พนักงาน     |

## ฟีเจอร์
- Login / Session (30 นาที auto logout)
- สร้างใบเบิก + อนุมัติ + จ่ายสินค้า
- จัดการสต็อก + รับสินค้าเข้า
- รายงานประจำเดือน
- จัดการผู้ใช้ (Admin)
- SQLite database (ไม่ต้องติดตั้ง DB แยก)
