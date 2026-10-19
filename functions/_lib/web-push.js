const encoder = new TextEncoder();

function fromB64url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function toB64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function concat(...parts) {
  const size = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
function uint32(value) {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}
async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}
async function hkdfExpand(prk, info, length) {
  let previous = new Uint8Array(0);
  const blocks = [];
  for (let counter = 1, size = 0; size < length; counter++) {
    previous = await hmac(prk, concat(previous, info, new Uint8Array([counter])));
    blocks.push(previous);
    size += previous.length;
  }
  return concat(...blocks).slice(0, length);
}
async function deriveKey(secret, salt, info, length) {
  const prk = await hmac(salt, secret);
  return hkdfExpand(prk, info, length);
}
function base64urlJson(value) {
  return toB64url(encoder.encode(JSON.stringify(value)));
}
function parsePublicKey(raw) {
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('Invalid VAPID public key');
  return { x: toB64url(raw.slice(1, 33)), y: toB64url(raw.slice(33, 65)) };
}
async function vapidAuthorization(endpoint, env) {
  const publicBytes = fromB64url(env.VAPID_PUBLIC_KEY);
  const privateBytes = fromB64url(env.VAPID_PRIVATE_KEY);
  if (publicBytes.length !== 65 || privateBytes.length !== 32) {
    throw new Error('VAPID keys are not configured correctly');
  }
  const publicXY = parsePublicKey(publicBytes);
  const privateJwk = {
    kty: 'EC', crv: 'P-256', x: publicXY.x, y: publicXY.y,
    d: toB64url(privateBytes), ext: true, key_ops: ['sign']
  };
  const signingKey = await crypto.subtle.importKey(
    'jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const audience = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ typ: 'JWT', alg: 'ES256' });
  const claims = base64urlJson({
    aud: audience,
    exp: now + 12 * 60 * 60,
    sub: env.VAPID_SUBJECT || 'mailto:admin@pokeprizepool.com'
  });
  const unsigned = header + '.' + claims;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, signingKey, encoder.encode(unsigned)
  );
  return 'vapid t=' + unsigned + '.' + toB64url(signature) + ', k=' + env.VAPID_PUBLIC_KEY;
}
async function encryptPayload(subscription, payload) {
  const clientPublic = fromB64url(subscription.p256dh);
  const authSecret = fromB64url(subscription.auth);
  if (clientPublic.length !== 65 || authSecret.length < 16) throw new Error('Invalid push subscription keys');

  const clientKey = await crypto.subtle.importKey('raw', clientPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const serverKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, serverKeys.privateKey, 256));
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const keyInfo = concat(encoder.encode('WebPush: info\0'), clientPublic, serverPublic);
  const ikm = await deriveKey(sharedSecret, authSecret, keyInfo, 32);
  const cek = await deriveKey(ikm, salt, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await deriveKey(ikm, salt, encoder.encode('Content-Encoding: nonce\0'), 12);

  // RFC 8291 record: plaintext followed by the final-record delimiter 0x02.
  const plaintext = concat(encoder.encode(JSON.stringify(payload)), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plaintext));
  return concat(salt, uint32(4096), new Uint8Array([serverPublic.length]), serverPublic, ciphertext);
}
export async function sendWebPush(subscription, payload, env) {
  const authorization = await vapidAuthorization(subscription.endpoint, env);
  const body = await encryptPayload(subscription, payload);
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      TTL: '60',
      Urgency: 'high',
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm'
    },
    body
  });
  return response;
}
