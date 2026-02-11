const fs = require('fs');
const QueryStream = require('pg-query-stream');
const csv = require('fast-csv');
const db = require('./db');

const activeJobs = new Map();


async function startExport(job) {
  const { id, filters, columns, delimiter, quoteChar, filePath } = job;
  console.log(`Starting export job ${id}`);
  const client = await db.pool.connect();
  try {
    // Build WHERE clause
    const where = [];
    const params = [];
    let idx = 1;
    if (filters.country_code) {
      where.push(`country_code = $${idx++}`);
      params.push(filters.country_code);
    }
    if (filters.subscription_tier) {
      where.push(`subscription_tier = $${idx++}`);
      params.push(filters.subscription_tier);
    }
    if (filters.min_ltv) {
      where.push(`lifetime_value >= $${idx++}`);
      params.push(filters.min_ltv);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // count total
  const countRes = await client.query(`SELECT COUNT(*)::bigint as cnt FROM users ${whereSql}`, params);
  const total = parseInt(countRes.rows[0].cnt, 10);
  await db.query('UPDATE exports SET total_rows = $1, status = $2 WHERE id = $3', [total, 'processing', id]);

    // columns
    const cols = (columns && columns.length) ? columns : ['id','name','email','signup_date','country_code','subscription_tier','lifetime_value'];
    const select = cols.map(c => c).join(', ');

    const sql = `SELECT ${select} FROM users ${whereSql}`;
    const qs = new QueryStream(sql, params, { batchSize: 1000 });
    const stream = client.query(qs);

    const writeStream = fs.createWriteStream(filePath);
    const csvStream = csv.format({ headers: cols, delimiter: delimiter || ',', quote: quoteChar || '"' });

    let processed = 0;
    let cancelled = false;
    activeJobs.set(id, { cancel: () => { cancelled = true; stream.destroy(new Error('cancelled')); csvStream.end(); } });

    
    stream.on('data', (row) => {
      if (cancelled) return;
      if (!csvStream.write(row)) {
        stream.pause();
      }
      processed += 1;
      if (processed % 1000 === 0) {
        db.query('UPDATE exports SET processed_rows = $1 WHERE id = $2', [processed, id]).catch(() => {});
      }
    });

    csvStream.on('drain', () => {
      if (!cancelled) stream.resume();
    });

    stream.on('end', () => {
      if (!cancelled) csvStream.end();
    });

    csvStream.pipe(writeStream);

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      stream.on('error', reject);
      csvStream.on('error', reject);
    });

    if (!cancelled) {
      await db.query('UPDATE exports SET processed_rows = $1, status = $2, completed_at = NOW() WHERE id = $3', [total, 'completed', id]);
      console.log(`Export job ${id} completed successfully`);
    } else {
      await db.query('UPDATE exports SET status = $1, completed_at = NOW() WHERE id = $2', ['cancelled', id]);
      console.log(`Export job ${id} cancelled`);
    }
  } catch (err) {
    if (String(err).includes('cancelled')) {
      await db.query('UPDATE exports SET status = $1, completed_at = NOW() WHERE id = $2', ['cancelled', id]);
      console.log(`Export job ${id} cancelled`);
    } else {
      console.error(`Export job ${id} failed:`, err);
      await db.query('UPDATE exports SET status = $1, error = $2 WHERE id = $3', ['failed', String(err), id]);
    }
  } finally {
    activeJobs.delete(id);
    client.release();
  }
}

function cancelJob(id) {
  const j = activeJobs.get(id);
  if (j && j.cancel) j.cancel();
}

module.exports = { startExport, cancelJob, activeJobs };
