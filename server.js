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

    // ใช้โมเดล gemini-3.6-flash
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

    // ถ้าระบบอ่านเจอตัวหนังสือรหัสสินค้า ให้ทำการปรับ Format ก่อนส่งค้นหา
    if (detectedCode !== 'NO_CODE' && detectedCode.length > 0) {
      let formattedCode = detectedCode;
      
      const match = detectedCode.match(/([a-zA-Z]+)[^0-9]*([0-9]+)/);
      if (match) {
        const prefix = match[1].toUpperCase(); 
        const number = match[2].padStart(3, '0'); 
        formattedCode = `${prefix}-${number}`; 
      }

      console.log('Original OCR:', detectedCode, '-> Formatted Code:', formattedCode);
      return res.json({ keyword: formattedCode });
    }

    // 2. ทำ Visual Pattern Matching (เน้น ลายผ้า และ สี เป็นหลัก)
    const promptVisual = `Analyze this fabric swatch and describe it strictly in this format for vector matching:
PATTERN: [Identify if it is Solid/Plain, Floral, Stripe, Plaid, Houndstooth, etc. Be very specific]
COLOR: [Identify the dominant primary color and any secondary colors]
TEXTURE: [Describe the weave or visual material surface]
Keep the description concise and prioritize Pattern and Color keywords.`;

    const visualResult = await visionModel.generateContent([promptVisual, imagePart]);
    const fabricDescription = visualResult.response.text();

    // ใช้โมเดลเวกเตอร์ gemini-embedding-2 
    const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-2' });
    const embeddingResult = await embeddingModel.embedContent(fabricDescription);
    const queryVector = embeddingResult.embedding.values;

    // สั่งให้ Supabase ค้นหาภาพผ้าที่เหมือนที่สุด และคล้ายรองลงมา
    const { data: matchedProducts, error } = await supabase.rpc('match_fabrics', {
      query_embedding: queryVector,
      match_threshold: 0.15, // ลดเกณฑ์ลงเหลือ 15% เพื่อให้ระบบยืดหยุ่น จับคู่ภาพที่คล้ายกันได้
      match_count: 5         // ค้นหาเผื่อไว้ 5 อันดับแรก
    });

    if (error) {
      console.error('Supabase error:', error);
      return res.json({ keyword: 'Lining' });
    }

    if (matchedProducts && matchedProducts.length > 0) {
      console.log('Top Match:', matchedProducts[0].product_code, 'Similarity:', matchedProducts[0].similarity);
      
      // ส่งรหัสสินค้าที่ตรงที่สุดอันดับ 1 กลับไปให้หน้าเว็บเพื่อแสดงผล
      res.json({ keyword: matchedProducts[0].product_code });
    } else {
      res.json({ keyword: 'Lining' });
    }

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to analyze image' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
