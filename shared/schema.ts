import {
  pgTable,
  text,
  serial,
  integer,
  jsonb,
  timestamp,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User model from original schema
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

// Chat history
/**
 * A chat belongs to the browser session (vesta_sid cookie) that created it, the
 * same way carts do, until real accounts exist. Rows with no session_id (created
 * before this column) are not shown to anyone.
 */
export const chatHistories = pgTable(
  "chat_histories",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id),
    sessionId: text("session_id"),
    messages: jsonb("messages").notNull().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    sessionIdx: index("chat_histories_session_idx").on(table.sessionId),
  }),
);

export const insertChatHistorySchema = createInsertSchema(chatHistories).pick({
  userId: true,
  sessionId: true,
  messages: true,
});

/**
 * Affiliate / partner catalog (online-only — no inventory qty).
 * Checkout happens on merchant via affiliateUrl (cart UI is Milestone 3).
 */
export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    externalId: text("external_id").notNull(),
    merchant: text("merchant").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    imageUrl: text("image_url").notNull(),
    affiliateUrl: text("affiliate_url").notNull(),
    priceCents: integer("price_cents"),
    currency: text("currency").notNull().default("USD"),
    /** Aligns with GarmentCategory in fashionIntent */
    category: text("category").notNull().default("unknown"),
    /** feminine | masculine | any */
    audience: text("audience").notNull().default("any"),
    colors: jsonb("colors").$type<string[]>().notNull().default([]),
    styleTags: jsonb("style_tags").$type<string[]>().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    merchantExternalIdx: uniqueIndex("products_merchant_external_idx").on(
      table.merchant,
      table.externalId
    ),
  })
);

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * Staging cart. Keyed by an anonymous session id so it survives refreshes and
 * restarts before auth exists; `userId` gets filled in when accounts ship.
 */
export const carts = pgTable(
  "carts",
  {
    id: serial("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    userId: integer("user_id").references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    sessionIdx: uniqueIndex("carts_session_idx").on(table.sessionId),
  })
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: serial("id").primaryKey(),
    cartId: integer("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    cartProductIdx: uniqueIndex("cart_items_cart_product_idx").on(
      table.cartId,
      table.productId
    ),
  })
);

/** Outbound affiliate clicks — first-party record for reconciling network reports. */
export const productClicks = pgTable("product_clicks", {
  id: serial("id").primaryKey(),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  sessionId: text("session_id"),
  /** where the click came from: chat | cart | catalog */
  source: text("source").notNull().default("unknown"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Define types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertChatHistory = z.infer<typeof insertChatHistorySchema>;
export type ChatHistory = typeof chatHistories.$inferSelect;

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

export type Cart = typeof carts.$inferSelect;
export type CartItem = typeof cartItems.$inferSelect;
export type ProductClick = typeof productClicks.$inferSelect;

/** Cart row joined with its product, as returned by the cart API. */
export interface CartLine {
  itemId: number;
  quantity: number;
  product: Product;
}

// Message schema for validation
export const messageSchema = z.object({
  id: z.string(),
  content: z.string(),
  role: z.enum(["user", "assistant"]),
  timestamp: z.string(),
  imageData: z.string().optional(),
});

export type Message = z.infer<typeof messageSchema>;
