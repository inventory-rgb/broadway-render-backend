const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());

const upload = multer({ storage: multer.memoryStorage() });

// ดึงตัวแปร Environment จาก Render
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

app.post('/analyzeImage', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const visionModel = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
    const imagePart = {
      inlineData: {
        data: req.file.buffer.toString('base64'),
        mimeType: req.file.mimetype
      }
    };

    // 1. ตรวจสอบว่าในภาพมีรหัสสินค้า (OCR) หรือไม่
    const promptOCR = `Check if there is any visible product code, model number, or text printed on this fabric swatch image (e.g., "JQL 001", "ARS-001"). 
If found, return ONLY that exact code. 
If no text or code is visible, reply ONLY with "NO_CODE".`;

    const ocrResult = await visionModel.generateContent([promptOCR, imagePart]);
    const detectedCode = ocrResult.response.text().trim();

    // ถ้าระบบอ่านเจอตัวหนังสือรหัสสินค้า ให้ส่งรหัสไปค้นหาบนเว็บได้ทันที
    if (detectedCode !== 'NO_CODE' && detectedCode.length > 0) {
      console.log('Detected Code via OCR:', detectedCode);
      return res.json({ keyword: detectedCode });
    }

    // 2. ถ้าไม่เจอรหัสสินค้า ให้ทำ Visual Pattern Matching สแกนความคล้ายของลายผ้า
    const promptVisual = `Analyze this fabric swatch in extreme detail. 
Describe its color palette, pattern (e.g. pinstripe, floral, houndstooth, solid, paisley), weave texture, material visual style, and key visual attributes in English.`;

    const visualResult = await visionModel.generateContent([promptVisual, imagePart]);
    const fabricDescription = visualResult.response.text();

    // แปลงลักษณะลายผ้าเป็น Vector
    const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const embeddingResult = await embeddingModel.embedContent(fabricDescription);
    const queryVector = embeddingResult.embedding.values;

    // สั่งให้ Supabase ค้นหาภาพผ้าที่เหมือนที่สุด 1 รายการ
    const { data: matchedProducts, error } = await supabase.rpc('match_fabrics', {
      query_embedding: queryVector,
      match_threshold: 0.5, // เกณฑ์ความคล้าย 50% ขึ้นไป
      match_count: 1
    });

    if (error) {
      console.error('Supabase error:', error);
      // หากเกิดข้อผิดพลาด ให้ fallback ส่งคำค้นหมวดหมู่ทั่วไป
      return res.json({ keyword: 'Lining' });
    }

    if (matchedProducts && matchedProducts.length > 0) {
      console.log('Matched Product Code:', matchedProducts[0].product_code);
      res.json({ keyword: matchedProducts[0].product_code });
    } else {
      // หากลายผ้าไม่ตรงกับในคลังเลย ให้คืนค่าหมวดหมู่หลัก
      res.json({ keyword: 'Lining' });
    }

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to analyze image' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
