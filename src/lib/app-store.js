const fs = require('fs/promises');
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');

const legacyFilePath = path.join(process.cwd(), 'data', 'store.json');
const defaultSqlitePath = path.join(process.cwd(), 'data', 'nekopay.sqlite');

const initialState = {
  users: [],
  sessions: [],
  stores: [],
  checkoutSessions: [],
  orders: [],
  paymentAttempts: [],
  verificationTokens: [],
  passwordResetTokens: [],
  issues: [],
  events: []
};

const collectionTableMap = {
  users: 'users',
  sessions: 'user_sessions',
  stores: 'stores',
  checkoutSessions: 'checkout_sessions',
  orders: 'transactions',
  paymentAttempts: 'payments',
  verificationTokens: 'verification_tokens',
  passwordResetTokens: 'password_reset_tokens',
  issues: 'issues',
  events: 'logs'
};

let sequelize = null;
let models = null;
let initPromise = null;

function getDatabaseConfig() {
  const dialect = String(process.env.DB_DIALECT || 'sqlite').toLowerCase();
  if (dialect === 'sqlite') {
    return {
      dialect,
      storage: process.env.DB_STORAGE || defaultSqlitePath
    };
  }

  if (!['mysql', 'mariadb'].includes(dialect)) {
    throw new Error(`Unsupported DB_DIALECT "${dialect}". Use sqlite, mysql, or mariadb.`);
  }

  return {
    dialect,
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || 'nekopay',
    username: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
  };
}

function createSequelize(config) {
  if (config.dialect === 'sqlite') {
    return new Sequelize({
      dialect: 'sqlite',
      storage: config.storage,
      logging: false
    });
  }

  return new Sequelize(config.database, config.username, config.password, {
    dialect: config.dialect,
    host: config.host,
    port: config.port,
    logging: false
  });
}

