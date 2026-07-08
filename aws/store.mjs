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
const TRIPS_TABLE = process.env.TRIPS_TABLE || 'norway-app-trips';
const VARIANTS_TABLE = process.env.VARIANTS_TABLE || 'norway-app-variants';
const USERS_FILE = process.env.USERS_FILE || join(__dirname, '..', 'data', 'users.json');
const TRIPS_FILE = process.env.TRIPS_FILE || join(__dirname, '..', 'data', 'trips.json');

// Thrown by variant writes whose version doesn't match the stored one —
// the API layer turns this into a 409 (optimistic locking).
export class VersionConflictError extends Error {
  constructor(currentVersion) {
    super('version conflict');
    this.currentVersion = currentVersion;
  }
}

export function newStoreId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

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

function tripsRead() {
  try {
    return JSON.parse(readFileSync(TRIPS_FILE, 'utf8'));
  } catch {
    return { trips: {}, variants: {} };
  }
}
function tripsWrite(db) {
  mkdirSync(dirname(TRIPS_FILE), { recursive: true });
  writeFileSync(TRIPS_FILE, JSON.stringify(db, null, 2));
}

const fileTripsDriver = {
  async createTrip(trip) {
    const db = tripsRead();
    db.trips[trip.trip_id] = trip;
    tripsWrite(db);
    return trip;
  },
  async getTrip(tripId) {
    return tripsRead().trips[tripId] || null;
  },
  async listTripsForOwner(sub) {
    return Object.values(tripsRead().trips).filter((t) => t.owner_sub === sub);
  },
  async deleteTrip(tripId) {
    const db = tripsRead();
    delete db.trips[tripId];
    for (const key of Object.keys(db.variants)) {
      if (key.startsWith(tripId + ':')) delete db.variants[key];
    }
    tripsWrite(db);
  },
  async listVariants(tripId) {
    const db = tripsRead();
    return Object.entries(db.variants)
      .filter(([k]) => k.startsWith(tripId + ':'))
      .map(([, v]) => v);
  },
  async getVariant(tripId, variantId) {
    return tripsRead().variants[`${tripId}:${variantId}`] || null;
  },
  // expectedVersion null = create (must not exist); otherwise must match.
  async putVariant(tripId, variant, expectedVersion) {
    const db = tripsRead();
    const key = `${tripId}:${variant.variant_id}`;
    const existing = db.variants[key];
    if (expectedVersion === null && existing) throw new VersionConflictError(existing.version);
    if (expectedVersion !== null && (!existing || existing.version !== expectedVersion)) {
      throw new VersionConflictError(existing ? existing.version : 0);
    }
    const record = { ...variant, trip_id: tripId, version: (existing?.version || 0) + 1 };
    db.variants[key] = record;
    tripsWrite(db);
    return record;
  },
  async deleteVariant(tripId, variantId) {
    const db = tripsRead();
    delete db.variants[`${tripId}:${variantId}`];
    tripsWrite(db);
  },
};

// ---- dynamo driver ----
// The AWS SDK v3 is bundled in the Lambda Node runtimes; imported lazily so
// local runs never need it installed.

