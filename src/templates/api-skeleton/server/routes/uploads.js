import { randomUUID } from 'node:crypto';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';

const uploadsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'uploads');

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) =>
      cb(null, randomUUID() + extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
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
