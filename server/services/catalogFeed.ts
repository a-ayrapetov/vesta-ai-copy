import { isSafeHttpUrl } from "@shared/safeUrl";

export interface FeedRowLike {
  externalId?: string;
  merchant?: string;
  title?: string;
  imageUrl?: string;
  affiliateUrl?: string;
}

/** Why a feed row must be skipped, or null when it is safe to ingest. */
export function feedRowProblem(row: FeedRowLike): string | null {
  for (const field of ["externalId", "merchant", "title", "imageUrl", "affiliateUrl"] as const) {
    if (!row[field]) return `missing ${field}`;
  }
  if (!isSafeHttpUrl(row.affiliateUrl)) return "affiliateUrl is not an http(s) link";
  if (!isSafeHttpUrl(row.imageUrl)) return "imageUrl is not an http(s) link";
  return null;
}
