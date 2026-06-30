const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { PaintByNumbersGenerator } = require('./dist/lib/main');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'PaintSnap API running' });
});

app.post('/process', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const settings = {
      kMeansNrOfClusters: parseInt(req.body.colors) || 16,
      kMeansMinDeltaDifference: 1,
      kMeansClusteringColorSpace: 0,
      removeFacetsSmallerThanNrOfPoints: 20,
      removeFacetsFromLargeToSmall: true,
      maximumNumberOfFacets: 5000,
      nrOfTimesToHalveBorderSegments: 2,
      narrowPixelStripCleanupRuns: 3,
      resizeImageIfTooLarge: true,
      resizeImageWidth: 600,
      resizeImageHeight: 600
    };

    const result = await PaintByNumbersGenerator.processImage(
      req.file.buffer,
      settings
    );

    res.json({
      svg: result.svg,
      palette: result.palette
    });
  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ error: 'Processing failed', details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PaintSnap API running on port ${PORT}`);
});
