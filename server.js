const express = require('express');
const cors = require('cors');
const Busboy = require('busboy');
const vision = require('@google-cloud/vision');

const app = express();
app.use(cors({ origin: true }));

// ตั้งค่า Google Cloud Vision Client (จะอ่าน Key จาก Environment Variable บน Render)
let visionClient;
if (process.env.GOOGLE_CREDENTIALS_JSON) {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    visionClient = new vision.ImageAnnotatorClient({ credentials });
  } catch (e) {
    console.error("Failed to parse GOOGLE_CREDENTIALS_JSON", e);
    visionClient = new vision.ImageAnnotatorClient();
  }
} else {
  visionClient = new vision.ImageAnnotatorClient();
}

// Route สำหรับตรวจสุขภาพเซิร์ฟเวอร์
app.get('/', (req, res) => {
  res.send('Broadway Stock Vision API on Render is running!');
});

// Route สำหรับรับภาพถ่ายไปสแกนด้วย Vision API
app.post('/analyzeImage', (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const busboy = Busboy({ headers: req.headers });
  let imageBuffer = null;

  busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
    const buffers = [];
    file.on('data', (data) => buffers.push(data));
    file.on('end', () => {
      imageBuffer = Buffer.concat(buffers);
    });
  });

  busboy.on('finish', async () => {
    if (!imageBuffer) return res.status(400).send('No image uploaded.');
    try {
      const [result] = await visionClient.annotateImage({
        image: { content: imageBuffer },
        features: [{ type: 'LABEL_DETECTION', maxResults: 5 }],
      });
      const labels = result.labelAnnotations.map((l) => l.description);
      res.status(200).json({ keyword: labels.length > 0 ? labels[0] : '' });
    } catch (error) {
      console.error('Vision API Error:', error);
      res.status(500).send('Error analyzing image.');
    }
  });

  req.pipe(busboy);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});