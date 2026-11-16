// Saves leaf photos privately: Supabase Storage when live, a local folder in dev
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Largest photo allowed (10 MB)
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Allowed image types and their file extensions
const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Local folder where photos are saved in development
function uploadDir() {
  return path.resolve(process.env.DISEASE_IMAGE_UPLOAD_DIR ?? ".data/disease-predictions");
}

// Supabase Storage settings, or null if not configured
function supabase() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  // Old service_role key or newer secret key (sb_secret_…) both work
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return { url, key, bucket: process.env.SUPABASE_STORAGE_BUCKET || "disease-images" };
}

// Throws if the photo is not JPEG/PNG/WebP or is empty or too big
export function validateDiseaseImage(file: Blob) {
  if (!(file.type in extensions)) {
    throw new Error("Upload a JPEG, PNG, or WebP image");
  }
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error("Image must be between 1 byte and 10 MB");
  }
}

// Blocks bad file names (e.g. "../") so only our own photos can be read
function checkRef(imageRef: string) {
  if (!/^[a-f0-9-]+\.(jpg|png|webp)$/i.test(imageRef)) {
    throw new Error("Invalid disease image reference");
  }
}

// Full local path of a saved photo
export function diseaseImagePath(imageRef: string) {
  checkRef(imageRef);
  return path.join(uploadDir(), imageRef);
}

// ---------- Supabase Storage (REST, no extra dependency) ----------

// Supabase settings once we know they exist
type Store = NonNullable<ReturnType<typeof supabase>>;

// Login headers for Supabase requests
function headers(store: Store, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${store.key}`, apikey: store.key, ...extra };
}

// Creates the private photo bucket if it doesn't exist yet
async function ensureBucket(store: Store) {
  const res = await fetch(`${store.url}/storage/v1/bucket`, {
    method: "POST",
    headers: headers(store, { "Content-Type": "application/json" }),
    body: JSON.stringify({ id: store.bucket, name: store.bucket, public: false }),
  });
  // 200 = created; 400/409 = already exists.
  if (!res.ok && res.status !== 400 && res.status !== 409) {
    throw new Error(`Couldn't create storage bucket (${res.status})`);
  }
}

// Uploads one photo to Supabase Storage
async function upload(store: Store, imageRef: string, body: Buffer, contentType: string) {
  return fetch(`${store.url}/storage/v1/object/${store.bucket}/${imageRef}`, {
    method: "POST",
    headers: headers(store, { "Content-Type": contentType, "x-upsert": "false" }),
    body: new Uint8Array(body),
  });
}

// ---------- Public API ----------

// Saves a leaf photo under a random name and returns its reference
export async function saveDiseaseImage(file: Blob) {
  validateDiseaseImage(file);
  const imageRef = `${randomUUID()}.${extensions[file.type]}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const store = supabase();

  if (store) {
    let res = await upload(store, imageRef, bytes, file.type);
    if (!res.ok) {
      // First upload on a new project: the bucket doesn't exist yet.
      await ensureBucket(store);
      res = await upload(store, imageRef, bytes, file.type);
    }
    if (!res.ok) throw new Error(`Couldn't store the image (${res.status})`);
  } else {
    await mkdir(uploadDir(), { recursive: true });
    await writeFile(path.join(uploadDir(), imageRef), bytes);
  }
  return { imageRef, imageMimeType: file.type };
}

// Reads a saved photo's bytes, or null if it is missing
export async function readDiseaseImage(imageRef: string): Promise<Buffer | null> {
  checkRef(imageRef);
  const store = supabase();
  if (store) {
    const res = await fetch(`${store.url}/storage/v1/object/${store.bucket}/${imageRef}`, { headers: headers(store) });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  }
  try {
    return await readFile(diseaseImagePath(imageRef));
  } catch {
    return null;
  }
}

// Deletes a saved photo (ignores errors if already gone)
export async function deleteDiseaseImage(imageRef: string) {
  checkRef(imageRef);
  const store = supabase();
  if (store) {
    await fetch(`${store.url}/storage/v1/object/${store.bucket}`, {
      method: "DELETE",
      headers: headers(store, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: [imageRef] }),
    }).catch(() => undefined);
    return;
  }
  await rm(diseaseImagePath(imageRef), { force: true });
}
