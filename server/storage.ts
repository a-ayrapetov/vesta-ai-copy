import {
  users,
  chatHistories,
  products,
  carts,
  cartItems,
  productClicks,
  type User,
  type InsertUser,
  type ChatHistory,
  type InsertChatHistory,
  type Message,
  type Product,
  type InsertProduct,
  type Cart,
  type CartLine,
} from "@shared/schema";
import { db } from "./db";
import { and, desc, eq, ilike, or, sql, SQL } from "drizzle-orm";

export interface CatalogQuery {
  audience?: string;
  category?: string;
  color?: string;
  style?: string;
  search?: string;
  limit?: number;
  offset?: number;
  activeOnly?: boolean;
}

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  ensureLocalUser(id?: number): Promise<User>;

  // CHANGED: every chat-history call is scoped to the browser session
  getChatHistory(id: number, sessionId: string): Promise<ChatHistory | undefined>;
  getChatHistoriesForSession(sessionId: string): Promise<ChatHistory[]>;
  createChatHistory(chatHistory: InsertChatHistory & { sessionId: string }): Promise<ChatHistory>;
  updateChatHistory(id: number, sessionId: string, messages: Message[]): Promise<ChatHistory | undefined>;

  listProducts(query?: CatalogQuery): Promise<Product[]>;
  countProducts(query?: CatalogQuery): Promise<number>;
  getProductById(id: number): Promise<Product | undefined>;
  upsertProduct(product: InsertProduct): Promise<Product>;

  getOrCreateCart(sessionId: string): Promise<Cart>;
  getCartLines(cartId: number): Promise<CartLine[]>;
  addCartItem(cartId: number, productId: number, quantity: number): Promise<void>;
  setCartItemQuantity(
    cartId: number,
    itemId: number,
    quantity: number
  ): Promise<boolean>;
  removeCartItem(cartId: number, itemId: number): Promise<boolean>;
  clearCart(cartId: number): Promise<void>;
  logProductClick(
    productId: number,
    sessionId: string | null,
    source: string
  ): Promise<void>;
}

