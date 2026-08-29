const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());

const upload = multer({ storage: multer.memoryStorage() });

// ดึง GEMINI_API_KEY จาก Environment บน Render
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/analyzeImage', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const imagePart = {
      inlineData: {
        data: req.file.buffer.toString('base64'),
        mimeType: req.file.mimetype
      }
    };

    const prompt = "Analyze this textile/fabric/button image. Return ONLY 1-2 english keywords representing the category or material type (e.g., Lining, Suiting, Shirting, Button, Cotton, Pattern). Do not output full sentences or punctuation.";

    const result = await model.generateContent([prompt, imagePart]);
    const keyword = result.response.text().trim();

    res.json({ keyword });
  } catch (error) {
    console.error('Gemini error:', error);
    res.status(500).json({ error: 'Failed to analyze image' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
