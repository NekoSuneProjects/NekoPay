const crypto = require('crypto');

const secret = process.env.APP_SECRET || 'change-this-app-secret-in-production';

function randomId(prefix = '') {
  return `${prefix}${crypto.randomBytes(12).toString('hex')}`;
}

function randomDigits(length = 7) {
  const min = 10 ** (length - 1);
  const max = (10 ** length) - 1;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
}

function generateApiKey(prefix = 'sk_live') {
  return `${prefix}_${crypto.randomBytes(24).toString('hex')}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function deriveKey(salt) {
  return crypto.scryptSync(secret, salt, 32);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  const [algorithm, salt, expected] = String(stored || '').split(':');
  if (algorithm !== 'scrypt' || !salt || !expected) {
    return false;
  }

  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function encryptSecret(plainText) {
  if (!plainText) return null;
  const salt = crypto.randomBytes(16).toString('hex');
  const iv = crypto.randomBytes(12);
  const key = deriveKey(salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    algorithm: 'aes-256-gcm',
    sha256: sha256(plainText),
    salt,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    value: encrypted.toString('hex')
  };
}

function decryptSecret(payload) {
  if (!payload || !payload.value) return '';
  const key = deriveKey(payload.salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.value, 'hex')),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}

module.exports = {
  randomId,
  randomDigits,
  generateApiKey,
  sha256,
  hashPassword,
  verifyPassword,
  encryptSecret,
  decryptSecret
};
