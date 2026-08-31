const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const app = express();
app.use(cors());

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // จำกัดไฟล์ไม่เกิน 10MB
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// ฟังก์ชันย่อภาพและบีบอัดเป็น JPEG ขนาดเล็ก
async function resizeImageBuffer(inputBuffer) {
  const img = await loadImage(inputBuffer);
  const maxDim = 800; // ย่อขนาดด้านยาวสุดไม่เกิน 800px ป้องกัน Token ล้น 100%
  let width = img.width;
  let height = img.height;

  if (width > maxDim || height > maxDim) {
    if (width > height) {
      height = Math.round((height * maxDim) / width);
      width = maxDim;
    } else {
      width = Math.round((width * maxDim) / height);
      height = maxDim;
    }
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  return canvas.toBuffer('image/jpeg');
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

    // ย่อขนาดรูปภาพก่อนส่งให้ Gemini Always
    let processedBuffer;
    try {
      processedBuffer = await resizeImageBuffer(req.file.buffer);
    } catch (resizeErr) {
      console.error('Resize failed, using raw buffer:', resizeErr.message);
      processedBuffer = req.file.buffer;
    }

    const visionModel = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
    const imagePart = {
      inlineData: {
        data: processedBuffer.toString('base64'),
        mimeType: 'image/jpeg'
      }
    };

    // 1. ตรวจสอบ OCR
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

    // 2. สกัดคำอธิบายลายผ้า
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
