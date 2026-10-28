import { randomUUID } from 'node:crypto';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';

const uploadsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'uploads');

// Whitelist por extensión — el mimetype lo declara el cliente y se
// falsifica; la extensión decide cómo express.static sirve el archivo.
// SVG fuera: un <script> en un .svg servido same-origin es XSS propio
// (nosniff no lo cubre si se navega directo al archivo).
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']);

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) =>
      cb(null, randomUUID() + extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    const ok = file.mimetype.startsWith('image/') && ALLOWED_EXT.has(ext);
    cb(null, ok);
  },
});

// POST /api/uploads — campo "file" (image/*, máx 5MB). Responde
// { url: "/uploads/<file>" } — el path se guarda en la entidad y lo
// sirve express.static en /uploads.
const router = Router();
router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'se requiere un archivo image/* en el campo "file"' });
  }
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

export default router;
