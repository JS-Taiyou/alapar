import { query } from "./db";
import { env } from "./env";
import {
  base64url,
  base64urlToBytes,
  concatUint8Arrays,
  encodeLength,
} from "./encoding";

interface PushSubscription {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  registry_id: string | null;
}

interface PushPayload {
  title: string;
  body: string;
  registryId?: string;
  url?: string;
}

const lastPushAt = new Map<string, number>();
export const PUSH_COOLDOWN = 15_000;

/**
 * Cooldown gate for push notifications: returns `true` when a push is allowed
 * (enough time has elapsed since the last push for this key), `false` when the
 * cooldown is still active. Extracted from `sendPushToRegistry` so the
 * threshold logic is unit-testable without the map.
 *
 * @param now      current epoch millis
 * @param lastPush epoch millis of the last push for this key, or 0 = never
 * @param cooldown cooldown window in millis
 */
export function shouldSendPush(
  now: number,
  lastPush: number,
  cooldown: number = PUSH_COOLDOWN,
): boolean {
  // 0 is the map's "never pushed" marker, not epoch 0 — a key with no
  // history is always eligible, regardless of `now`.
  if (lastPush === 0) return true;
  return now - lastPush >= cooldown;
}

export async function sendPushToRegistry(
  registryId: string,
  payload: PushPayload,
  excludeUserId?: string,
): Promise<void> {
  console.log("[push] sendPushToRegistry called:", {
    registryId,
    excludeUserId,
    payload: { title: payload.title, body: payload.body },
  });

  const key = `${registryId}:${excludeUserId ?? ""}`;
  const now = Date.now();
  const last = lastPushAt.get(key) ?? 0;
  if (!shouldSendPush(now, last)) {
    console.log(
      "[push] Cooldown active, skipping. Last push was",
      now - last,
      "ms ago",
    );
    return;
  }
  lastPushAt.set(key, now);

  const vapidPrivateKey = env("VAPID_PRIVATE_KEY");
  const vapidSubject = env("VAPID_SUBJECT");
  const vapidPublicKey = env("VAPID_PUBLIC_KEY");

  if (!vapidPrivateKey || !vapidSubject || !vapidPublicKey) {
    console.warn("[push] Missing VAPID keys:", {
      hasPrivate: !!vapidPrivateKey,
      hasSubject: !!vapidSubject,
      hasPublic: !!vapidPublicKey,
    });
    return;
  }

  const result = await query(
    `SELECT ps.* FROM push_subscriptions ps
     JOIN registry_members rm ON rm.user_id = ps.user_id AND rm.registry_id = $1
     WHERE rm.registry_id = $1 AND ($2::uuid IS NULL OR ps.user_id != $2::uuid)`,
    [registryId, excludeUserId ?? null],
  );

  // query() is pinned to Record<string, unknown>[] rows; the SELECT is ps.*,
  // so every row IS a PushSubscription — assert through unknown.
  const subscriptions = result.rows as unknown as PushSubscription[];
  console.log("[push] Found", subscriptions.length, "subscriptions to notify");

  for (const sub of subscriptions) {
    console.log("[push] Sending to:", {
      userId: sub.user_id,
      endpoint: sub.endpoint.substring(0, 50) + "...",
    });
    try {
      const resp = await sendPushNotification(sub, payload, {
        publicKey: vapidPublicKey,
        privateKey: vapidPrivateKey,
        subject: vapidSubject,
      });
      console.log("[push] Response:", {
        status: resp.status,
        statusText: resp.statusText,
      });
    } catch (err) {
      console.error("[push] Failed to send, removing subscription:", err);
      await query("DELETE FROM push_subscriptions WHERE id = $1", [sub.id]);
    }
  }
}