function jsonColumnType(dialect) {
  return dialect === 'sqlite' ? DataTypes.TEXT : DataTypes.TEXT('long');
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stringifyJson(value) {
  return JSON.stringify(value == null ? null : value);
}

function defineModels(instance, dialect) {
  const jsonType = jsonColumnType(dialect);
  const jsonField = {
    type: jsonType,
    allowNull: false,
    defaultValue: '[]'
  };

  const modelsByCollection = {};

  modelsByCollection.users = instance.define('User', {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    name: { type: DataTypes.STRING(191), allowNull: false },
    email: { type: DataTypes.STRING(191), allowNull: false, unique: true },
    role: { type: DataTypes.STRING(32), allowNull: false },
    status: { type: DataTypes.STRING(32), allowNull: false },
    verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    passwordHash: { type: DataTypes.STRING(191), allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  }, {
    tableName: collectionTableMap.users,
    timestamps: false
  });

  modelsByCollection.sessions = instance.define('UserSession', {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    userId: { type: DataTypes.STRING(64), allowNull: false },
    tokenHash: { type: DataTypes.STRING(191), allowNull: false, unique: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false }
  }, {
    tableName: collectionTableMap.sessions,
    timestamps: false,
    indexes: [{ fields: ['userId'] }]
  });

  modelsByCollection.stores = instance.define('Store', {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    ownerUserId: { type: DataTypes.STRING(64), allowNull: false },
    name: { type: DataTypes.STRING(191), allowNull: false },
    slug: { type: DataTypes.STRING(191), allowNull: false, unique: true },
    hookId: { type: DataTypes.STRING(32), allowNull: false, unique: true },
    status: { type: DataTypes.STRING(32), allowNull: false },
    defaultCurrency: { type: DataTypes.STRING(16), allowNull: false },
    supportedDisplayCurrencies: { type: jsonType, allowNull: false, defaultValue: '[]' },
    theme: { type: jsonType, allowNull: false, defaultValue: '{}' },
    taxRate: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    products: { type: jsonType, allowNull: false, defaultValue: '[]' },
    apiKeys: { type: jsonType, allowNull: false, defaultValue: '{}' },
    gatewaySecrets: { type: jsonType, allowNull: false, defaultValue: '{}' },
    wallets: { type: jsonType, allowNull: false, defaultValue: '{}' },
    gatewayState: { type: jsonType, allowNull: false, defaultValue: '{}' },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  }, {
    tableName: collectionTableMap.stores,
    timestamps: false,
    indexes: [{ fields: ['ownerUserId'] }]
  });

  modelsByCollection.checkoutSessions = instance.define('CheckoutSession', {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    storeId: { type: DataTypes.STRING(64), allowNull: false },
    ownerUserId: { type: DataTypes.STRING(64), allowNull: false },
    hookId: { type: DataTypes.STRING(32), allowNull: false },
    status: { type: DataTypes.STRING(32), allowNull: false },
    externalId: { type: DataTypes.STRING(191), allowNull: true },
    itemName: { type: DataTypes.STRING(191), allowNull: false },
    itemDescription: { type: jsonType, allowNull: false, defaultValue: '""' },
    amount: { type: DataTypes.FLOAT, allowNull: false },
    currency: { type: DataTypes.STRING(16), allowNull: false },
    displayCurrency: { type: DataTypes.STRING(16), allowNull: false },
    notificationUrl: { type: jsonType, allowNull: false, defaultValue: '""' },
    successUrl: { type: jsonType, allowNull: false, defaultValue: '""' },
    cancelUrl: { type: jsonType, allowNull: false, defaultValue: '""' },
    customer: { type: jsonType, allowNull: false, defaultValue: '{}' },
    metadata: { type: jsonType, allowNull: false, defaultValue: '{}' },
    allowedMethods: { type: jsonType, allowNull: false, defaultValue: '[]' },
    payment: { type: jsonType, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  }, {
    tableName: collectionTableMap.checkoutSessions,
    timestamps: false,
    indexes: [{ fields: ['storeId'] }]
  });

  modelsByCollection.orders = instance.define('Transaction', {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    storeId: { type: DataTypes.STRING(64), allowNull: false },
    ownerUserId: { type: DataTypes.STRING(64), allowNull: false },
    status: { type: DataTypes.STRING(32), allowNull: false },
    displayCurrency: { type: DataTypes.STRING(16), allowNull: false },
    customer: { type: jsonType, allowNull: false, defaultValue: '{}' },
    items: { type: jsonType, allowNull: false, defaultValue: '[]' },
    totals: { type: jsonType, allowNull: false, defaultValue: '{}' },
    payment: { type: jsonType, allowNull: true },
    paidAt: { type: DataTypes.DATE, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  }, {
    tableName: collectionTableMap.orders,
    timestamps: false,
    indexes: [{ fields: ['storeId'] }]
  });

  modelsByCollection.paymentAttempts = instance.define('Payment', {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    orderId: { type: DataTypes.STRING(64), allowNull: true },
    checkoutSessionId: { type: DataTypes.STRING(64), allowNull: true },
    storeId: { type: DataTypes.STRING(64), allowNull: false },
    methodId: { type: DataTypes.STRING(32), allowNull: false },
    providerReference: { type: jsonType, allowNull: true },
    status: { type: DataTypes.STRING(32), allowNull: false },
    redirectUrl: { type: jsonType, allowNull: true },
    instructions: { type: jsonType, allowNull: true },
    providerPayload: { type: jsonType, allowNull: true },
    confirmationTarget: { type: DataTypes.INTEGER, allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: true },
    transaction: { type: jsonType, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  }, {
    tableName: collectionTableMap.paymentAttempts,
    timestamps: false,
    indexes: [{ fields: ['storeId'] }, { fields: ['orderId'] }, { fields: ['checkoutSessionId'] }]
  });

  modelsByCollection.verificationTokens = instance.define('VerificationToken', {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    userId: { type: DataTypes.STRING(64), allowNull: false },
    tokenHash: { type: DataTypes.STRING(191), allowNull: false, unique: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false }
  }, {
    tableName: collectionTableMap.verificationTokens,
    timestamps: false,
    indexes: [{ fields: ['userId'] }]
  });

  modelsByCollection.passwordResetTokens = instance.define('PasswordResetToken', {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    userId: { type: DataTypes.STRING(64), allowNull: false },
    tokenHash: { type: DataTypes.STRING(191), allowNull: false, unique: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false }
  }, {
    tableName: collectionTableMap.passwordResetTokens,
    timestamps: false,
    indexes: [{ fields: ['userId'] }]
  });

  modelsByCollection.issues = instance.define('Issue', {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    storeId: { type: DataTypes.STRING(64), allowNull: false },
    userId: { type: DataTypes.STRING(64), allowNull: false },
    title: { type: DataTypes.STRING(191), allowNull: false },
    message: { type: jsonType, allowNull: false, defaultValue: '""' },
    status: { type: DataTypes.STRING(32), allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false }
  }, {
    tableName: collectionTableMap.issues,
    timestamps: false,
    indexes: [{ fields: ['storeId'] }]
  });

  modelsByCollection.events = instance.define('Log', {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    type: { type: DataTypes.STRING(191), allowNull: false },
    checkoutSessionId: { type: DataTypes.STRING(64), allowNull: true },
    targetUrl: { type: jsonType, allowNull: true },
    statusCode: { type: DataTypes.INTEGER, allowNull: true },
    error: { type: jsonType, allowNull: true },
    payload: { type: jsonType, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false }
  }, {
    tableName: collectionTableMap.events,
    timestamps: false,
    indexes: [{ fields: ['checkoutSessionId'] }]
  });

  return modelsByCollection;
}

function serializeRecord(collection, value) {
  switch (collection) {
    case 'users':
      return {
        id: value.id,
        name: value.name,
        email: value.email,
        role: value.role,
        status: value.status,
        verified: Boolean(value.verified),
        passwordHash: value.passwordHash,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt
      };
    case 'sessions':
    case 'verificationTokens':
    case 'passwordResetTokens':
      return {
        id: value.id,
        userId: value.userId,
        tokenHash: value.tokenHash,
        createdAt: value.createdAt,
        expiresAt: value.expiresAt
      };
    case 'stores':
      return {
        id: value.id,
        ownerUserId: value.ownerUserId,
        name: value.name,
        slug: value.slug,
        hookId: value.hookId,
        status: value.status,
        defaultCurrency: value.defaultCurrency,
        supportedDisplayCurrencies: stringifyJson(value.supportedDisplayCurrencies || []),
        theme: stringifyJson(value.theme || {}),
        taxRate: Number(value.taxRate || 0),
        products: stringifyJson(value.products || []),
        apiKeys: stringifyJson(value.apiKeys || {}),
        gatewaySecrets: stringifyJson(value.gatewaySecrets || {}),
        wallets: stringifyJson(value.wallets || {}),
        gatewayState: stringifyJson(value.gatewayState || {}),
        createdAt: value.createdAt,
        updatedAt: value.updatedAt
      };
    case 'checkoutSessions':
      return {
        id: value.id,
        storeId: value.storeId,
        ownerUserId: value.ownerUserId,
        hookId: value.hookId,
        status: value.status,
        externalId: value.externalId || null,
        itemName: value.itemName,
        itemDescription: stringifyJson(value.itemDescription || ''),
        amount: Number(value.amount || 0),
        currency: value.currency,
        displayCurrency: value.displayCurrency,
        notificationUrl: stringifyJson(value.notificationUrl || ''),
        successUrl: stringifyJson(value.successUrl || ''),
        cancelUrl: stringifyJson(value.cancelUrl || ''),
        customer: stringifyJson(value.customer || {}),
        metadata: stringifyJson(value.metadata || {}),
        allowedMethods: stringifyJson(value.allowedMethods || []),
        payment: value.payment == null ? null : stringifyJson(value.payment),
        createdAt: value.createdAt,
        updatedAt: value.updatedAt
      };
    case 'orders':
      return {
        id: value.id,
        storeId: value.storeId,
        ownerUserId: value.ownerUserId,
        status: value.status,
        displayCurrency: value.displayCurrency,
        customer: stringifyJson(value.customer || {}),
        items: stringifyJson(value.items || []),
        totals: stringifyJson(value.totals || {}),
        payment: value.payment == null ? null : stringifyJson(value.payment),
        paidAt: value.paidAt || null,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt
      };
    case 'paymentAttempts':
      return {
        id: value.id,
        orderId: value.orderId || null,
        checkoutSessionId: value.checkoutSessionId || null,
        storeId: value.storeId,
        methodId: value.methodId,
        providerReference: value.providerReference == null ? null : stringifyJson(value.providerReference),
        status: value.status,
        redirectUrl: value.redirectUrl == null ? null : stringifyJson(value.redirectUrl),
        instructions: value.instructions == null ? null : stringifyJson(value.instructions),
        providerPayload: value.providerPayload == null ? null : stringifyJson(value.providerPayload),
        confirmationTarget: value.confirmationTarget == null ? null : Number(value.confirmationTarget),
        expiresAt: value.expiresAt || null,
        transaction: value.transaction == null ? null : stringifyJson(value.transaction),
        createdAt: value.createdAt,
        updatedAt: value.updatedAt
      };
    case 'issues':
      return {
        id: value.id,
        storeId: value.storeId,
        userId: value.userId,
        title: value.title,
        message: stringifyJson(value.message || ''),
        status: value.status,
        createdAt: value.createdAt
      };
    case 'events':
      return {
        id: value.id,
        type: value.type,
        checkoutSessionId: value.checkoutSessionId || null,
        targetUrl: value.targetUrl == null ? null : stringifyJson(value.targetUrl),
        statusCode: value.statusCode == null ? null : Number(value.statusCode),
        error: value.error == null ? null : stringifyJson(value.error),
        payload: value.payload == null ? null : stringifyJson(value.payload),
        createdAt: value.createdAt
      };
    default:
      throw new Error(`Unknown collection "${collection}"`);
  }
}

function deserializeRecord(collection, row) {
  const plain = row.get({ plain: true });
  switch (collection) {
    case 'users':
      return plain;
    case 'sessions':
    case 'verificationTokens':
    case 'passwordResetTokens':
      return plain;
    case 'stores':
      return {
        ...plain,
        supportedDisplayCurrencies: parseJson(plain.supportedDisplayCurrencies, []),
        theme: parseJson(plain.theme, {}),
        products: parseJson(plain.products, []),
        apiKeys: parseJson(plain.apiKeys, {}),
        gatewaySecrets: parseJson(plain.gatewaySecrets, {}),
        wallets: parseJson(plain.wallets, {}),
        gatewayState: parseJson(plain.gatewayState, {})
      };
    case 'checkoutSessions':
      return {
        ...plain,
        itemDescription: parseJson(plain.itemDescription, ''),
        notificationUrl: parseJson(plain.notificationUrl, ''),
        successUrl: parseJson(plain.successUrl, ''),
        cancelUrl: parseJson(plain.cancelUrl, ''),
        customer: parseJson(plain.customer, {}),
        metadata: parseJson(plain.metadata, {}),
        allowedMethods: parseJson(plain.allowedMethods, []),
        payment: parseJson(plain.payment, null)
      };
    case 'orders':
      return {
        ...plain,
        customer: parseJson(plain.customer, {}),
        items: parseJson(plain.items, []),
        totals: parseJson(plain.totals, {}),
        payment: parseJson(plain.payment, null)
      };
    case 'paymentAttempts':
      return {
        ...plain,
        providerReference: parseJson(plain.providerReference, plain.providerReference),
        redirectUrl: parseJson(plain.redirectUrl, plain.redirectUrl),
        instructions: parseJson(plain.instructions, null),
        providerPayload: parseJson(plain.providerPayload, null),
        transaction: parseJson(plain.transaction, null)
      };
    case 'issues':
      return {
        ...plain,
        message: parseJson(plain.message, '')
      };
    case 'events':
      return {
        ...plain,
        targetUrl: parseJson(plain.targetUrl, plain.targetUrl),
        error: parseJson(plain.error, plain.error),
        payload: parseJson(plain.payload, null)
      };
    default:
      throw new Error(`Unknown collection "${collection}"`);
  }
}

async function tableExists(tableName) {
  const tables = await sequelize.getQueryInterface().showAllTables();
  return tables
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      return entry.tableName || entry.name || String(entry);
    })
    .includes(tableName);
}

async function importState(state) {
  for (const collection of Object.keys(initialState)) {
    const entries = Array.isArray(state[collection]) ? state[collection] : [];
    if (!entries.length) continue;
    const Model = models[collection];
    await Model.bulkCreate(entries.map((entry) => serializeRecord(collection, entry)));
  }
}

async function readLegacyAppRecords() {
  const LegacyRecord = sequelize.define('LegacyAppRecord', {
    id: { type: DataTypes.INTEGER, primaryKey: true },
    collection: { type: DataTypes.STRING(64), allowNull: false },
    recordId: { type: DataTypes.STRING(191), allowNull: false },
    data: { type: jsonColumnType(getDatabaseConfig().dialect), allowNull: false }
  }, {
    tableName: 'app_records',
    timestamps: true
  });

  const rows = await LegacyRecord.findAll({ order: [['id', 'ASC']] });
  const nextState = { ...initialState };
  for (const row of rows) {
    const plain = row.get({ plain: true });
    if (!nextState[plain.collection]) continue;
    nextState[plain.collection].push(parseJson(plain.data, null));
  }
  return nextState;
}

async function readLegacyJson() {
  try {
    await fs.access(legacyFilePath);
  } catch {
    return null;
  }

  const raw = await fs.readFile(legacyFilePath, 'utf8');
  const parsed = JSON.parse(raw || '{}');
  return {
    ...initialState,
    ...parsed
  };
}

async function importLegacyDataIfNeeded() {
  const hasExistingData = await Promise.all(
    Object.keys(models).map((collection) => models[collection].count())
  );

  if (hasExistingData.some((count) => count > 0)) {
    return;
  }

  if (await tableExists('app_records')) {
    const legacyState = await readLegacyAppRecords();
    await importState(legacyState);
    return;
  }

  const legacyJson = await readLegacyJson();
  if (legacyJson) {
    await importState(legacyJson);
  }
}

async function ensureStorageReady() {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const config = getDatabaseConfig();
    if (config.dialect === 'sqlite') {
      await fs.mkdir(path.dirname(config.storage), { recursive: true });
    }

    sequelize = createSequelize(config);
    models = defineModels(sequelize, config.dialect);
    await sequelize.sync();
    await importLegacyDataIfNeeded();
  })();

  return initPromise;
}

async function list(collection) {
  await ensureStorageReady();
  const Model = models[collection];
  if (!Model) throw new Error(`Unknown collection "${collection}"`);
  const rows = await Model.findAll({ order: [['createdAt', 'ASC'], ['id', 'ASC']] });
  return rows.map((row) => deserializeRecord(collection, row));
}

async function readState() {
  const state = { ...initialState };
  for (const collection of Object.keys(initialState)) {
    state[collection] = await list(collection);
  }
  return state;
}

async function append(collection, value) {
  await ensureStorageReady();
  const Model = models[collection];
  if (!Model) throw new Error(`Unknown collection "${collection}"`);
  const serialized = serializeRecord(collection, value);
  await Model.create(serialized);
  return deserializeRecord(collection, { get: () => serialized });
}

async function getBy(collection, predicate) {
  const items = await list(collection);
  return items.find(predicate) || null;
}

async function updateBy(collection, predicate, updater) {
  await ensureStorageReady();
  const Model = models[collection];
  if (!Model) throw new Error(`Unknown collection "${collection}"`);
  const rows = await Model.findAll({ order: [['createdAt', 'ASC'], ['id', 'ASC']] });
  let result = null;

  for (const row of rows) {
    const current = deserializeRecord(collection, row);
    if (!predicate(current)) continue;
    const nextValue = updater(current);
    const serialized = serializeRecord(collection, nextValue);
    await row.update(serialized);
    result = deserializeRecord(collection, { get: () => serialized });
  }

  return result;
}

async function removeBy(collection, predicate) {
  await ensureStorageReady();
  const Model = models[collection];
  if (!Model) throw new Error(`Unknown collection "${collection}"`);
  const rows = await Model.findAll({ order: [['createdAt', 'ASC'], ['id', 'ASC']] });
  for (const row of rows) {
    const current = deserializeRecord(collection, row);
    if (predicate(current)) {
      await row.destroy();
    }
  }
}

async function closeStorage() {
  if (sequelize) {
    await sequelize.close();
    sequelize = null;
    models = null;
    initPromise = null;
  }
}

module.exports = {
  initialState,
  readState,
  append,
  list,
  getBy,
  updateBy,
  removeBy,
  closeStorage
};
