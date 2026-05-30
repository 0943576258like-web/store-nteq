# -*- coding: utf-8 -*-
import sys
import json

def main():
    # ค่าเริ่มต้นถ้าไม่มีการส่งค่ามา
    input_value = 42
    
    # ถ้ามีอาร์กิวเมนต์ส่งมาจาก Node.js ให้ดึงค่านั้นมาคำนวณ
    if len(sys.argv) > 1:
        try:
            input_value = int(sys.argv[1])
        except ValueError:
            pass

    # นำตัวเลขที่ผู้ใช้กรอกมาประมวลผลคูณสองจริง ๆ
    data_to_send = {
        "status": "success",
        "computed_value": input_value * 2,
        "note": f"รับค่าแปรผลสำเร็จ เลขนำเข้าคือ {input_value}"
    }
    
    print(json.dumps(data_to_send))

if __name__ == '__main__':
    main()
