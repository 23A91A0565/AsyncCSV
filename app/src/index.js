require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { startExport, cancelJob } = require('./exporter');

const app = express();
const PORT = process.env.API_PORT || 8080;
const EXPORT_PATH = process.env.EXPORT_STORAGE_PATH || path.join(__dirname, '..', 'exports');

if (!fs.existsSync(EXPORT_PATH)) fs.mkdirSync(EXPORT_PATH, { recursive: true });

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/exports/csv', async (req, res) => {
  const filters = {
    country_code: req.query.country_code,
    subscription_tier: req.query.subscription_tier,
    min_ltv: req.query.min_ltv ? Number(req.query.min_ltv) : undefined,
  };
  const columns = req.query.columns ? req.query.columns.split(',').map(s => s.trim()) : null;
  const delimiter = req.query.delimiter || ',';
  const quoteChar = req.query.quoteChar || '"';

  const id = uuidv4();
  const fileName = `export_${id}.csv`;
  const filePath = path.join(EXPORT_PATH, fileName);

  await db.query('INSERT INTO exports (id, status, columns, delimiter, quote_char, file_path) VALUES ($1,$2,$3,$4,$5,$6)', [id, 'pending', columns ? columns.join(',') : null, delimiter, quoteChar, filePath]);

  // Start background job
  const job = { id, filters, columns, delimiter, quoteChar, filePath };
  // Do not block: start asynchronously
  startExport(job).catch(err => console.error('Export job error:', err));

  res.status(202).json({ exportId: id, status: 'pending' });
});

app.get('/exports/:id/status', async (req, res) => {
  const id = req.params.id;
  const r = await db.query('SELECT id, status, total_rows, processed_rows, error, created_at, completed_at, columns FROM exports WHERE id = $1', [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
  const row = r.rows[0];
  const total = Number(row.total_rows || 0);
  const processed = Number(row.processed_rows || 0);
  const percentage = total ? Math.floor((processed / total) * 100) : 0;
  res.json({
    exportId: row.id,
    status: row.status,
    progress: { totalRows: total, processedRows: processed, percentage },
    error: row.error || null,
    createdAt: row.created_at,
    completedAt: row.completed_at || null
  });
});

app.get('/exports/:id/download', async (req, res) => {
  const id = req.params.id;
  const r = await db.query('SELECT file_path, status FROM exports WHERE id = $1', [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
  const row = r.rows[0];
  if (row.status !== 'completed') return res.status(425).json({ error: 'export not ready' });
  const filePath = row.file_path;
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file missing' });

  const acceptEnc = req.headers['accept-encoding'] || '';
  const useGzip = acceptEnc.includes('gzip');

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="export_${id}.csv"`);
  res.setHeader('Accept-Ranges', 'bytes');

  if (useGzip) {
    res.setHeader('Content-Encoding', 'gzip');
    // stream compressed, no Content-Length
    const read = fs.createReadStream(filePath);
    const gz = require('zlib').createGzip();
    read.pipe(gz).pipe(res);
    return;
  }

  // Handle Range header for resumable download
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    if (isNaN(start) || isNaN(end) || start > end || start >= stat.size) return res.status(416).end();
    const chunkSize = (end - start) + 1;
    res.status(206);
    res.setHeader('Content-Length', chunkSize);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
    return;
  }

  res.setHeader('Content-Length', stat.size);
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});

app.delete('/exports/:id', async (req, res) => {
  const id = req.params.id;
  const r = await db.query('SELECT file_path, status FROM exports WHERE id = $1', [id]);
  if (r.rowCount === 0) return res.status(404).end();
  const row = r.rows[0];
  // cancel background job
  cancelJob(id);
  // update status and remove file
  await db.query('UPDATE exports SET status = $1 WHERE id = $2', ['cancelled', id]);
  try { if (row.file_path && fs.existsSync(row.file_path)) fs.unlinkSync(row.file_path); } catch (_) {}
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
