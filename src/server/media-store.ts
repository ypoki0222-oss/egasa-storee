// Egasa no-card edition — Media storage adapter (Firebase Storage, Spark free tier).
//
// Product images live in Firebase Storage (5 GB free, no credit card). The Worker
// never proxies image bytes: it signs short-lived Google Cloud Storage URLs with
// the standard Web Crypto API (SubtleCrypto, RSASSA-PKCS1-v1_5 + SHA-256) and the
// admin browser uploads directly. The storefront /media/:id route issues a cached
// 302 redirect to the public object URL.
//
// No node:crypto / no heavy SDK is pulled into the Worker bundle.
import type { Env } from './db';

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function serviceAccount(env: Env): ServiceAccount {
  const raw = env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT secret is not set.');
  let text = raw.trim();
  // Accept either raw JSON or base64-encoded JSON (wrangler secret paste can
  // struggle with multi-line PEM; base64 is a documented fallback).
  if (!text.startsWith('{')) {
    try {
      text = new TextDecoder().decode(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)));
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT is neither JSON nor base64(JSON).');
    }
  }
  const parsed = JSON.parse(text) as Partial<ServiceAccount>;
  if (!parsed.client_email || !parsed.private_key)
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing client_email or private_key.');
  return parsed as ServiceAccount;
}

export function mediaConfigured(env: Env): boolean {
  return Boolean(env.FIREBASE_STORAGE_BUCKET && env.FIREBASE_SERVICE_ACCOUNT);
}

export function mediaBucket(env: Env): string {
  const bucket = env.FIREBASE_STORAGE_BUCKET;
  if (!bucket) throw new Error('FIREBASE_STORAGE_BUCKET is not configured.');
  // Accept either "bucket" or "gs://bucket" or "bucket.appspot.com".
  return bucket.replace(/^gs:\/\//, '').replace(/\/$/, '');
}

/** Public, cacheable storefront URL for an image. Used for the 302 redirect. */
export function mediaPublicUrl(env: Env, id: string): string {
  const bucket = mediaBucket(env);
  return (
    'https://firebasestorage.googleapis.com/v0/b/' +
    bucket +
    '/o/' +
    encodeURIComponent(id) +
    '?alt=media'
  );
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function signBytes(privateKeyPem: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(data),
  );
  let binary = '';
  const bytes = new Uint8Array(signature);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

async function signUrl(
  env: Env,
  verb: 'PUT' | 'DELETE',
  id: string,
  contentType: string,
  ttlSeconds = 900,
): Promise<string> {
  const account = serviceAccount(env);
  const bucket = mediaBucket(env);
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  // GCS V2 signed URL canonical resource. Extension headers are empty.
  const canonical = [
    verb,
    '',
    contentType === 'DELETE' ? '' : contentType,
    String(expires),
    '',
    `/${bucket}/${id}`,
  ].join('\n');
  const signature = await signBytes(account.private_key, canonical);
  const params = new URLSearchParams({
    GoogleAccessId: account.client_email,
    Expires: String(expires),
    Signature: signature,
  });
  return `https://storage.googleapis.com/${bucket}/${encodeURIComponent(id)}?${params.toString()}`;
}

/** Short-lived PUT URL the admin browser uses to upload bytes directly. */
export async function signUploadUrl(env: Env, id: string, contentType: string): Promise<string> {
  return signUrl(env, 'PUT', id, contentType);
}

/** Delete an object from Storage (Worker calls the signed DELETE URL itself). */
export async function deleteMedia(env: Env, id: string): Promise<void> {
  const url = await signUrl(env, 'DELETE', id, 'DELETE', 120);
  const res = await fetch(url, { method: 'DELETE' });
  // 404 means already gone; treat as success.
  if (!res.ok && res.status !== 404) throw new Error(`Storage delete failed: ${res.status}`);
}
