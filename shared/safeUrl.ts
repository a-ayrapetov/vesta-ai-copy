/**
 * True only for absolute http(s) URLs without embedded credentials.
 * Used at feed ingest and again at redirect time (defense in depth).
 */
export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false; // relative, protocol-relative or malformed
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  return true;
}
