# ร้านค้าใกล้เคียง — Store Finder

เว็บค้นหาร้านค้าใกล้เคียงจากข้อมูล Google Sheet พร้อมแผนที่ OpenStreetMap

## โครงสร้างไฟล์

```
store-finder/
├── index.html        ← หน้าหลัก
├── css/
│   └── style.css     ← สไตล์ทั้งหมด
├── js/
│   └── app.js        ← logic ดึงข้อมูล + แผนที่ + ค้นหา
├── vercel.json       ← config สำหรับ Vercel
└── README.md
```

## ข้อมูลที่ใช้

- Google Sheet ID: `1sKiG1H1Cn9zSSXQzenhAm8theiEJf4_RlcxxcXwiK6I`
- Sheet: `Total_ร้าน` (gid: `271631235`)
- คอลัม H = LAT, คอลัม I = LONG

> ⚠️ Sheet ต้องตั้งเป็น "ทุกคนที่มีลิงก์" จึงจะดึงข้อมูลได้

## วิธี Deploy

### 1. สร้าง GitHub Repository

```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/store-finder.git
git push -u origin main
```

### 2. Deploy บน Vercel

1. เปิด [vercel.com](https://vercel.com) → **Add New Project**
2. เลือก repository `store-finder`
3. Framework Preset: **Other**
4. กด **Deploy**

ได้ URL ทันที เช่น `https://store-finder.vercel.app`

### Auto-deploy

ทุกครั้งที่ `git push` → Vercel จะ deploy ให้อัตโนมัติ

## การแก้ไข Sheet ID

เปิด `js/app.js` บรรทัดแรก:

```js
const SHEET_ID = '1sKiG1H1Cn9zSSXQzenhAm8theiEJf4_RlcxxcXwiK6I';
const GID      = '271631235';
```

เปลี่ยน `SHEET_ID` และ `GID` ตาม Sheet ของคุณ