async function sendPushNotification(
  subscription: PushSubscription,
  payload: PushPayload,
  vapidKeys: { publicKey: string; privateKey: string; subject: string },
): Promise<Response> {
  const body = JSON.stringify(payload);
  // RFC 8292: the VAPID `aud` claim must be the origin of the push service
  // for this subscription — not a hardcoded FCM origin (subscriptions may
  // come from Mozilla, Edge, etc.).
  const jwt = await createVapidJWT(
    vapidKeys,
    new URL(subscription.endpoint).origin,
  );
  const encrypted = await encryptPayload(
    body,
    subscription.p256dh,
    subscription.auth,
  );
  const encryptedBytes = new Uint8Array(encrypted);

  const headers: Record<string, string> = {
    "TTL": "86400",
    "Content-Type": "application/octet-stream",
    "Content-Encoding": "aes128gcm",
    "Authorization": `vapid t=${jwt}, k=${vapidKeys.publicKey}`,
    "Content-Length": encryptedBytes.length.toString(),
  };

  return fetch(subscription.endpoint, {
    method: "POST",
    headers,
    body: encrypted,
  });
}

async function createVapidJWT(
  keys: { publicKey: string; privateKey: string; subject: string },
  audience: string,
): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: audience,
    exp: now + 43200,
    sub: keys.subject,
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const data = `${headerB64}.${payloadB64}`;

  const keyData = base64urlToBytes(keys.privateKey);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData.buffer as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(data),
  );

  const sigB64 = base64url(new Uint8Array(signature));
  return `${data}.${sigB64}`;
}

async function encryptPayload(
  payload: string,
  p256dh: string,
  auth: string,
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(payload);

  const padded = new Uint8Array(2 + payloadBytes.length + 1);
  padded[0] = 0x02;
  padded.set(payloadBytes, 2);

  const authBytes = base64urlToBytes(auth);
  const dhBytes = base64urlToBytes(p256dh);

  const dhKey = await crypto.subtle.importKey(
    "raw",
    dhBytes.buffer as ArrayBuffer,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  const ecdhKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );

  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: dhKey },
    ecdhKeyPair.privateKey,
    256,
  );

  const ikm = new Uint8Array(sharedBits);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const publicKeyRaw = await crypto.subtle.exportKey(
    "raw",
    ecdhKeyPair.publicKey,
  );

  const prk = await hkdf(ikm, authBytes, "Content-Encoding: auth\0", 32);
  const context = concatUint8Arrays(
    new TextEncoder().encode("P-256\0"),
    encodeLength(new Uint8Array(dhBytes)),
    encodeLength(new Uint8Array(publicKeyRaw)),
  );
  const cekInfo = concatUint8Arrays(
    new TextEncoder().encode("Content-Encoding: aes128gcm\0"),
    context,
  );
  const nonceInfo = concatUint8Arrays(
    new TextEncoder().encode("Content-Encoding: nonce\0"),
    context,
  );

  const cek = await hkdf(prk, salt, cekInfo, 16);
  const nonce = await hkdf(prk, salt, nonceInfo, 12);

  const aesKey = await crypto.subtle.importKey(
    "raw",
    cek.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce.buffer as ArrayBuffer },
    aesKey,
    padded.buffer as ArrayBuffer,
  );

  const pubKeyBytes = new Uint8Array(publicKeyRaw);
  const encBytes = new Uint8Array(encrypted);
  const result = new Uint8Array(
    salt.length + 4 + 1 + 1 + pubKeyBytes.length + encBytes.length,
  );
  let offset = 0;
  result.set(salt, offset);
  offset += salt.length;
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  result.set(rs, offset);
  offset += 4;
  result[offset++] = 0;
  result[offset++] = pubKeyBytes.length;
  result.set(pubKeyBytes, offset);
  offset += pubKeyBytes.length;
  result.set(encBytes, offset);

  return result.buffer;
}

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array | string,
  length: number,
): Promise<Uint8Array> {
  const infoBytes = typeof info === "string"
    ? new TextEncoder().encode(info)
    : info;
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    ikm.buffer as ArrayBuffer,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt.buffer as ArrayBuffer,
      info: infoBytes.buffer as ArrayBuffer,
    },
    keyMaterial,
    length * 8,
  );
  return new Uint8Array(bits);
}
