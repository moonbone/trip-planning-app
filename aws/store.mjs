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
const USERS_TABLE = process.env.USERS_TABLE || 'trip-planner-app-users';
const TRIPS_TABLE = process.env.TRIPS_TABLE || 'trip-planner-app-trips';
const VARIANTS_TABLE = process.env.VARIANTS_TABLE || 'trip-planner-app-variants';
const SHARES_TABLE = process.env.SHARES_TABLE || 'trip-planner-app-shares';
const TICKETS_TABLE = process.env.TICKETS_TABLE || 'trip-planner-app-tickets';
const USERS_FILE = process.env.USERS_FILE || join(__dirname, '..', 'data', 'users.json');
const TRIPS_FILE = process.env.TRIPS_FILE || join(__dirname, '..', 'data', 'trips.json');
const TICKETS_FILE = process.env.TICKETS_FILE || join(__dirname, '..', 'data', 'tickets.json');

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
      last_login_at: 'last_login_at' in user ? user.last_login_at : new Date().toISOString(),
      // an explicitly passed flag (admin action) wins; logins omit it
      disabled: 'disabled' in user ? !!user.disabled : (existing.disabled || false),
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
  let db;
  try {
    db = JSON.parse(readFileSync(TRIPS_FILE, 'utf8'));
  } catch {
    db = {};
  }
  db.trips ||= {};
  db.variants ||= {};
  db.shares ||= {};
  return db;
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
  async putTripEnrichment(tripId, enrichment) {
    const db = tripsRead();
    if (!db.trips[tripId]) return null;
    db.trips[tripId].enrichment = enrichment;
    tripsWrite(db);
    return db.trips[tripId];
  },
  async addTripComment(tripId, comment) {
    const db = tripsRead();
    if (!db.trips[tripId]) return null;
    db.trips[tripId].comments = [...(db.trips[tripId].comments || []), comment];
    tripsWrite(db);
    return comment;
  },
  async deleteTripComment(tripId, commentId) {
    const db = tripsRead();
    if (!db.trips[tripId]) return null;
    db.trips[tripId].comments = (db.trips[tripId].comments || []).filter((c) => c.id !== commentId);
    tripsWrite(db);
    return true;
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
    for (const key of Object.keys(db.shares)) {
      if (db.shares[key].trip_id === tripId) delete db.shares[key];
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
  async listSharesForTrip(tripId) {
    return Object.values(tripsRead().shares).filter((s) => s.trip_id === tripId);
  },
  async listSharesForEmail(email) {
    const e = email.toLowerCase();
    return Object.values(tripsRead().shares).filter((s) => s.email === e);
  },
  async putShare(share) {
    const db = tripsRead();
    db.shares[`${share.trip_id}:${share.email}`] = share;
    tripsWrite(db);
    return share;
  },
  async deleteShare(tripId, email) {
    const db = tripsRead();
    delete db.shares[`${tripId}:${email.toLowerCase()}`];
    tripsWrite(db);
  },
};

// ---- tickets (file driver) ----
// Replaced the old node:sqlite tickets-db.mjs so tickets work on Lambda
// (DynamoDB) as well as locally (JSON file), same split as everything else.

function ticketsRead() {
  try {
    return JSON.parse(readFileSync(TICKETS_FILE, 'utf8'));
  } catch {
    return { tickets: {} };
  }
}
function ticketsWrite(db) {
  mkdirSync(dirname(TICKETS_FILE), { recursive: true });
  writeFileSync(TICKETS_FILE, JSON.stringify(db, null, 2));
}

const fileTicketsDriver = {
  async createTicket({ subject, description, email }) {
    const db = ticketsRead();
    const ticket = {
      id: newStoreId(),
      subject, description, email,
      status: 'new',
      created_at: new Date().toISOString(),
    };
    db.tickets[ticket.id] = ticket;
    ticketsWrite(db);
    return ticket;
  },
  async listTickets() {
    return Object.values(ticketsRead().tickets)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  },
  async getTicket(id) {
    return ticketsRead().tickets[id] || null;
  },
  async updateTicketStatus(id, status) {
    const db = ticketsRead();
    if (!db.tickets[id]) return null;
    db.tickets[id].status = status;
    ticketsWrite(db);
    return db.tickets[id];
  },
};

// ---- dynamo driver ----
// The AWS SDK v3 is bundled in the Lambda Node runtimes; imported lazily so
// local runs never need it installed.

let dynamoClient = null;
async function dynamo() {
  if (!dynamoClient) {
    const { DynamoDBClient, PutItemCommand, GetItemCommand, ScanCommand,
            QueryCommand, DeleteItemCommand, UpdateItemCommand,
            ConditionalCheckFailedException } =
      await import('@aws-sdk/client-dynamodb');
    const client = new DynamoDBClient({});
    dynamoClient = { client, PutItemCommand, GetItemCommand, ScanCommand,
                     QueryCommand, DeleteItemCommand, UpdateItemCommand,
                     ConditionalCheckFailedException };
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
      last_login_at: 'last_login_at' in user ? user.last_login_at : new Date().toISOString(),
      disabled: 'disabled' in user ? !!user.disabled : (existing?.disabled || false),
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
    const trip = {
      trip_id: i.trip_id.S, owner_sub: i.owner_sub.S, name: i.name.S,
      filename: i.filename.S, kml_source: i.kml_source.S, created_at: i.created_at?.S,
    };
    if (i.enrichment?.S) {
      try { trip.enrichment = JSON.parse(i.enrichment.S); } catch { /* ignore corrupt blob */ }
    }
    if (i.comments?.S) {
      try { trip.comments = JSON.parse(i.comments.S); } catch { /* ignore corrupt blob */ }
    }
    return trip;
  },
  async putTripEnrichment(tripId, enrichment) {
    const d = await dynamo();
    await d.client.send(new d.UpdateItemCommand({
      TableName: TRIPS_TABLE,
      Key: { trip_id: { S: tripId } },
      UpdateExpression: 'SET enrichment = :e',
      ConditionExpression: 'attribute_exists(trip_id)',
      ExpressionAttributeValues: { ':e': { S: JSON.stringify(enrichment) } },
    }));
    return this.getTrip(tripId);
  },
  // Comments are read-modify-write on a JSON attribute — fine at personal
  // scale; move to their own table if concurrent commenting ever matters.
  async addTripComment(tripId, comment) {
    const trip = await this.getTrip(tripId);
    if (!trip) return null;
    const comments = [...(trip.comments || []), comment];
    const d = await dynamo();
    await d.client.send(new d.UpdateItemCommand({
      TableName: TRIPS_TABLE,
      Key: { trip_id: { S: tripId } },
      UpdateExpression: 'SET comments = :c',
      ConditionExpression: 'attribute_exists(trip_id)',
      ExpressionAttributeValues: { ':c': { S: JSON.stringify(comments) } },
    }));
    return comment;
  },
  async deleteTripComment(tripId, commentId) {
    const trip = await this.getTrip(tripId);
    if (!trip) return null;
    const comments = (trip.comments || []).filter((c) => c.id !== commentId);
    const d = await dynamo();
    await d.client.send(new d.UpdateItemCommand({
      TableName: TRIPS_TABLE,
      Key: { trip_id: { S: tripId } },
      UpdateExpression: 'SET comments = :c',
      ConditionExpression: 'attribute_exists(trip_id)',
      ExpressionAttributeValues: { ':c': { S: JSON.stringify(comments) } },
    }));
    return true;
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
        state: { S: JSON.stringify({ plans: variant.plans, dayMeta: variant.dayMeta, customPlaces: variant.customPlaces || [] }) },
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
  async listSharesForTrip(tripId) {
    const d = await dynamo();
    const res = await d.client.send(new d.QueryCommand({
      TableName: SHARES_TABLE,
      KeyConditionExpression: 'trip_id = :t',
      ExpressionAttributeValues: { ':t': { S: tripId } },
    }));
    return (res.Items || []).map(shareFromItem);
  },
  async listSharesForEmail(email) {
    const d = await dynamo();
    const res = await d.client.send(new d.ScanCommand({
      TableName: SHARES_TABLE,
      FilterExpression: 'email = :e',
      ExpressionAttributeValues: { ':e': { S: email.toLowerCase() } },
    }));
    return (res.Items || []).map(shareFromItem);
  },
  async putShare(share) {
    const d = await dynamo();
    await d.client.send(new d.PutItemCommand({
      TableName: SHARES_TABLE,
      Item: {
        trip_id: { S: share.trip_id },
        email: { S: share.email },
        role: { S: share.role },
        invited_by: { S: share.invited_by },
        created_at: { S: share.created_at },
      },
    }));
    return share;
  },
  async deleteShare(tripId, email) {
    const d = await dynamo();
    await d.client.send(new d.DeleteItemCommand({
      TableName: SHARES_TABLE,
      Key: { trip_id: { S: tripId }, email: { S: email.toLowerCase() } },
    }));
  },
};

const dynamoTicketsDriver = {
  async createTicket({ subject, description, email }) {
    const d = await dynamo();
    const ticket = {
      id: newStoreId(),
      subject, description, email,
      status: 'new',
      created_at: new Date().toISOString(),
    };
    await d.client.send(new d.PutItemCommand({
      TableName: TICKETS_TABLE,
      Item: {
        id: { S: ticket.id },
        subject: { S: ticket.subject },
        description: { S: ticket.description },
        email: { S: ticket.email },
        status: { S: ticket.status },
        created_at: { S: ticket.created_at },
      },
    }));
    return ticket;
  },
  async listTickets() {
    const d = await dynamo();
    // Scan is fine at personal scale (same call as listUsers).
    const res = await d.client.send(new d.ScanCommand({ TableName: TICKETS_TABLE }));
    return (res.Items || []).map(ticketFromItem)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  },
  async getTicket(id) {
    const d = await dynamo();
    const res = await d.client.send(new d.GetItemCommand({
      TableName: TICKETS_TABLE, Key: { id: { S: id } },
    }));
    return res.Item ? ticketFromItem(res.Item) : null;
  },
  async updateTicketStatus(id, status) {
    const existing = await this.getTicket(id);
    if (!existing) return null;
    const d = await dynamo();
    const updated = { ...existing, status };
    await d.client.send(new d.PutItemCommand({
      TableName: TICKETS_TABLE,
      Item: {
        id: { S: updated.id },
        subject: { S: updated.subject },
        description: { S: updated.description },
        email: { S: updated.email },
        status: { S: updated.status },
        created_at: { S: updated.created_at },
      },
    }));
    return updated;
  },
};

function ticketFromItem(i) {
  return {
    id: i.id.S,
    subject: i.subject?.S || '',
    description: i.description?.S || '',
    email: i.email?.S || '',
    status: i.status?.S || 'new',
    created_at: i.created_at?.S,
  };
}

function shareFromItem(i) {
  return {
    trip_id: i.trip_id.S, email: i.email.S, role: i.role.S,
    invited_by: i.invited_by?.S, created_at: i.created_at?.S,
  };
}

function variantFromItem(i) {
  const state = JSON.parse(i.state?.S || '{}');
  return {
    trip_id: i.trip_id.S,
    variant_id: i.variant_id.S,
    name: i.name?.S || '',
    plans: state.plans || {},
    dayMeta: state.dayMeta || {},
    customPlaces: state.customPlaces || [],
    version: Number(i.version?.N || 1),
  };
}

const driver = DRIVER === 'dynamo' ? dynamoDriver : fileDriver;
const tripsDriver = DRIVER === 'dynamo' ? dynamoTripsDriver : fileTripsDriver;
const ticketsDriver = DRIVER === 'dynamo' ? dynamoTicketsDriver : fileTicketsDriver;

export const upsertUser = driver.upsertUser.bind(driver);
export const getUser = driver.getUser.bind(driver);
export const listUsers = driver.listUsers.bind(driver);

export const createTrip = tripsDriver.createTrip.bind(tripsDriver);
export const getTrip = tripsDriver.getTrip.bind(tripsDriver);
export const putTripEnrichment = tripsDriver.putTripEnrichment.bind(tripsDriver);
export const addTripComment = tripsDriver.addTripComment.bind(tripsDriver);
export const deleteTripComment = tripsDriver.deleteTripComment.bind(tripsDriver);
export const listTripsForOwner = tripsDriver.listTripsForOwner.bind(tripsDriver);
export const deleteTrip = tripsDriver.deleteTrip.bind(tripsDriver);
export const listVariants = tripsDriver.listVariants.bind(tripsDriver);
export const getVariant = tripsDriver.getVariant.bind(tripsDriver);
export const putVariant = tripsDriver.putVariant.bind(tripsDriver);
export const deleteVariant = tripsDriver.deleteVariant.bind(tripsDriver);
export const listSharesForTrip = tripsDriver.listSharesForTrip.bind(tripsDriver);
export const listSharesForEmail = tripsDriver.listSharesForEmail.bind(tripsDriver);
export const putShare = tripsDriver.putShare.bind(tripsDriver);
export const deleteShare = tripsDriver.deleteShare.bind(tripsDriver);

export const createTicket = ticketsDriver.createTicket.bind(ticketsDriver);
export const listTickets = ticketsDriver.listTickets.bind(ticketsDriver);
export const getTicket = ticketsDriver.getTicket.bind(ticketsDriver);
export const updateTicketStatus = ticketsDriver.updateTicketStatus.bind(ticketsDriver);
