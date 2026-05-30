fetch("/content/home.json")
  .then(res => res.json())
  .then(data => {
    document.getElementById("title").innerText = data.title;
    document.getElementById("desc").innerText = data.description;
    
    // ตรวจสอบว่ามีข้อมูลรูปภาพในไฟล์ และจับมาแสดงผลลงแท็กภาพในหน้า index
    if(data.image) {
      document.getElementById("hero-img").src = data.image;
    }
  });