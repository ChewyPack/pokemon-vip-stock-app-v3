import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1'
});
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });
const b64url = value => Buffer.from(value, 'base64url').toString('base64url');
const publicBytes = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(pub.x, 'base64url'),
  Buffer.from(pub.y, 'base64url')
]);

console.log('VAPID_PUBLIC_KEY=' + b64url(publicBytes));
console.log('VAPID_PRIVATE_KEY=' + b64url(Buffer.from(priv.d, 'base64url')));
console.log('VAPID_SUBJECT=mailto:admin@pokeprizepool.com');
console.log('\nKeep VAPID_PRIVATE_KEY secret. Do not commit the generated values.');
