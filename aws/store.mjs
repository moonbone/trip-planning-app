// User storage behind a driver interface: DynamoDB when running on Lambda
// (or STORE_DRIVER=dynamo), a JSON file under data/ for local dev-server
// use (data/* is gitignored). Trips/variants/shares join this in phase 3
// of the auth-and-sharing effort — see docs/auth-design.md.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DRIVER = process.env.STORE_DRIVER
  || (process.env.AWS_LAMBDA_FUNCTION_NAME ? 'dynamo' : 'file');
const USERS_TABLE = process.env.USERS_TABLE || 'norway-app-users';
const USERS_FILE = process.env.USERS_FILE || join(__dirname, '..', 'data', 'users.json');

// ---- file driver ----

function fileRead() {
  try {
    return JSON.parse(readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return { users: {} };
  }
}
function fileWrite(db) {
  mkdirSync(dirname(USERS_FILE), { recursive: true });
  writeFileSync(USERS_FILE, JSON.stringify(db, null, 2));
}

const fileDriver = {
  async upsertUser(user) {
    const db = fileRead();
    const existing = db.users[user.sub] || {};
    db.users[user.sub] = {
      ...existing,
      ...user,
      created_at: existing.created_at || new Date().toISOString(),
      last_login_at: new Date().toISOString(),
      disabled: existing.disabled || false,
    };
    fileWrite(db);
    return db.users[user.sub];
  },
  async getUser(sub) {
    return fileRead().users[sub] || null;
  },
  async listUsers() {
    return Object.values(fileRead().users);
  },
};

// ---- dynamo driver ----
// The AWS SDK v3 is bundled in the Lambda Node runtimes; imported lazily so
// local runs never need it installed.

let dynamoClient = null;
async function dynamo() {
  if (!dynamoClient) {
    const { DynamoDBClient, PutItemCommand, GetItemCommand, ScanCommand } =
      await import('@aws-sdk/client-dynamodb');
    const client = new DynamoDBClient({});
    dynamoClient = { client, PutItemCommand, GetItemCommand, ScanCommand };
  }
  return dynamoClient;
}

function toItem(user) {
  return {
    sub: { S: user.sub },
    email: { S: user.email },
    name: { S: user.name || '' },
    created_at: { S: user.created_at },
    last_login_at: { S: user.last_login_at },
    disabled: { BOOL: !!user.disabled },
  };
}
function fromItem(item) {
  if (!item) return null;
  return {
    sub: item.sub.S,
    email: item.email.S,
    name: item.name?.S || '',
    created_at: item.created_at?.S,
    last_login_at: item.last_login_at?.S,
    disabled: item.disabled?.BOOL || false,
  };
}

const dynamoDriver = {
  async upsertUser(user) {
    const d = await dynamo();
    const existing = await this.getUser(user.sub);
    const record = {
      ...existing,
      ...user,
      created_at: existing?.created_at || new Date().toISOString(),
      last_login_at: new Date().toISOString(),
      disabled: existing?.disabled || false,
    };
    await d.client.send(new d.PutItemCommand({ TableName: USERS_TABLE, Item: toItem(record) }));
    return record;
  },
  async getUser(sub) {
    const d = await dynamo();
    const res = await d.client.send(new d.GetItemCommand({
      TableName: USERS_TABLE,
      Key: { sub: { S: sub } },
    }));
    return fromItem(res.Item);
  },
  async listUsers() {
    const d = await dynamo();
    const res = await d.client.send(new d.ScanCommand({ TableName: USERS_TABLE }));
    return (res.Items || []).map(fromItem);
  },
};

const driver = DRIVER === 'dynamo' ? dynamoDriver : fileDriver;

export const upsertUser = driver.upsertUser.bind(driver);
export const getUser = driver.getUser.bind(driver);
export const listUsers = driver.listUsers.bind(driver);
