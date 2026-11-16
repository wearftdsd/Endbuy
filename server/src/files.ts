import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import type { DB } from './db.js';
import { HttpError, randomHex } from './util.js';

/* ------------------------------------------------------------------ */
/* Stockage : disque (défaut) ou base PostgreSQL (UPLOAD_STORAGE=database) */
/* ------------------------------------------------------------------ */
interface StorageConfig {
  mode: 'disk' | 'database';
  db: DB | null;
  uploadsDir: string;
}
const storage: StorageConfig = { mode: 'disk', db: null, uploadsDir: '' };

export function configureStorage(cfg: StorageConfig) {
  Object.assign(storage, cfg);
}

/** À appeler une fois le fichier validé : en mode base, il est copié en base puis retiré du disque. */
export async function persistUpload(kind: UploadKind, filename: string) {
  if (storage.mode !== 'database' || !storage.db) return;
  const file = path.join(storage.uploadsDir, kind, filename);
  const data = await fs.promises.readFile(file);
  await storage.db.query(
    'INSERT INTO file_blobs (name, kind, content_type, size, data) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (name) DO NOTHING',
    [`${kind}/${filename}`, kind, contentTypeFor(filename), data.length, data],
  );
  fs.promises.unlink(file).catch(() => {});
}

export const UPLOAD_KINDS = ['attachments', 'avatars', 'banners', 'icons', 'emojis'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/** Types servis « en ligne ». Tout le reste est forcé en téléchargement (anti-XSS). */
const INLINE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
};

export function ensureUploadDirs(uploadsDir: string) {
  for (const k of UPLOAD_KINDS) fs.mkdirSync(path.join(uploadsDir, k), { recursive: true });
}

function safeExt(name: string): string {
  const ext = path.extname(name || '').toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '.bin';
}

export function contentTypeFor(filename: string): string {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return INLINE_TYPES[ext] ?? 'application/octet-stream';
}

export function makeUpload(uploadsDir: string, kind: UploadKind, opts: { maxBytes: number; maxFiles: number; field: string }) {
  const storage = multer.diskStorage({
    destination: path.join(uploadsDir, kind),
    filename: (_req, file, cb) => cb(null, randomHex(16) + safeExt(file.originalname)),
  });
  const m = multer({ storage, limits: { fileSize: opts.maxBytes, files: opts.maxFiles, fields: 20, fieldSize: 64 * 1024 } });
  const handler = opts.maxFiles > 1 ? m.array(opts.field, opts.maxFiles) : m.single(opts.field);
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          const mb = Math.round(opts.maxBytes / 1024 / 1024);
          return next(new HttpError(413, `Fichier trop volumineux (maximum ${mb} Mo).`, 'FILE_TOO_LARGE'));
        }
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
          return next(new HttpError(400, `Trop de fichiers (maximum ${opts.maxFiles}).`, 'TOO_MANY_FILES'));
        }
        return next(new HttpError(400, err.message, 'UPLOAD'));
      }
      next(err);
    });
  };
}

export function publicPath(kind: UploadKind, filename: string) {
  return `/uploads/${kind}/${filename}`;
}

export function removeUpload(uploadsDir: string, publicUrl: string | null | undefined) {
  if (!publicUrl) return;
  const m = /^\/uploads\/([a-z]+)\/([a-f0-9]{32}\.[a-z0-9]{1,8})$/.exec(publicUrl);
  if (!m || !(UPLOAD_KINDS as readonly string[]).includes(m[1])) return;
  if (storage.mode === 'database' && storage.db) {
    storage.db.query('DELETE FROM file_blobs WHERE name = $1', [`${m[1]}/${m[2]}`]).catch(() => {});
    return;
  }
  fs.promises.unlink(path.join(uploadsDir, m[1], m[2])).catch(() => {});
}

export function discardFiles(files: Express.Multer.File[] | undefined) {
  for (const f of files ?? []) fs.promises.unlink(f.path).catch(() => {});
}

/** Vérifie la signature binaire d'une image. Retourne le format détecté. */
export function detectImage(filePath: string): 'png' | 'jpeg' | 'gif' | 'webp' | null {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(12);
  try {
    fs.readSync(fd, buf, 0, 12, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Valide une image téléversée ; la renomme avec la bonne extension. */
export function acceptImage(file: Express.Multer.File | undefined, opts: { allowAnimated: boolean }) {
  if (!file) throw new HttpError(400, 'Aucune image reçue.', 'NO_FILE');
  const kind = detectImage(file.path);
  if (!kind) {
    discardFiles([file]);
    throw new HttpError(400, 'Format non pris en charge (PNG, JPEG, GIF ou WebP).', 'BAD_IMAGE');
  }
  if (kind === 'gif' && !opts.allowAnimated) {
    discardFiles([file]);
    throw new HttpError(403, 'Les avatars animés nécessitent endBuy Nitro.', 'NITRO_REQUIRED');
  }
  const ext = kind === 'jpeg' ? '.jpg' : `.${kind}`;
  const finalName = path.basename(file.filename, path.extname(file.filename)) + ext;
  if (finalName !== file.filename) {
    fs.renameSync(file.path, path.join(path.dirname(file.path), finalName));
  }
  return { filename: finalName, animated: kind === 'gif' };
}

/** Sert les fichiers téléversés de façon sûre. */
export function serveUploads(uploadsDir: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const kind = String(req.params.kind);
    const file = String(req.params.file);
    if (!(UPLOAD_KINDS as readonly string[]).includes(kind) || !/^[a-f0-9]{32}\.[a-z0-9]{1,8}$/.test(file)) {
      return next(new HttpError(404, 'Fichier introuvable.', 'NOT_FOUND'));
    }
    const type = contentTypeFor(file);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    if (type === 'application/octet-stream') res.setHeader('Content-Disposition', 'attachment');
    if (storage.mode === 'database' && storage.db) {
      storage.db
        .one<{ data: Uint8Array; size: number }>('SELECT data, size FROM file_blobs WHERE name = $1', [`${kind}/${file}`])
        .then((row) => {
          if (!row) return next(new HttpError(404, 'Fichier introuvable.', 'NOT_FOUND'));
          const buf = Buffer.from(row.data);
          res.setHeader('Content-Type', type);
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          res.setHeader('Accept-Ranges', 'bytes');
          const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
          if (range && (range[1] || range[2])) {
            let start = range[1] ? Number(range[1]) : buf.length - Number(range[2]);
            let end = range[1] && range[2] ? Number(range[2]) : buf.length - 1;
            start = Math.max(0, start);
            end = Math.min(buf.length - 1, end);
            if (start > end) {
              res.status(416).setHeader('Content-Range', `bytes */${buf.length}`);
              return res.end();
            }
            res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${buf.length}`);
            res.setHeader('Content-Length', String(end - start + 1));
            return res.end(buf.subarray(start, end + 1));
          }
          res.setHeader('Content-Length', String(buf.length));
          res.end(buf);
        })
        .catch(next);
      return;
    }
    res.sendFile(
      path.join(uploadsDir, kind, file),
      { headers: { 'Content-Type': type }, maxAge: '365d', immutable: true, dotfiles: 'deny' },
      (err) => {
        if (err && !res.headersSent) next(new HttpError(404, 'Fichier introuvable.', 'NOT_FOUND'));
      },
    );
  };
}
