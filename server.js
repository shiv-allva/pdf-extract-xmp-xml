// server.js - Enhanced PDF XMP extractor (handles FlateDecode metadata streams)
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

const app = express();
// limit: 20 MB
const upload = multer({ dest: 'uploads/', limits: { fileSize: 20 * 1024 * 1024 } });

app.use(express.static(path.join(__dirname, 'public')));

/**
 * Try simple text search for XMP inside the raw PDF bytes.
 * If not found, scan PDF objects for metadata streams and attempt to decode them
 * (supports FlateDecode). This won't cover every exotic PDF encoding but handles
 * the common cases.
 */
function extractXMP(buffer) {
  // Try to find plain XMP first (latin1 preserves bytes)
  const s = buffer.toString('latin1');
  const pktRe = /<\?xpacket[\s\S]*?\?>[\s\S]*?<\?xpacket[\s\S]*?\?>/i;
  const xmpMetaTagRe = /<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/i;

  let match = s.match(pktRe);
  if (match) return match[0];

  match = s.match(xmpMetaTagRe);
  if (match) return match[0];

  // If not found, search for PDF stream objects that may contain XML metadata.
  // We'll look for 'obj' ... 'endobj' blocks with 'Metadata' or '/Type /Metadata' or '/Subtype /XML' and a following stream..endstream
  const objRe = /(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g;
  let m;
  while ((m = objRe.exec(s)) !== null) {
    const objText = m[3];
    // Quick check
    if (!/Metadata|Type\s*\/Metadata|\/Subtype\s*\/XML/i.test(objText)) continue;
    // Find stream content inside this object
    const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/i;
    const streamMatch = objText.match(streamRe);
    if (!streamMatch) continue;
    const streamRaw = streamMatch[1];

    // Determine Filters from the object's dictionary (before 'stream')
    const dict = objText.split('stream')[0];
    const isFlate = /\/Filter\s*\/FlateDecode/i.test(dict) || /\/Filter\s*\[\s*\/FlateDecode/i.test(dict);
    try {
      let dataBuf;
      if (isFlate) {
        // The bytes in streamRaw are currently represented as latin1 characters in 's' string slice.
        // Convert that slice back to a Buffer of bytes.
        const byteBuf = Buffer.from(streamRaw, 'latin1');
        // Try to inflate (zlib)
        const inflated = zlib.inflateSync(byteBuf);
        const txt = inflated.toString('utf8');
        // Search for XMP inside
        const xm = txt.match(pktRe) || txt.match(xmpMetaTagRe);
        if (xm) return xm[0];
      } else {
        // Not compressed - take as latin1 -> utf8
        const txt = Buffer.from(streamRaw, 'latin1').toString('utf8');
        const xm = txt.match(pktRe) || txt.match(xmpMetaTagRe);
        if (xm) return xm[0];
      }
    } catch (err) {
      // ignore and continue scanning other objects
      console.error('Decompress error for an object:', err.message);
      continue;
    }
  }

  // As a last resort: search for raw "<?xpacket" bytes in the file buffer using utf8/latin1 heuristics
  const rawIdx = buffer.indexOf(Buffer.from('<?xpacket'));
  if (rawIdx !== -1) {
    // Try to extract until '</x:xmpmeta>' sequence
    const endTag = Buffer.from('</x:xmpmeta>');
    const endIdx = buffer.indexOf(endTag, rawIdx);
    if (endIdx !== -1) {
      const slice = buffer.slice(rawIdx, endIdx + endTag.length);
      try {
        return slice.toString('utf8');
      } catch (e) {
        return slice.toString('latin1');
      }
    }
  }

  return null;
}

app.post('/upload', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const filePath = req.file.path;
  try {
    const buffer = fs.readFileSync(filePath);
    const xmp = extractXMP(buffer);

    if (!xmp) {
      fs.unlinkSync(filePath);
      return res.status(404).json({ error: 'No XMP metadata found in this PDF.' });
    }

    const outName = path.basename(req.file.originalname, path.extname(req.file.originalname)) + '_xmp.xml';
    // Try to normalize to utf-8
    let utf8text;
    try {
      utf8text = Buffer.from(xmp, 'latin1').toString('utf8');
    } catch (e) {
      utf8text = xmp;
    }

    res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.send(utf8text);
  } catch (err) {
    console.error(err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Max allowed = 20 MB.' });
    }
    res.status(500).json({ error: 'Internal error' });
  } finally {
    try { fs.unlinkSync(filePath); } catch (e) {}
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
