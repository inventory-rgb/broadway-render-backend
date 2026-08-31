const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || ''
});

function normalizeMimeType(mimeType) {
  if (!mimeType || mimeType === 'image/jpg') return 'image/jpeg';
  return mimeType;
}

app.post('/analyzeImage', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('Missing OPENAI_API_KEY environment variable');
      return res.status(500).json({ error: 'Server misconfiguration: Missing API Key' });
    }

    const base64Image = req.file.buffer.toString('base64');
    const mimeType = normalizeMimeType(req.file.mimetype);

    // คำสั่งแบบรวม (Single-pass) ตรวจหาทั้งรหัสผ้า และวิเคราะห์ลายผ้าพร้อมกันเพื่อประหยัดเงิน
    const prompt = `Analyze this fabric swatch image and follow these rules strictly:
1. Check if there is any visible product code or text printed on the image (e.g., "JQL 001", "ARS-001", "DES-071"). If found, respond ONLY with that exact code.
2. If NO text or product code is visible, describe the main pattern and colors of this fabric in short search keywords (e.g., "Red pink paisley pattern lining", "Black floral print suiting"). Keep it concise under 10 words.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`
              }
            }
          ]
        }
      ],
      max_tokens: 60
    });

    const resultText = response.choices[0].message.content.trim();

    // เช็กว่าผลลัพธ์เป็น Code หรือข้อความอธิบาย
    const match = resultText.match(/([a-zA-Z]+)[^0-9]*([0-9]+)/);
    
    // ถ้าพบรูปแบบรหัสสินค้า ให้จัด Format ให้เป็น Prefix-Number (เช่น ARS-001)
    if (match && resultText.length <= 15) {
      const prefix = match[1].toUpperCase();
      const number = match[2].padStart(3, '0');
      const formattedCode = `${prefix}-${number}`;
      console.log('OCR Detected:', formattedCode);
      return res.json({ keyword: formattedCode });
    }

    // ถ้าไม่ใช่รหัสสินค้า ให้ส่งข้อความอธิบายลายผ้ากลับไป
    console.log('Visual Keyword Generated:', resultText);
    return res.json({ keyword: resultText });

  } catch (error) {
    console.error('Image analysis error:', error.message);
    res.status(500).json({ error: "System busy or quota limit reached. Please type the color or pattern manually." });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