let dynamoClient = null;
async function dynamo() {
  if (!dynamoClient) {
    const { DynamoDBClient, PutItemCommand, GetItemCommand, ScanCommand,
            QueryCommand, DeleteItemCommand, ConditionalCheckFailedException } =
      await import('@aws-sdk/client-dynamodb');
    const client = new DynamoDBClient({});
    dynamoClient = { client, PutItemCommand, GetItemCommand, ScanCommand,
                     QueryCommand, DeleteItemCommand, ConditionalCheckFailedException };
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

const dynamoTripsDriver = {
  async createTrip(trip) {
    const d = await dynamo();
    await d.client.send(new d.PutItemCommand({
      TableName: TRIPS_TABLE,
      Item: {
        trip_id: { S: trip.trip_id },
        owner_sub: { S: trip.owner_sub },
        name: { S: trip.name },
        filename: { S: trip.filename },
        kml_source: { S: trip.kml_source },
        created_at: { S: trip.created_at },
      },
    }));
    return trip;
  },
  async getTrip(tripId) {
    const d = await dynamo();
    const res = await d.client.send(new d.GetItemCommand({
      TableName: TRIPS_TABLE, Key: { trip_id: { S: tripId } },
    }));
    if (!res.Item) return null;
    const i = res.Item;
    return {
      trip_id: i.trip_id.S, owner_sub: i.owner_sub.S, name: i.name.S,
      filename: i.filename.S, kml_source: i.kml_source.S, created_at: i.created_at?.S,
    };
  },
  async listTripsForOwner(sub) {
    const d = await dynamo();
    // Scan with filter is fine at personal scale; add a GSI if it ever isn't.
    const res = await d.client.send(new d.ScanCommand({
      TableName: TRIPS_TABLE,
      FilterExpression: 'owner_sub = :s',
      ExpressionAttributeValues: { ':s': { S: sub } },
      ProjectionExpression: 'trip_id, owner_sub, #n, filename, created_at',
      ExpressionAttributeNames: { '#n': 'name' },
    }));
    return (res.Items || []).map((i) => ({
      trip_id: i.trip_id.S, owner_sub: i.owner_sub.S, name: i.name.S,
      filename: i.filename.S, created_at: i.created_at?.S,
    }));
  },
  async deleteTrip(tripId) {
    const d = await dynamo();
    const variants = await this.listVariants(tripId);
    for (const v of variants) {
      await d.client.send(new d.DeleteItemCommand({
        TableName: VARIANTS_TABLE,
        Key: { trip_id: { S: tripId }, variant_id: { S: v.variant_id } },
      }));
    }
    await d.client.send(new d.DeleteItemCommand({
      TableName: TRIPS_TABLE, Key: { trip_id: { S: tripId } },
    }));
  },
  async listVariants(tripId) {
    const d = await dynamo();
    const res = await d.client.send(new d.QueryCommand({
      TableName: VARIANTS_TABLE,
      KeyConditionExpression: 'trip_id = :t',
      ExpressionAttributeValues: { ':t': { S: tripId } },
    }));
    return (res.Items || []).map(variantFromItem);
  },
  async getVariant(tripId, variantId) {
    const d = await dynamo();
    const res = await d.client.send(new d.GetItemCommand({
      TableName: VARIANTS_TABLE,
      Key: { trip_id: { S: tripId }, variant_id: { S: variantId } },
    }));
    return res.Item ? variantFromItem(res.Item) : null;
  },
  async putVariant(tripId, variant, expectedVersion) {
    const d = await dynamo();
    const newVersion = (expectedVersion || 0) + 1;
    const params = {
      TableName: VARIANTS_TABLE,
      Item: {
        trip_id: { S: tripId },
        variant_id: { S: variant.variant_id },
        name: { S: variant.name },
        state: { S: JSON.stringify({ plans: variant.plans, dayMeta: variant.dayMeta }) },
        version: { N: String(newVersion) },
      },
    };
    if (expectedVersion === null) {
      params.ConditionExpression = 'attribute_not_exists(trip_id)';
    } else {
      params.ConditionExpression = 'version = :v';
      params.ExpressionAttributeValues = { ':v': { N: String(expectedVersion) } };
    }
    try {
      await d.client.send(new d.PutItemCommand(params));
    } catch (e) {
      if (e instanceof d.ConditionalCheckFailedException) {
        const current = await this.getVariant(tripId, variant.variant_id);
        throw new VersionConflictError(current ? current.version : 0);
      }
      throw e;
    }
    return { ...variant, trip_id: tripId, version: newVersion };
  },
  async deleteVariant(tripId, variantId) {
    const d = await dynamo();
    await d.client.send(new d.DeleteItemCommand({
      TableName: VARIANTS_TABLE,
      Key: { trip_id: { S: tripId }, variant_id: { S: variantId } },
    }));
  },
};

function variantFromItem(i) {
  const state = JSON.parse(i.state?.S || '{}');
  return {
    trip_id: i.trip_id.S,
    variant_id: i.variant_id.S,
    name: i.name?.S || '',
    plans: state.plans || {},
    dayMeta: state.dayMeta || {},
    version: Number(i.version?.N || 1),
  };
}

const driver = DRIVER === 'dynamo' ? dynamoDriver : fileDriver;
const tripsDriver = DRIVER === 'dynamo' ? dynamoTripsDriver : fileTripsDriver;

export const upsertUser = driver.upsertUser.bind(driver);
export const getUser = driver.getUser.bind(driver);
export const listUsers = driver.listUsers.bind(driver);

export const createTrip = tripsDriver.createTrip.bind(tripsDriver);
export const getTrip = tripsDriver.getTrip.bind(tripsDriver);
export const listTripsForOwner = tripsDriver.listTripsForOwner.bind(tripsDriver);
export const deleteTrip = tripsDriver.deleteTrip.bind(tripsDriver);
export const listVariants = tripsDriver.listVariants.bind(tripsDriver);
export const getVariant = tripsDriver.getVariant.bind(tripsDriver);
export const putVariant = tripsDriver.putVariant.bind(tripsDriver);
export const deleteVariant = tripsDriver.deleteVariant.bind(tripsDriver);
