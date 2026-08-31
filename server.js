const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const sharp = require('sharp');

const app = express();
app.use(cors());

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

app.post('/analyzeImage', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    if (!process.env.GEMINI_API_KEY) {
      console.error('Missing GEMINI_API_KEY environment variable');
      return res.status(500).json({ error: 'Server misconfiguration: Missing API Key' });
    }

    let imageBuffer = req.file.buffer;
    let mimeType = req.file.mimetype;

    // ลองบีบอัดภาพด้วย sharp หากไฟล์ไม่รองรับจะสลับไปใช้ buffer ดั้งเดิมทันที
    try {
      imageBuffer = await sharp(req.file.buffer)
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      mimeType = 'image/jpeg';
    } catch (sharpError) {
      console.warn('Sharp skip/failed, fallback to original buffer:', sharpError.message);
    }

    const visionModel = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
    const imagePart = {
      inlineData: {
        data: imageBuffer.toString('base64'),
        mimeType: mimeType
      }
    };

    // 1. ตรวจสอบ OCR ตัวหนังสือบนรูปก่อน
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

    // 2. สกัดคำอธิบายลายและสีผ้าเป็นภาษาอังกฤษ
    const promptVisual = `Describe the main pattern and colors of this fabric swatch in short keywords for search e.g. "Purple jacquard paisley pattern lining", "Black floral print suiting". Keep it concise under 10 words.`;

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
