/**
 * Offline affiliate catalog ingest.
 * Usage: npm run catalog:ingest
 * Optional: AFFILIATE_FEED_PATH=/path/to/feed.json
 */

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { storage } from "../storage";
import { closeDb } from "../db";
import type { InsertProduct } from "@shared/schema";
import { feedRowProblem } from "../services/catalogFeed";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_FEED = path.join(
  __dirname,
  "../fixtures/affiliate-products.json"
);

interface FeedRow {
  externalId: string;
  merchant: string;
  title: string;
  description?: string;
  imageUrl: string;
  affiliateUrl: string;
  priceCents?: number | null;
  currency?: string;
  category?: string;
  audience?: string;
  colors?: string[];
  styleTags?: string[];
  isActive?: boolean;
  raw?: unknown;
}

function toInsert(row: FeedRow): InsertProduct {
  return {
    externalId: row.externalId,
    merchant: row.merchant,
    title: row.title,
    description: row.description ?? "",
    imageUrl: row.imageUrl,
    affiliateUrl: row.affiliateUrl,
    priceCents: row.priceCents ?? null,
    currency: row.currency ?? "USD",
    category: row.category ?? "unknown",
    audience: row.audience ?? "any",
    colors: (row.colors ?? []).map((c) => c.toLowerCase()),
    styleTags: (row.styleTags ?? []).map((s) => s.toLowerCase()),
    isActive: row.isActive !== false,
    raw: (row.raw as InsertProduct["raw"]) ?? row,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const feedPath = process.env.AFFILIATE_FEED_PATH || DEFAULT_FEED;
  console.log(`Ingesting affiliate feed: ${feedPath}`);

  const raw = readFileSync(feedPath, "utf-8");
  const rows = JSON.parse(raw) as FeedRow[];
  if (!Array.isArray(rows)) {
    throw new Error("Feed must be a JSON array");
  }

  let upserted = 0;
  let skipped = 0;
  for (const row of rows) {
    // CHANGED: also refuses non-web buy and image links (see catalogFeed.ts)
    const problem = feedRowProblem(row);
    if (problem) {
      console.warn(`Skipping row ${row.externalId ?? "(no id)"}: ${problem}`);
      skipped += 1;
      continue;
    }
    await storage.upsertProduct(toInsert(row));
    upserted += 1;
  }

  const total = await storage.countProducts({ activeOnly: true });
  console.log(`✓ Upserted ${upserted} products, skipped ${skipped}. Active catalog size: ${total}`);
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
