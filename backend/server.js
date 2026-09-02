require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketPolicyCommand,
} = require('@aws-sdk/client-s3');

const app = express();
app.use(cors());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// --- Postgres (stores file metadata) ---
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'gallerydb',
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS files (
      id UUID PRIMARY KEY,
      original_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      size_bytes INTEGER NOT NULL,
      object_key VARCHAR(255) NOT NULL,
      uploaded_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('[db] schema ready');
}

// --- MinIO (S3-compatible object storage, stores the actual file bytes) ---
const BUCKET = process.env.MINIO_BUCKET || 'gallery';

const s3 = new S3Client({
  endpoint: `http://${process.env.MINIO_HOST || 'localhost'}:${process.env.MINIO_PORT || 9000}`,
  region: 'us-east-1', // required by SDK, MinIO ignores it
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
  },
  forcePathStyle: true, // required for MinIO
});

async function initBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    console.log(`[minio] bucket "${BUCKET}" already exists`);
  } catch (err) {
    console.log(`[minio] creating bucket "${BUCKET}"`);
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  }

  // Public-read policy so the browser can load images directly from MinIO.
  // Applied every startup (not just on creation) — PutBucketPolicy is
  // idempotent, and this avoids the bucket staying "private" forever if it
  // already existed from an earlier run (e.g. leftover volume) without ever
  // getting the policy applied.
  // NOTE: fine for this learning project; a real app would use presigned
  // URLs or serve files through the backend instead of a public bucket.
  const policy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: '*',
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${BUCKET}/*`],
      },
    ],
  };
  await s3.send(
    new PutBucketPolicyCommand({ Bucket: BUCKET, Policy: JSON.stringify(policy) })
  );
}

// Public URL the *browser* uses to fetch the file directly from MinIO.
// This is intentionally separate from MINIO_HOST/MINIO_PORT above, which is
// how the *backend container* reaches MinIO over the internal docker network.
// The browser instead needs MinIO's port published to the host.
function publicFileUrl(objectKey) {
  const base = process.env.MINIO_PUBLIC_URL || 'http://localhost:9000';
  return `${base}/${BUCKET}/${objectKey}`;
}

// --- Routes ---
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/files', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, original_name, mime_type, size_bytes, object_key, uploaded_at FROM files ORDER BY uploaded_at DESC LIMIT 100'
    );
    const files = result.rows.map((f) => ({
      id: f.id,
      name: f.original_name,
      mimeType: f.mime_type,
      sizeBytes: f.size_bytes,
      uploadedAt: f.uploaded_at,
      url: publicFileUrl(f.object_key),
    }));
    res.json(files);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });

  const id = uuidv4();
  const objectKey = `${id}-${req.file.originalname}`;

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: objectKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );

    await pool.query(
      'INSERT INTO files (id, original_name, mime_type, size_bytes, object_key) VALUES ($1, $2, $3, $4, $5)',
      [id, req.file.originalname, req.file.mimetype, req.file.size, objectKey]
    );

    res.json({
      id,
      name: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      url: publicFileUrl(objectKey),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'upload_failed' });
  }
});

app.delete('/api/files/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT object_key FROM files WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'not_found' });

    const { object_key } = result.rows[0];
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: object_key }));
    await pool.query('DELETE FROM files WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  }
});

const PORT = process.env.PORT || 4000;

(async () => {
  const maxRetries = 15;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await initDb();
      await initBucket();
      break;
    } catch (err) {
      console.error(`[startup] attempt ${attempt}/${maxRetries} failed:`, err.message);
      if (attempt === maxRetries) process.exit(1);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  app.listen(PORT, () => console.log(`[server] listening on port ${PORT}`));
})();