function buildProductFilters(query: CatalogQuery = {}): SQL[] {
  const filters: SQL[] = [];
  const activeOnly = query.activeOnly !== false;
  if (activeOnly) {
    filters.push(eq(products.isActive, true));
  }
  if (query.audience && query.audience !== "any") {
    // feminine/masculine: include matching + any (unisex)
    filters.push(
      or(
        eq(products.audience, query.audience),
        eq(products.audience, "any")
      )!
    );
  }
  if (query.category) {
    filters.push(eq(products.category, query.category));
  }
  if (query.search) {
    const term = `%${query.search}%`;
    filters.push(
      or(ilike(products.title, term), ilike(products.description, term))!
    );
  }
  if (query.color) {
    const c = query.color.toLowerCase();
    filters.push(
      sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(${products.colors}) AS col
        WHERE lower(col) = ${c}
      )`
    );
  }
  if (query.style) {
    const s = query.style.toLowerCase();
    filters.push(
      sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(${products.styleTags}) AS tag
        WHERE lower(tag) = ${s}
      )`
    );
  }
  return filters;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async ensureLocalUser(_id: number = 1): Promise<User> {
    const byName = await this.getUserByUsername("local");
    if (byName) return byName;

    return this.createUser({
      username: "local",
      password: "local-mvp-not-for-production",
    });
  }

  async getChatHistory(id: number, sessionId: string): Promise<ChatHistory | undefined> {
    const [history] = await db
      .select()
      .from(chatHistories)
      .where(and(eq(chatHistories.id, id), eq(chatHistories.sessionId, sessionId)));
    return history || undefined;
  }

  async getChatHistoriesForSession(sessionId: string): Promise<ChatHistory[]> {
    return await db
      .select()
      .from(chatHistories)
      .where(eq(chatHistories.sessionId, sessionId))
      .orderBy(desc(chatHistories.updatedAt));
  }

  async createChatHistory(
    chatHistory: InsertChatHistory & { sessionId: string },
  ): Promise<ChatHistory> {
    const [history] = await db
      .insert(chatHistories)
      .values(chatHistory)
      .returning();
    return history;
  }

  async updateChatHistory(
    id: number,
    sessionId: string,
    messages: Message[]
  ): Promise<ChatHistory | undefined> {
    const [updatedHistory] = await db
      .update(chatHistories)
      .set({
        messages: messages,
        updatedAt: new Date(),
      })
      .where(and(eq(chatHistories.id, id), eq(chatHistories.sessionId, sessionId)))
      .returning();

    return updatedHistory || undefined;
  }

  async listProducts(query: CatalogQuery = {}): Promise<Product[]> {
    const filters = buildProductFilters(query);
    const limit = Math.min(Math.max(query.limit ?? 24, 1), 100);
    const offset = Math.max(query.offset ?? 0, 0);

    const q = db.select().from(products);
    if (filters.length > 0) {
      return q
        .where(and(...filters))
        .limit(limit)
        .offset(offset);
    }
    return q.limit(limit).offset(offset);
  }

  async countProducts(query: CatalogQuery = {}): Promise<number> {
    const filters = buildProductFilters(query);
    const base = db.select({ count: sql<number>`count(*)::int` }).from(products);
    const [row] =
      filters.length > 0
        ? await base.where(and(...filters))
        : await base;
    return row?.count ?? 0;
  }

  async getProductById(id: number): Promise<Product | undefined> {
    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.id, id));
    return product || undefined;
  }

  async upsertProduct(product: InsertProduct): Promise<Product> {
    const colors = Array.isArray(product.colors)
      ? ([...product.colors] as string[])
      : ([] as string[]);
    const styleTags = Array.isArray(product.styleTags)
      ? ([...product.styleTags] as string[])
      : ([] as string[]);
    const payload = {
      externalId: product.externalId,
      merchant: product.merchant,
      title: product.title,
      description: product.description ?? "",
      imageUrl: product.imageUrl,
      affiliateUrl: product.affiliateUrl,
      priceCents: product.priceCents ?? null,
      currency: product.currency ?? "USD",
      category: product.category ?? "unknown",
      audience: product.audience ?? "any",
      colors,
      styleTags,
      isActive: product.isActive ?? true,
      raw: product.raw ?? null,
    };

    const existing = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.merchant, product.merchant),
          eq(products.externalId, product.externalId)
        )
      )
      .limit(1);

    if (existing[0]) {
      const [updated] = await db
        .update(products)
        .set({
          ...payload,
          updatedAt: new Date(),
        })
        .where(eq(products.id, existing[0].id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(products).values(payload).returning();
    return created;
  }

  async getOrCreateCart(sessionId: string): Promise<Cart> {
    const [existing] = await db
      .select()
      .from(carts)
      .where(eq(carts.sessionId, sessionId))
      .limit(1);
    if (existing) return existing;

    const [created] = await db
      .insert(carts)
      .values({ sessionId })
      .onConflictDoNothing({ target: carts.sessionId })
      .returning();
    if (created) return created;

    // Lost a race with a concurrent request for the same session
    const [raced] = await db
      .select()
      .from(carts)
      .where(eq(carts.sessionId, sessionId))
      .limit(1);
    return raced;
  }

  async getCartLines(cartId: number): Promise<CartLine[]> {
    const rows = await db
      .select({
        itemId: cartItems.id,
        quantity: cartItems.quantity,
        product: products,
      })
      .from(cartItems)
      .innerJoin(products, eq(cartItems.productId, products.id))
      .where(eq(cartItems.cartId, cartId))
      .orderBy(cartItems.id);

    return rows.map((row) => ({
      itemId: row.itemId,
      quantity: row.quantity,
      product: row.product,
    }));
  }

  async addCartItem(
    cartId: number,
    productId: number,
    quantity: number
  ): Promise<void> {
    await db
      .insert(cartItems)
      .values({ cartId, productId, quantity })
      .onConflictDoUpdate({
        target: [cartItems.cartId, cartItems.productId],
        set: {
          quantity: sql`${cartItems.quantity} + ${quantity}`,
          updatedAt: new Date(),
        },
      });
    await this.touchCart(cartId);
  }

  async setCartItemQuantity(
    cartId: number,
    itemId: number,
    quantity: number
  ): Promise<boolean> {
    // cartId in the predicate is the ownership check — never trust itemId alone
    const updated = await db
      .update(cartItems)
      .set({ quantity, updatedAt: new Date() })
      .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)))
      .returning({ id: cartItems.id });

    if (updated.length > 0) await this.touchCart(cartId);
    return updated.length > 0;
  }

  async removeCartItem(cartId: number, itemId: number): Promise<boolean> {
    const removed = await db
      .delete(cartItems)
      .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)))
      .returning({ id: cartItems.id });

    if (removed.length > 0) await this.touchCart(cartId);
    return removed.length > 0;
  }

  async clearCart(cartId: number): Promise<void> {
    await db.delete(cartItems).where(eq(cartItems.cartId, cartId));
    await this.touchCart(cartId);
  }

  async logProductClick(
    productId: number,
    sessionId: string | null,
    source: string
  ): Promise<void> {
    await db.insert(productClicks).values({ productId, sessionId, source });
  }

  private async touchCart(cartId: number): Promise<void> {
    await db
      .update(carts)
      .set({ updatedAt: new Date() })
      .where(eq(carts.id, cartId));
  }
}

export const storage = new DatabaseStorage();
