import express from 'express';
import cors from 'cors';
import multer from 'multer';
import * as canvas from 'canvas';

import { ColorReducer } from './src/colorreductionmanagement';
import { FacetCreator } from './src/facetCreator';
import { FacetReducer } from './src/facetReducer';
import { FacetResult } from './src/facetmanagement';
import { FacetBorderTracer } from './src/facetBorderTracer';
import { FacetBorderSegmenter } from './src/facetBorderSegmenter';
import { FacetLabelPlacer } from './src/facetLabelPlacer';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'PaintSnap API running' });
});

app.post('/process', upload.single('image'), async (req: any, res: any) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const numColors = parseInt(req.body.colors) || 16;

    const settings: any = {
      randomSeed: Math.random(),
      kMeansNrOfClusters: numColors,
      kMeansMinDeltaDifference: 1,
      kMeansClusteringColorSpace: 0,
      kMeansColorRestrictions: [],
      colorAliases: {},
      removeFacetsSmallerThanNrOfPoints: 20,
      removeFacetsFromLargeToSmall: true,
      maximumNumberOfFacets: 5000,
      nrOfTimesToHalveBorderSegments: 2,
      narrowPixelStripCleanupRuns: 3,
      resizeImageIfTooLarge: true,
      resizeImageWidth: 500,
      resizeImageHeight: 500
    };

    const img = await canvas.loadImage(req.file.buffer);
    const c = canvas.createCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(img as any, 0, 0, c.width, c.height);
    let imgData = ctx.getImageData(0, 0, c.width, c.height);

    if (settings.resizeImageIfTooLarge && (c.width > settings.resizeImageWidth || c.height > settings.resizeImageHeight)) {
      let width = c.width;
      let height = c.height;
      if (width > settings.resizeImageWidth) {
        const newWidth = settings.resizeImageWidth;
        height = c.height / c.width * settings.resizeImageWidth;
        width = newWidth;
      }
      if (height > settings.resizeImageHeight) {
        const newHeight = settings.resizeImageHeight;
        width = width / height * newHeight;
        height = newHeight;
      }
      const tempCanvas = canvas.createCanvas(width, height);
      tempCanvas.getContext('2d')!.drawImage(c as any, 0, 0, width, height);
      c.width = width;
      c.height = height;
      ctx.drawImage(tempCanvas as any, 0, 0, width, height);
      imgData = ctx.getImageData(0, 0, c.width, c.height);
    }

    const cKmeans = canvas.createCanvas(imgData.width, imgData.height);
    const ctxKmeans = cKmeans.getContext('2d');
    ctxKmeans.fillStyle = 'white';
    ctxKmeans.fillRect(0, 0, cKmeans.width, cKmeans.height);
    const kmeansImgData = ctxKmeans.getImageData(0, 0, cKmeans.width, cKmeans.height);

    await ColorReducer.applyKMeansClustering(imgData as any, kmeansImgData as any, ctx as any, settings, () => {});

    const colormapResult = ColorReducer.createColorMap(kmeansImgData as any);

    let facetResult = new FacetResult();
    for (let run = 0; run < settings.narrowPixelStripCleanupRuns; run++) {
      await ColorReducer.processNarrowPixelStripCleanup(colormapResult);
      facetResult = await FacetCreator.getFacets(imgData.width, imgData.height, colormapResult.imgColorIndices, () => {});
      await FacetReducer.reduceFacets(settings.removeFacetsSmallerThanNrOfPoints, settings.removeFacetsFromLargeToSmall, settings.maximumNumberOfFacets, colormapResult.colorsByIndex, facetResult, colormapResult.imgColorIndices, () => {});
    }

    await FacetBorderTracer.buildFacetBorderPaths(facetResult, () => {});
    await FacetBorderSegmenter.buildFacetBorderSegments(facetResult, settings.nrOfTimesToHalveBorderSegments, () => {});
    await FacetLabelPlacer.buildFacetLabelBounds(facetResult, () => {});

    const svg = createSVG(facetResult, colormapResult.colorsByIndex, 2, true, true, true, 40, '#333');

    const palette = colormapResult.colorsByIndex.map((color: any, index: number) => ({
      number: index,
      r: color[0], g: color[1], b: color[2]
    }));

    res.json({ svg, palette });
  } catch (error: any) {
    console.error('Processing error:', error);
    res.status(500).json({ error: 'Processing failed', details: error.message });
  }
});

function createSVG(facetResult: any, colorsByIndex: any, sizeMultiplier: number, fill: boolean, stroke: boolean, addColorLabels: boolean, fontSize: number, fontColor: string) {
  let svgString = '';
  const xmlns = 'http://www.w3.org/2000/svg';
  const svgWidth = sizeMultiplier * facetResult.width;
  const svgHeight = sizeMultiplier * facetResult.height;
  svgString += `<?xml version="1.0" standalone="no"?><svg width="${svgWidth}" height="${svgHeight}" xmlns="${xmlns}">`;

  for (const f of facetResult.facets) {
    if (f != null && f.borderSegments.length > 0) {
      let newpath = f.getFullPathFromBorderSegments(false);
      if (newpath[0].x !== newpath[newpath.length - 1].x || newpath[0].y !== newpath[newpath.length - 1].y) {
        newpath.push(newpath[0]);
      }
      let data = 'M ';
      data += newpath[0].x * sizeMultiplier + ' ' + newpath[0].y * sizeMultiplier + ' ';
      for (let i = 1; i < newpath.length; i++) {
        const midpointX = (newpath[i].x + newpath[i - 1].x) / 2;
        const midpointY = (newpath[i].y + newpath[i - 1].y) / 2;
        data += 'Q ' + (midpointX * sizeMultiplier) + ' ' + (midpointY * sizeMultiplier) + ' ' + (newpath[i].x * sizeMultiplier) + ' ' + (newpath[i].y * sizeMultiplier) + ' ';
      }
      let svgStroke = stroke ? '#000' : (fill ? `rgb(${colorsByIndex[f.color][0]},${colorsByIndex[f.color][1]},${colorsByIndex[f.color][2]})` : '');
      let svgFill = fill ? `rgb(${colorsByIndex[f.color][0]},${colorsByIndex[f.color][1]},${colorsByIndex[f.color][2]})` : 'none';

      svgString += `<path data-facetId="${f.id}" d="${data}" style="fill: ${svgFill};${svgStroke ? `stroke: ${svgStroke}; stroke-width:1px` : ''}"></path>`;

      if (addColorLabels) {
        const labelOffsetX = f.labelBounds.minX * sizeMultiplier;
        const labelOffsetY = f.labelBounds.minY * sizeMultiplier;
        const labelWidth = f.labelBounds.width * sizeMultiplier;
        const labelHeight = f.labelBounds.height * sizeMultiplier;
        const nrOfDigits = (f.color + '').length;
        svgString += `<g class="label" transform="translate(${labelOffsetX},${labelOffsetY})"><svg width="${labelWidth}" height="${labelHeight}" overflow="visible" viewBox="-50 -50 100 100" preserveAspectRatio="xMidYMid meet"><text font-family="Tahoma" font-size="${(fontSize / nrOfDigits)}" dominant-baseline="middle" text-anchor="middle" fill="${fontColor}">${f.color}</text></svg></g>`;
      }
    }
  }
  svgString += '</svg>';
  return svgString;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PaintSnap API running on port ${PORT}`);
});
