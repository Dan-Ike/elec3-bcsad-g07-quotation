/**
 * Script Name: quotation-handler
 * Type: AWS Lambda function (Node.js 24.x, ES module)
 * Location: Lambda console > umak-elec3-bcsad-g07-quotation-handler > Code > index.mjs
 * Env vars: TABLE_NAME, CLERK_KEY
 * Routes: POST /requests | GET /requests | GET /requests/{requestId} | PUT /requests/{requestId}/quotation
 */
import { randomBytes } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const TABLE = process.env.TABLE_NAME;
const CLERK_KEY = process.env.CLERK_KEY;

const reply = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const isClerk = (event) =>
  Boolean(CLERK_KEY) && event.headers?.["x-clerk-key"] === CLERK_KEY;
const okText = (v, max) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const okItem = (it) =>
  it &&
  okText(it.name, 80) &&
  okText(it.unit, 20) &&
  Number.isFinite(it.qty) &&
  it.qty > 0 &&
  it.qty <= 100000;
const round2 = (n) => Math.round(n * 100) / 100;

export const handler = async (event) => {
  try {
    const route = event.routeKey;
    const id = event.pathParameters?.requestId?.toUpperCase();
    const body = event.body ? JSON.parse(event.body) : {};

    // 1. Contractor sends a request (public)
    if (route === "POST /requests") {
      const { contractorName, contact, items } = body;
      if (
        !okText(contractorName, 80) ||
        !okText(contact, 120) ||
        !Array.isArray(items) ||
        items.length < 1 ||
        items.length > 30 ||
        !items.every(okItem)
      ) {
        return reply(400, { error: "Invalid request" });
      }
      const requestId = randomBytes(8).toString("hex").toUpperCase();
      await db.send(
        new PutCommand({
          TableName: TABLE,
          Item: {
            requestId,
            contractorName: contractorName.trim(),
            contact: contact.trim(),
            items: items.map((it) => ({
              name: it.name.trim(),
              unit: it.unit.trim(),
              qty: it.qty,
            })),
            status: "OPEN",
            createdAt: new Date().toISOString(),
          },
          ConditionExpression: "attribute_not_exists(requestId)",
        })
      );
      return reply(201, { requestId });
    }

    // 2. Contractor reads status and quotation by request number (public, one item only)
    if (route === "GET /requests/{requestId}") {
      const { Item } = await db.send(
        new GetCommand({ TableName: TABLE, Key: { requestId: id } })
      );
      if (!Item) return reply(404, { error: "Request not found" });
      return reply(200, {
        requestId: Item.requestId,
        status: Item.status,
        createdAt: Item.createdAt,
        items: Item.items,
        quotation: Item.quotation,
        quotedAt: Item.quotedAt,
      });
    }

    // Everything below is for the sales clerk only
    if (!isClerk(event)) return reply(403, { error: "Forbidden" });

    // 3. Clerk lists open requests, oldest first
    if (route === "GET /requests") {
      let items = [];
      let startKey;
      do {
        const out = await db.send(
          new ScanCommand({
            TableName: TABLE,
            FilterExpression: "#s = :open",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: { ":open": "OPEN" },
            ExclusiveStartKey: startKey,
          })
        );
        items = items.concat(out.Items ?? []);
        startKey = out.LastEvaluatedKey;
      } while (startKey);
      items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return reply(200, { requests: items });
    }

    // 4. Clerk saves the price of each item; the total is computed here
    if (route === "PUT /requests/{requestId}/quotation") {
      const { Item } = await db.send(
        new GetCommand({ TableName: TABLE, Key: { requestId: id } })
      );
      if (!Item) return reply(404, { error: "Request not found" });
      const prices = body.prices;
      if (
        !Array.isArray(prices) ||
        prices.length !== Item.items.length ||
        !prices.every((p) => Number.isFinite(p) && p >= 0 && p <= 10000000)
      ) {
        return reply(400, { error: "Invalid prices" });
      }
      const lines = Item.items.map((it, i) => ({
        ...it,
        unitPrice: prices[i],
        lineTotal: round2(it.qty * prices[i]),
      }));
      const total = round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));
      try {
        await db.send(
          new UpdateCommand({
            TableName: TABLE,
            Key: { requestId: id },
            UpdateExpression: "SET #s = :quoted, quotation = :q, quotedAt = :now",
            ConditionExpression: "#s = :open",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: {
              ":quoted": "QUOTED",
              ":open": "OPEN",
              ":q": { lines, total },
              ":now": new Date().toISOString(),
            },
          })
        );
      } catch (e) {
        if (e.name === "ConditionalCheckFailedException") {
          return reply(409, { error: "Already quoted" });
        }
        throw e;
      }
      return reply(200, { requestId: id, total });
    }

    return reply(404, { error: "Route not found" });
  } catch (err) {
    if (err instanceof SyntaxError) return reply(400, { error: "Bad JSON" });
    console.error(err);
    return reply(500, { error: "Server error" });
  }
};
