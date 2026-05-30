# NTEQ IT Stock System v2.0 — ติดตั้งและใช้งาน

## โครงสร้าง Project
\`\`\`
C:\NTEQ POLYMER WEB\
├── server.js         <- server หลัก
├── package.json
├── node_modules\
├── data\
│   └── nteq_it.db   <- ฐานข้อมูล (สร้างอัตโนมัติ)
└── public\
    ├── index.html   <- ไฟล์ระบบหลัก
    └── api-bridge.js <- API bridge
\`\`\`

## ติดตั้ง
\`\`\`bash
cd "C:\NTEQ POLYMER WEB"
npm install
\`\`\`

## รัน
\`\`\`bash
node server.js
\`\`\`
เปิด http://localhost:3000

## บัญชีเริ่มต้น
| username | password | บทบาท |
|----------|----------|-------|
| admin    | 1234     | ผู้ดูแลระบบ |
| manager  | 1234     | ผู้จัดการ |
| itstock  | 1234     | เจ้าหน้าที่ IT |
| staff    | 1234     | พนักงาน |
