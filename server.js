const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());

const upload = multer({ storage: multer.memoryStorage() });

// เชื่อมต่อ Supabase
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// เชื่อมต่อ Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// ตัวแปรสำหรับโหลดโมเดล Vector ในเซิร์ฟเวอร์
let embedderPipeline = null;

async function getEmbedder() {
  if (!embedderPipeline) {
    const { pipeline } = await import('@xenova/transformers');
    embedderPipeline = await pipeline('feature-extraction', 'Xenova/bge-base-en-v1.5');
  }
  return embedderPipeline;
}

app.post('/analyzeImage', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    // 1. เรียกใช้ Gemini 1.5 Flash วิเคราะห์ภาพ
    const visionModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const imagePart = {
      inlineData: {
        data: req.file.buffer.toString('base64'),
        mimeType: req.file.mimetype
      }
    };

    // ขั้นตอน A: อ่าน OCR รหัสสินค้าบนรูปผ้า (ถ้ามี)
    const promptOCR = `Check if there is any visible product code, model number, or text printed on this fabric swatch image (e.g., "JQL 001", "ARS-001", "DES-071"). 
If found, return ONLY that exact code. 
If no text or code is visible, reply ONLY with "NO_CODE".`;

    const ocrResult = await visionModel.generateContent([promptOCR, imagePart]);
    const detectedCode = ocrResult.response.text().trim();

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

    // ขั้นตอน B: ถ้ารูปไม่มีตัวหนังสือ ให้ Gemini สกัดสีและลายผ้าออกเป็นคำอธิบาย
    const promptVisual = `Analyze this fabric swatch image and describe its visual properties concisely:
PATTERN & COLOR: [Identify pattern like Paisley, Floral, Plain, Stripe and primary/secondary colors e.g., Black background with orange and purple paisley]
CATEGORY: [Identify fabric type e.g., Lining, Suiting, Shirting]
SUBCATEGORY: [e.g., Patterned Lining]
Focus heavily on color combinations, pattern shapes, and unique visual traits.`;

    const visualResult = await visionModel.generateContent([promptVisual, imagePart]);
    const fabricDescription = visualResult.response.text().trim();
    console.log('Visual Description:', fabricDescription);

    // ขั้นตอน C: แปลงคำอธิบายเป็น Vector ด้วย BGE-Base (โมเดลเดียวกับที่บันทึกใน Supabase)
    const generateVector = await getEmbedder();
    const output = await generateVector(fabricDescription, { pooling: 'mean', normalize: true });
    const queryVector = Array.from(output.data);

    // ขั้นตอน D: ค้นหาใน Supabase ผ่าน RPC function
    const { data: matchedProducts, error } = await supabase.rpc('match_fabric_products', {
      query_embedding: queryVector,
      match_threshold: 0.15,
      match_count: 5
    });

    if (error) {
      console.error('Supabase RPC Error:', error);
      return res.json({ keyword: 'Lining' });
    }

    if (matchedProducts && matchedProducts.length > 0) {
      console.log('Top Match SKU:', matchedProducts[0].sku, 'Similarity:', matchedProducts[0].similarity);
      return res.json({ keyword: matchedProducts[0].sku });
    } else {
      return res.json({ keyword: 'Lining' });
    }

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to analyze image' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
