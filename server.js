const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

function normalizeMimeType(mimeType) {
  if (!mimeType || mimeType === 'image/jpg') return 'image/jpeg';
  return mimeType;
}

app.post('/analyzeImage', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    if (!process.env.GEMINI_API_KEY) {
      console.error('Missing GEMINI_API_KEY environment variable');
      return res.status(500).json({ error: 'Server misconfiguration: Missing API Key' });
    }

    // กำหนดใช้ gemini-3.6-flash ตามที่ Google API แจ้งเตือนล่าสุด
    const visionModel = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
    const imagePart = {
      inlineData: {
        data: req.file.buffer.toString('base64'),
        mimeType: normalizeMimeType(req.file.mimetype)
      }
    };

    // 1. ตรวจสอบ OCR ตัวหนังสือบนรูป
    const promptOCR = `Check if there is any visible product code or text printed on this fabric swatch image (e.g., "JQL 001", "ARS-001", "DES-071"). 
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
      console.log('OCR Detected:', formattedCode);
      return res.json({ keyword: formattedCode });
    }

    // 2. ถ้าไม่มีตัวหนังสือ ให้สกัดคำอธิบายลายและสีผ้าเป็นภาษาอังกฤษ
    const promptVisual = `Describe the main pattern and colors of this fabric swatch in short keywords for search e.g. "Red pink paisley pattern lining", "Black floral print suiting". Keep it concise under 10 words.`;

    const visualResult = await visionModel.generateContent([promptVisual, imagePart]);
    const fabricKeyword = visualResult.response.text().trim();

    console.log('Visual Keyword Generated:', fabricKeyword);
    return res.json({ keyword: fabricKeyword });

  } catch (error) {
    console.error('Image analysis error:', error);
    res.status(500).json({ error: `Failed to analyze image: ${error.message}` });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
