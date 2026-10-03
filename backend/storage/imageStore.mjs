import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TYPES = {
  "image/jpeg": { extension: ".jpg", matches: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  "image/png": { extension: ".png", matches: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { extension: ".webp", matches: (buffer) => buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP" }
};

function uploadRoot() {
  const configured = process.env.UPLOAD_DIR || "data/uploads";
  return path.isAbsolute(configured) ? configured : path.join(ROOT, configured);
}

export function partnerUploadFolder(partnerId) {
  return String(partnerId || "partner").replace(/[^a-zA-Z0-9_-]/g, "-");
}

function uploadError(message, code = "INVALID_IMAGE", status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function parseImageData(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match || !TYPES[match[1]]) throw uploadError("Поддерживаются только JPEG, PNG и WebP");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 4 * 1024 * 1024) throw uploadError("Размер одного фото должен быть не больше 4 МБ", "IMAGE_TOO_LARGE", 413);
  if (!TYPES[match[1]].matches(buffer)) throw uploadError("Содержимое файла не соответствует формату изображения");
  return { buffer, mimeType: match[1], extension: TYPES[match[1]].extension };
}

function directoryBytes(directory) {
  if (!fs.existsSync(directory)) return 0;
  if (!fs.lstatSync(directory).isDirectory()) throw uploadError("Хранилище фото недоступно", "UPLOAD_STORAGE_UNSAFE", 503);
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw uploadError("Хранилище фото требует проверки", "UPLOAD_STORAGE_UNSAFE", 503);
    return total + (entry.isDirectory() ? directoryBytes(file) : fs.statSync(file).size);
  }, 0);
}

function quotaBytes(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw uploadError("Лимит хранилища фото настроен неверно", "UPLOAD_QUOTA_CONFIGURATION", 503);
  return value;
}

export function savePartnerImages(partnerId, images) {
  if (!Array.isArray(images) || images.length < 1 || images.length > 3) {
    throw uploadError("Добавьте от одного до трёх фото");
  }
  const folder = partnerUploadFolder(partnerId);
  const directory = path.join(uploadRoot(), folder);
  const parsedImages = images.map((image) => parseImageData(image?.dataUrl));
  const incoming = parsedImages.reduce((total, image) => total + image.buffer.length, 0);
  if (directoryBytes(directory) + incoming > quotaBytes("UPLOAD_PARTNER_MAX_BYTES", 100 * 1024 * 1024)) throw uploadError("Лимит фотографий заведения исчерпан. Обратитесь в поддержку.", "PARTNER_UPLOAD_QUOTA", 413);
  if (directoryBytes(uploadRoot()) + incoming > quotaBytes("UPLOAD_TOTAL_MAX_BYTES", 2 * 1024 * 1024 * 1024)) throw uploadError("Загрузка фото временно закрыта. Обратитесь в поддержку.", "TOTAL_UPLOAD_QUOTA", 503);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const createdAt = new Date().toISOString();
  const saved = [];
  try {
    for (const [index, image] of images.entries()) {
      const parsed = parsedImages[index];
      const filename = `${crypto.randomUUID()}${parsed.extension}`;
      const filePath = path.join(directory, filename);
      fs.writeFileSync(filePath, parsed.buffer, { mode: 0o600, flag: "wx" });
      saved.push({
        url: `/uploads/${folder}/${filename}`,
        mimeType: parsed.mimeType,
        size: parsed.buffer.length,
        capturedAt: image?.capturedAt && !Number.isNaN(Date.parse(image.capturedAt)) ? new Date(image.capturedAt).toISOString() : createdAt,
        filePath
      });
    }
  } catch (error) {
    for (const item of saved) fs.rmSync(item.filePath, { force: true });
    throw error;
  }
  return saved.map(({ filePath, ...item }) => item);
}

export function resolveUploadedImage(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const match = decoded.match(/^\/uploads\/([a-zA-Z0-9_-]+)\/([a-f0-9-]+\.(?:jpg|png|webp))$/);
  if (!match) return null;
  const filePath = path.join(uploadRoot(), match[1], match[2]);
  const root = path.resolve(uploadRoot());
  if (!path.resolve(filePath).startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath)) return null;
  const contentType = { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }[path.extname(filePath)];
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? { filePath, contentType, size: stat.size } : null;
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code)) return null;
    throw error;
  }
}
