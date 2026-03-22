const { append, getBy, updateBy, removeBy, list } = require('../lib/app-store');
const { hashPassword, verifyPassword, randomId, sha256 } = require('../lib/security');
const { sendVerificationEmail } = require('./mailer');

const SESSION_COOKIE = 'nekopay_session';

async function findUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return getBy('users', (user) => user.email === normalized);
}

async function createUser({ name, email, password, role = 'merchant' }) {
  const existing = await findUserByEmail(email);
  if (existing) {
    throw new Error('Email address is already registered');
  }

  const user = {
    id: randomId('usr_'),
    name: String(name || '').trim(),
    email: String(email || '').trim().toLowerCase(),
    role,
    status: 'active',
    verified: false,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await append('users', user);
  await createVerificationToken(user);
  return user;
}

async function createVerificationToken(user) {
  await removeBy('verificationTokens', (token) => token.userId === user.id);
  const token = randomId('verify_');
  const record = {
    id: randomId('vfy_'),
    userId: user.id,
    tokenHash: sha256(token),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + (1000 * 60 * 60 * 24)).toISOString()
  };

  await append('verificationTokens', record);
  const emailResult = await sendVerificationEmail(user, token);
  return { token, emailResult };
}

async function verifyEmailToken(token) {
  const tokenHash = sha256(token);
  const record = await getBy('verificationTokens', (item) => item.tokenHash === tokenHash);
  if (!record) {
    throw new Error('Verification token is invalid');
  }

  if (new Date(record.expiresAt).getTime() < Date.now()) {
    throw new Error('Verification token has expired');
  }

  await updateBy('users', (user) => user.id === record.userId, (user) => ({
    ...user,
    verified: true,
    updatedAt: new Date().toISOString()
  }));

  await removeBy('verificationTokens', (item) => item.id === record.id);
}

async function loginUser(email, password) {
  const user = await findUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new Error('Invalid email or password');
  }

  if (!user.verified) {
    throw new Error('Please verify your email address before logging in');
  }

  if (user.status !== 'active') {
    throw new Error('Account is suspended');
  }

  const rawToken = randomId('sess_');
  const session = {
    id: randomId('ses_'),
    userId: user.id,
    tokenHash: sha256(rawToken),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + (1000 * 60 * 60 * 24 * 14)).toISOString()
  };

  await append('sessions', session);
  return { user, token: rawToken };
}

async function getUserFromToken(token) {
  if (!token) return null;
  const tokenHash = sha256(token);
  const session = await getBy('sessions', (item) => item.tokenHash === tokenHash);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await removeBy('sessions', (item) => item.id === session.id);
    return null;
  }

  return getBy('users', (user) => user.id === session.userId);
}

async function logoutToken(token) {
  const tokenHash = sha256(token);
  await removeBy('sessions', (item) => item.tokenHash === tokenHash);
}

async function seedAdminIfNeeded() {
  const users = await list('users');
  if (users.some((user) => user.role === 'admin')) {
    return;
  }

  const adminEmail = String(process.env.ADMIN_EMAIL || 'admin@nekopay.local').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const admin = {
    id: randomId('usr_'),
    name: 'Platform Admin',
    email: adminEmail,
    role: 'admin',
    status: 'active',
    verified: true,
    passwordHash: hashPassword(adminPassword),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await append('users', admin);
}

module.exports = {
  SESSION_COOKIE,
  createUser,
  findUserByEmail,
  createVerificationToken,
  verifyEmailToken,
  loginUser,
  getUserFromToken,
  logoutToken,
  seedAdminIfNeeded
};
