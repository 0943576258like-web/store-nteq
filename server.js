const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer'); // โหลดโมดูลสำหรับอัปโหลดไฟล์
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// บังคับให้ระบบสามารถเข้าถึงไฟล์รูปภาพที่อัปโหลดเข้ามาได้ผ่าน URL
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ตั้งค่าที่จัดเก็บไฟล์รูปภาพ (Disk Storage)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true }); // สร้างโฟลเดอร์ uploads ถ้ายังไม่มี
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // ตั้งชื่อไฟล์ใหม่โดยอิงจากเวลา เพื่อป้องกันไม่ให้ชื่อไฟล์ซ้ำกัน
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// API ส่งไฟล์ข้อมูลให้หน้าบ้าน
app.get('/content/home.json', (req, res) => res.sendFile(path.join(__dirname, 'home.json')));
app.get('/content/data.json', (req, res) => res.sendFile(path.join(__dirname, 'data.json')));

// API หลังบ้าน: ดึงข้อมูลรวมเพื่อนำไปกระจายลงฟอร์ม
app.get('/api/admin/content', (req, res) => {
    try {
        const homeData = JSON.parse(fs.readFileSync(path.join(__dirname, 'home.json'), 'utf8'));
        res.json({ home: homeData });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'ไม่สามารถอ่านไฟล์ข้อมูลได้' });
    }
});

// API หลังบ้าน: รับการแก้ไขเนื้อหาข้อความและไฟล์รูปภาพพร้อมกัน
app.post('/api/admin/update-all', upload.single('imageFile'), (req, res) => {
    try {
        const homeFilePath = path.join(__dirname, 'home.json');
        let currentData = {};

        // 1. อ่านข้อมูลเดิมที่มีอยู่ในไฟล์ก่อน
        if (fs.existsSync(homeFilePath)) {
            currentData = JSON.parse(fs.readFileSync(homeFilePath, 'utf8'));
        }

        // 2. ปรับปรุงข้อมูลข้อความที่รับมาจากฟอร์มหลังบ้าน
        currentData.title = req.body.title || currentData.title;
        currentData.description = req.body.description || currentData.description;

        // 3. ตรวจสอบว่ามีการอัปโหลดไฟล์รูปภาพใหม่เข้ามาไหม
        if (req.file) {
            // บันทึก Path ของรูปภาพใหม่ เช่น "/uploads/1716284...png" ไปยังฟิลด์ image
            currentData.image = `/uploads/${req.file.filename}`;
        }

        // 4. เขียนข้อมูลเวอร์ชันอัปเดตกลับลงไปในไฟล์ home.json
        fs.writeFile(homeFilePath, JSON.stringify(currentData, null, 2), 'utf8', (err) => {
            if (err) {
                return res.status(500).json({ status: 'error', message: 'การเขียนไฟล์ล้มเหลว' });
            }
            res.json({ 
                status: 'success', 
                message: 'อัปเดตข้อมูลและรูปภาพสำเร็จ!',
                data: currentData
            });
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'เกิดข้อผิดพลาดบนเซิร์ฟเวอร์' });
    }
});

// API ประมวลผลสคริปต์ Python ร่วมกับโปรเจกต์
app.post('/api/process', (req, res) => {
    const inputValue = req.body.value || 42;
    exec(`python process.py ${inputValue}`, (error, stdout, stderr) => {
        if (error) return res.status(500).json({ status: 'error', message: error.message });
        try { res.json(JSON.parse(stdout)); } 
        catch (e) { res.json({ status: 'success', raw_output: stdout.trim() }); }
    });
});

// กำหนดเส้นทางแสดงผลหน้าจอเว็บ
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.listen(PORT, () => {
    console.log(`เซิร์ฟเวอร์หลังบ้านแบบฟูลฟังก์ชันรันที่: http://localhost:${PORT}`);
});