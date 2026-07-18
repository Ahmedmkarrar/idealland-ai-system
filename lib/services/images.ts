// Local persistence for AI-generated images.
//
// Why this exists: DALL-E hands back a URL on an OpenAI blob host that expires
// after ~1 hour. Storing that URL means every social post older than an hour
// points at nothing. We ask OpenAI for the raw bytes instead and keep our own
// copy, served back through /api/images/[file].
//
// Where the bytes live: a gitignored `storage/` dir inside the app directory.
// That mirrors how prisma/dev.db already survives deploys — `git pull --ff-only`
// and `next build` both leave ignored paths alone. Note `public/` would NOT
// work here: it is baked into the build and sits in the git working tree.
//
// Like pdf.ts, everything here returns null on failure rather than throwing —
// an image is optional enrichment on a social post, never a hard dependency.
import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const STORAGE_DIR = path.join(process.cwd(), "storage", "social-images");

// Filenames we generate ourselves: a UUID plus extension, nothing else. Any
// request for a name outside this shape is rejected before touching the disk,
// so "../../.env.local" can never resolve.
const SAFE_FILENAME = /^[a-f0-9-]{36}\.png$/;

export function isSafeImageFilename(filename: string): boolean {
  return SAFE_FILENAME.test(filename);
}

// Writes raw PNG bytes to storage and returns the filename to persist on the
// SocialPost row. Returns null if the write fails — the caller keeps the post,
// just without an image.
export async function persistImage(bytes: Uint8Array): Promise<string | null> {
  try {
    await mkdir(STORAGE_DIR, { recursive: true });
    const filename = `${randomUUID()}.png`;
    await writeFile(path.join(STORAGE_DIR, filename), bytes);
    return filename;
  } catch {
    return null;
  }
}

// Reads a stored image back. Returns null for unknown or unsafe names, which
// the route handler turns into a 404.
export async function readStoredImage(filename: string): Promise<Buffer | null> {
  if (!isSafeImageFilename(filename)) return null;

  try {
    return await readFile(path.join(STORAGE_DIR, filename));
  } catch {
    return null;
  }
}
