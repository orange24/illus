# Illus — Web Vector Editor

โปรแกรมออกแบบเวกเตอร์บนเว็บ แนวเดียวกับโปรแกรมวาดเวกเตอร์ระดับมืออาชีพ: วาด path / Bézier, shape, ข้อความ, จัดการ layer, Pathfinder, คีย์ลัดแบบที่นักออกแบบคุ้นมือ และเปิด / บันทึกไฟล์ `.ai` ได้

![stack](https://img.shields.io/badge/stack-Vite%20%2B%20TypeScript%20%2B%20Paper.js-orange)

## เริ่มใช้งาน

```bash
npm install
npm run dev      # เปิด http://localhost:5173
npm run build    # build เป็นไฟล์ static ใน dist/ (deploy ที่ไหนก็ได้)
```

## ฟีเจอร์

**เครื่องมือ** (คลิกขวาที่ปุ่มที่มีสามเหลี่ยมมุมล่างเพื่อเลือกเครื่องมือในกลุ่ม)

| คีย์ | เครื่องมือ | | คีย์ | เครื่องมือ |
|---|---|---|---|---|
| `V` | Selection (ย้าย, ย่อ/ขยาย, หมุน, Alt+ลากทำสำเนา) | | `T` | Type |
| `A` | Direct Selection (แก้ anchor / handle) | | `I` | Eyedropper |
| `P` | Pen (เพิ่ม/ลบจุดบน path ที่เลือก, ต่อเส้นจากปลาย) | | `R` / `O` | Rotate / Reflect |
| `Shift+C` | Anchor Point | | `H` / `Space` ค้าง | Hand |
| `N` | Pencil | | `Z` | Zoom (Alt = ซูมออก, ลากกรอบ) |
| `M` / `L` / `\` | Rectangle / Ellipse / Line | | | Rounded Rect, Polygon, Star (ในกลุ่ม Shape) |

**คีย์ลัดอื่นๆ** — `Ctrl/⌘ + Z, Shift+Z, C, X, V, F, B, D, A, G, Shift+G, ], [, 8, 7, 2, 3, S, O, E, 0, 1, =, -` และ `X`, `Shift+X`, `D`, `/` สำหรับสี กด `F1` ในแอปเพื่อดูทั้งหมด

**Object** — Group / Ungroup, Arrange, Compound Path, Clipping Mask, Lock / Hide, Flip, Align & Distribute

**Pathfinder** — Unite, Minus Front, Minus Back, Intersect, Exclude, Divide

**Image Trace** — แปลงภาพ raster (PNG/JPG/WebP หรือภาพใน PDF/.ai) เป็น path เวกเตอร์ที่แก้ไขได้: เลือกภาพแล้วกดปุ่ม *Image Trace* ที่แถบด้านบน หรือเมนู Object › Image Trace (`Ctrl/⌘+Alt+T`)
- ค่าสำเร็จรูป: โลโก้ขาวดำ, ภาพสเก็ตช์, ภาพเงา, 3 / 6 / 16 สี, โทนเทา, ภาพถ่ายละเอียดต่ำ / สูง (เลือกจาก dropdown บนแถบด้านบนเพื่อ trace ทันที)
- ปรับได้: โหมด (ขาวดำ / โทนเทา / สี), Threshold, จำนวนสี (2–64), ความแม่นยำของเส้น, มุม, ตัดจุดรบกวน, ความละเอียดที่ใช้ trace, วิธีสร้างรูปทรง (ซ้อนกัน / ชนกันพอดี), Ignore White, เก็บภาพต้นฉบับไว้
- พรีวิวสด (ผลลัพธ์ / เส้นขอบ / ต้นฉบับ, กดค้างเพื่อเทียบ) พร้อมจำนวน path และ anchor; ประมวลผลใน Web Worker จึงไม่ค้าง
- ผลลัพธ์เป็นกลุ่ม "Image Trace" วางทับตำแหน่ง/ขนาด/การหมุนเดิมของภาพ Ungroup แล้วแก้ไขทีละชิ้นได้ และ Undo ได้

**Panels** — Transform (X/Y/W/H/หมุน), Appearance (Fill, Stroke, ความหนา, ปลาย/มุมเส้น, เส้นประ, Opacity, Swatches), Character, Align, Pathfinder, Layers (เพิ่ม/ลบ, ซ่อน, ล็อก, เปลี่ยนชื่อ, ลากเรียงลำดับ, เลือกวัตถุจากรายการ)

**อื่นๆ** — Undo/Redo 120 ขั้น, บันทึกอัตโนมัติในเบราว์เซอร์, ลากไฟล์มาวางบน canvas, copy/paste SVG กับโปรแกรมอื่น

## ไฟล์ที่รองรับ

| | นำเข้า / เปิด | Export |
|---|---|---|
| `.ai` (Illustrator CS ขึ้นไป, PDF-compatible) | ✅ แปลงเป็น path ที่แก้ไขได้ พร้อม layer, clipping, ความโปร่งใส, ภาพ และข้อความ | ✅ |
| `.ai` รุ่นเก่า (PostScript, AI 3–8) | ✅ path, compound path, group, สี CMYK/RGB/Gray | — |
| `.pdf` | ✅ หน้าแรก | ✅ |
| `.svg` | ✅ | ✅ |
| `.png` | ✅ (วางเป็นภาพ) | ✅ 1x–4x, พื้นหลังโปร่งใสได้ |

### ข้อจำกัดของ `.ai`

- รูปแบบ `.ai` แบบ native ของ Adobe ไม่ได้เปิดเผย ไฟล์ `.ai` ที่ export จากแอปนี้จึงเป็น **PDF-compatible .ai** ซึ่ง Illustrator เปิดและแก้ไข path, สี, ข้อความได้ตามปกติ
- ในไฟล์ที่ export จะฝังข้อมูลเอกสารต้นฉบับ (gzip ใน XMP metadata) ไว้ด้วย เมื่อเปิดกลับมาในแอปนี้จะได้ทุกอย่างครบเหมือนเดิม
- ตอนนำเข้า `.ai` จาก Illustrator: effect ที่ยังแก้ไขได้ (live effects), gradient mesh, artboard หลายอัน และ symbol จะถูกแปลงเป็นรูปทรงธรรมดาหรือยังไม่รองรับ ข้อความจะเป็น point text แยกตามบรรทัด
- ไฟล์ที่บันทึกโดยปิดตัวเลือก *Create PDF Compatible File* จะไม่มีข้อมูลที่อ่านได้ แอปจะแจ้งเตือน
- PDF / .ai ที่มีข้อความภาษาไทยจะฝังฟอนต์ Sarabun (OFL) ให้อัตโนมัติ

## โครงสร้างโค้ด

```
src/
  editor.ts         สถานะหลัก: document (Paper.js), layer, selection, history, view
  ops.ts            คำสั่งระดับ object: group, arrange, pathfinder, align, clipboard
  commands.ts       รายการคำสั่งทั้งหมด (ใช้ร่วมกันระหว่างเมนูและคีย์ลัด)
  input.ts          เมาส์ / คีย์บอร์ด / wheel / clipboard / drag & drop
  tools/            เครื่องมือแต่ละตัว
  io/               import (.ai, PDF, SVG, legacy AI) และ export (SVG, PNG, PDF, .ai)
  ui/               menubar, toolbar, panels, dialogs, icons, traceDialog (Image Trace)
  trace/            Image Trace: tracer.ts (quantize → ลบจุดรบกวน → trace ขอบ → fit Bézier), worker และการแปลงเป็น path
public/fonts/       Sarabun (SIL Open Font License) สำหรับฝังใน PDF
```

ไลบรารีหลัก: [Paper.js](http://paperjs.org) (vector engine + boolean ops), [pdf.js](https://mozilla.github.io/pdf.js/) (อ่าน PDF/.ai), [jsPDF](https://github.com/parallax/jsPDF) + [svg2pdf.js](https://github.com/yWorks/svg2pdf.js) (เขียน PDF/.ai)
