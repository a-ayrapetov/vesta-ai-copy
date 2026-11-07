import { describe, it, expect } from "vitest";
import { isSafeHttpUrl } from "@shared/safeUrl";

describe("isSafeHttpUrl", () => {
  it("accepts https and http merchant links", () => {
    expect(isSafeHttpUrl("https://shop.example.com/p/123?aff=vesta")).toBe(true);
    expect(isSafeHttpUrl("http://shop.example.com/p/123")).toBe(true);
  });

  it("rejects script and data schemes", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("JavaScript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects relative, protocol-relative, empty and malformed values", () => {
    expect(isSafeHttpUrl("/api/go/1")).toBe(false);
    expect(isSafeHttpUrl("//evil.example.com")).toBe(false);
    expect(isSafeHttpUrl("")).toBe(false);
    expect(isSafeHttpUrl("not a url")).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
  });

  it("rejects links that embed credentials", () => {
    expect(isSafeHttpUrl("https://user:pass@shop.example.com/p/1")).toBe(false);
  });
});
