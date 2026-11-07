import { describe, it, expect } from "vitest";
import { feedRowProblem } from "../services/catalogFeed";

const good = {
  externalId: "demo-1",
  merchant: "DemoPartner",
  title: "Tee",
  imageUrl: "https://images.example.com/tee.jpg",
  affiliateUrl: "https://shop.example.com/tee?aff=vesta",
};

describe("feedRowProblem", () => {
  it("passes a complete row with web links", () => {
    expect(feedRowProblem(good)).toBeNull();
  });

  it("names the missing field", () => {
    expect(feedRowProblem({ ...good, title: "" })).toBe("missing title");
  });

  it("refuses a buy link that is not a web link", () => {
    expect(feedRowProblem({ ...good, affiliateUrl: "javascript:alert(1)" })).toBe(
      "affiliateUrl is not an http(s) link",
    );
  });

  it("refuses an image link that is not a web link", () => {
    expect(feedRowProblem({ ...good, imageUrl: "data:image/png;base64,AAAA" })).toBe(
      "imageUrl is not an http(s) link",
    );
  });
});
