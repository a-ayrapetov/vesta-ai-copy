import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { z } from "zod";
import { messageSchema } from "@shared/schema";
import { generateFashionResponse } from "./services/fashionAi";
import { processVirtualTryOn } from "./services/virtualTryOn";
import { getDeepFashionRecommendations, getDeepFashionOutfits } from "./services/deepFashion";
import { chatRequestSchema } from "./validation";
import { createRateLimiter } from "./middleware/rateLimit";
import { isSafeHttpUrl } from "@shared/safeUrl";

export async function registerRoutes(app: Express): Promise<Server> {
  // ADDED: requests per minute per client IP on /api/chat. EDIT via CHAT_RATE_LIMIT_PER_MIN.
  const chatLimiter = createRateLimiter({
    windowMs: 60_000,
    max: Number(process.env.CHAT_RATE_LIMIT_PER_MIN) || 20,
  });

  // Health check for Docker / load balancers
  app.get('/api/health', async (_req, res) => {
    return res.json({
      status: 'ok',
      storageMode: process.env.STORAGE_MODE || 'local',
      pythonServiceConfigured: Boolean(process.env.PYTHON_SERVICE_URL),
    });
  });

  // Chat endpoint
  app.post('/api/chat', async (req, res) => {
    try {
      // CHANGED: size and type limits (validation.ts), then a per-IP throttle so
      // only valid requests that would reach the paid Claude API are counted.
      const validatedData = chatRequestSchema.parse(req.body);

      const limit = chatLimiter.hit(req.ip || 'unknown');
      if (!limit.allowed) {
        res.setHeader('Retry-After', String(limit.retryAfterSec));
        return res.status(429).json({
          message: `You're sending messages quickly. Try again in ${limit.retryAfterSec} seconds.`,
        });
      }

      // Process the message with Claude (with or without image)
      const response = await generateFashionResponse(
        validatedData.message, 
        validatedData.history || [],
        validatedData.imageData
      );
      
      return res.json(response);
    } catch (error) {
      console.error('Error processing chat request:', error);
      if (error instanceof z.ZodError) {
        // CHANGED: lead with the plain reason (e.g. image too large) so the UI can show it
        const reason = error.errors[0]?.message || 'Invalid request data';
        return res.status(400).json({ message: reason, errors: error.errors });
      }
      return res.status(500).json({ message: 'Error processing your request' });
    }
  });

  // Save chat history endpoint
  app.post('/api/chat/history', async (req, res) => {
    try {
      const requestSchema = z.object({
        messages: z.array(messageSchema),
        userId: z.number().optional()
      });

      const validatedData = requestSchema.parse(req.body);
      const localUser = await storage.ensureLocalUser();
      
      const chatHistory = await storage.createChatHistory({
        userId: localUser.id,
        sessionId: req.sessionId, // CHANGED: owned by this browser
        messages: validatedData.messages
      });
      
      return res.json({ 
        success: true,
        chatHistoryId: chatHistory.id 
      });
    } catch (error) {
      console.error('Error saving chat history:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid chat history data', errors: error.errors });
      }
      return res.status(500).json({ message: 'Error saving chat history' });
    }
  });
  
  // Get chat history by ID
  app.get('/api/chat/history/:id', async (req, res) => {
    try {
      const historyId = parseInt(req.params.id);
      
      if (isNaN(historyId)) {
        return res.status(400).json({ message: 'Invalid chat history ID' });
      }
      
      const chatHistory = await storage.getChatHistory(historyId, req.sessionId);
      
      if (!chatHistory) {
        return res.status(404).json({ message: 'Chat history not found' });
      }
      
      return res.json(chatHistory);
    } catch (error) {
      console.error('Error retrieving chat history:', error);
      return res.status(500).json({ message: 'Error retrieving chat history' });
    }
  });
  
  // Chat histories for this browser. CHANGED: :userId is kept for client
  // compatibility but no longer selects whose chats are returned.
  app.get('/api/chat/histories/:userId', async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);

      if (isNaN(userId)) {
        return res.status(400).json({ message: 'Invalid user ID' });
      }

      const chatHistories = await storage.getChatHistoriesForSession(req.sessionId);
      
      return res.json(chatHistories);
    } catch (error) {
      console.error('Error retrieving chat histories:', error);
      return res.status(500).json({ message: 'Error retrieving chat histories' });
    }
  });
  
  // Update chat history
  app.put('/api/chat/history/:id', async (req, res) => {
    try {
      const historyId = parseInt(req.params.id);
      
      if (isNaN(historyId)) {
        return res.status(400).json({ message: 'Invalid chat history ID' });
      }
      
      const requestSchema = z.object({
        messages: z.array(messageSchema)
      });
      
      const validatedData = requestSchema.parse(req.body);
      
      const updatedHistory = await storage.updateChatHistory(
        historyId,
        req.sessionId,
        validatedData.messages
      );
      
      if (!updatedHistory) {
        return res.status(404).json({ message: 'Chat history not found' });
      }
      
      return res.json({ 
        success: true,
        chatHistory: updatedHistory 
      });
    } catch (error) {
      console.error('Error updating chat history:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid chat history data', errors: error.errors });
      }
      return res.status(500).json({ message: 'Error updating chat history' });
    }
  });

  // Virtual try-on endpoint
  app.post('/api/virtual-try-on', async (req, res) => {
    try {
      const requestSchema = z.object({
        userPhoto: z.string(), // Base64 encoded image
        productImage: z.string(), // Base64 encoded image
        productName: z.string().optional(),
      });

      const validatedData = requestSchema.parse(req.body);
      
      // Process virtual try-on
      const result = await processVirtualTryOn({
        userPhoto: validatedData.userPhoto,
        productImage: validatedData.productImage,
        productName: validatedData.productName || 'Product',
      });
      
      return res.json(result);
    } catch (error) {
      console.error('Error processing virtual try-on:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid request data', errors: error.errors });
      }
      return res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Error processing virtual try-on' 
      });
    }
  });

  // Get fashion recommendations from DeepFashion-MultiModal dataset
  app.get('/api/recommendations', async (req, res) => {
    try {
      const query = req.query.query as string | undefined;
      const limit = parseInt(req.query.limit as string) || 12;
      
      let outfits;
      if (query) {
        // Get items based on query
        outfits = getDeepFashionOutfits(query, limit);
      } else {
        // Get diverse items from all categories
        outfits = getDeepFashionRecommendations(limit);
      }
      
      return res.json({
        success: true,
        outfits: outfits,
        count: outfits.length
      });
    } catch (error) {
      console.error('Error getting recommendations:', error);
      return res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Error getting recommendations' 
      });
    }
  });

  /**
   * Affiliate product catalog (online-only). Filters: audience, category, color, style, search.
   * Cart / checkout handoff is Milestone 3 — this returns shoppable affiliateUrl only.
   */
  app.get('/api/catalog', async (req, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit || '24'), 10) || 24, 100);
      const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);
      const audience = typeof req.query.audience === 'string' ? req.query.audience : undefined;
      const category = typeof req.query.category === 'string' ? req.query.category : undefined;
      const color = typeof req.query.color === 'string' ? req.query.color : undefined;
      const style = typeof req.query.style === 'string' ? req.query.style : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      // alias gender → audience
      const gender = typeof req.query.gender === 'string' ? req.query.gender : undefined;
      const resolvedAudience = audience || gender;

      const query = {
        audience: resolvedAudience,
        category,
        color,
        style,
        search,
        limit,
        offset,
        activeOnly: true,
      };

      const [items, total] = await Promise.all([
        storage.listProducts(query),
        storage.countProducts(query),
      ]);

      return res.json({
        success: true,
        total,
        limit,
        offset,
        products: items.map((p) => ({
          id: p.id,
          externalId: p.externalId,
          merchant: p.merchant,
          title: p.title,
          description: p.description,
          imageUrl: p.imageUrl,
          affiliateUrl: p.affiliateUrl,
          priceCents: p.priceCents,
          currency: p.currency,
          category: p.category,
          audience: p.audience,
          colors: p.colors,
          styleTags: p.styleTags,
        })),
      });
    } catch (error) {
      console.error('Error listing catalog:', error);
      return res.status(500).json({
        message: error instanceof Error ? error.message : 'Error listing catalog',
      });
    }
  });

  /**
   * Cart — staging only. Vesta never takes payment; checkout is handed off to
   * the merchant via the affiliate link (see GET /api/go/:productId).
   * Ownership always comes from the session cookie, never from the request body.
   */
  async function cartPayload(sessionId: string) {
    const cart = await storage.getOrCreateCart(sessionId);
    const lines = await storage.getCartLines(cart.id);

    const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
    const priced = lines.filter((line) => typeof line.product.priceCents === 'number');
    const subtotalCents = priced.reduce(
      (sum, line) => sum + (line.product.priceCents as number) * line.quantity,
      0
    );
    const currency = priced[0]?.product.currency || 'USD';

    // Affiliate carts span merchants, so checkout is per merchant
    const merchants = new Map<string, typeof lines>();
    for (const line of lines) {
      const key = line.product.merchant;
      if (!merchants.has(key)) merchants.set(key, []);
      merchants.get(key)!.push(line);
    }

    return {
      itemCount,
      subtotalCents,
      currency,
      hasUnpricedItems: priced.length !== lines.length,
      merchants: Array.from(merchants.entries()).map(([merchant, items]) => ({
        merchant,
        items: items.map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity,
          productId: line.product.id,
          title: line.product.title,
          imageUrl: line.product.imageUrl,
          priceCents: line.product.priceCents,
          currency: line.product.currency,
          isActive: line.product.isActive,
          checkoutUrl: `/api/go/${line.product.id}?source=cart`,
        })),
      })),
    };
  }

  app.get('/api/cart', async (req, res) => {
    try {
      return res.json({ success: true, cart: await cartPayload(req.sessionId) });
    } catch (error) {
      console.error('Error loading cart:', error);
      return res.status(500).json({ message: 'Error loading cart' });
    }
  });

  app.post('/api/cart/items', async (req, res) => {
    try {
      const body = z
        .object({
          productId: z.number().int().positive(),
          quantity: z.number().int().min(1).max(20).optional(),
        })
        .parse(req.body);

      const product = await storage.getProductById(body.productId);
      if (!product || !product.isActive) {
        return res.status(404).json({ message: 'Product not available' });
      }

      const cart = await storage.getOrCreateCart(req.sessionId);
      await storage.addCartItem(cart.id, product.id, body.quantity ?? 1);

      return res.json({ success: true, cart: await cartPayload(req.sessionId) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid cart item', errors: error.errors });
      }
      console.error('Error adding cart item:', error);
      return res.status(500).json({ message: 'Error adding cart item' });
    }
  });

  app.patch('/api/cart/items/:itemId', async (req, res) => {
    try {
      const itemId = parseInt(req.params.itemId, 10);
      if (isNaN(itemId)) {
        return res.status(400).json({ message: 'Invalid item id' });
      }

      const body = z.object({ quantity: z.number().int().min(0).max(20) }).parse(req.body);
      const cart = await storage.getOrCreateCart(req.sessionId);

      const changed =
        body.quantity === 0
          ? await storage.removeCartItem(cart.id, itemId)
          : await storage.setCartItemQuantity(cart.id, itemId, body.quantity);

      if (!changed) {
        return res.status(404).json({ message: 'Cart item not found' });
      }

      return res.json({ success: true, cart: await cartPayload(req.sessionId) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid quantity', errors: error.errors });
      }
      console.error('Error updating cart item:', error);
      return res.status(500).json({ message: 'Error updating cart item' });
    }
  });

  app.delete('/api/cart/items/:itemId', async (req, res) => {
    try {
      const itemId = parseInt(req.params.itemId, 10);
      if (isNaN(itemId)) {
        return res.status(400).json({ message: 'Invalid item id' });
      }

      const cart = await storage.getOrCreateCart(req.sessionId);
      const removed = await storage.removeCartItem(cart.id, itemId);
      if (!removed) {
        return res.status(404).json({ message: 'Cart item not found' });
      }

      return res.json({ success: true, cart: await cartPayload(req.sessionId) });
    } catch (error) {
      console.error('Error removing cart item:', error);
      return res.status(500).json({ message: 'Error removing cart item' });
    }
  });

  app.delete('/api/cart', async (req, res) => {
    try {
      const cart = await storage.getOrCreateCart(req.sessionId);
      await storage.clearCart(cart.id);
      return res.json({ success: true, cart: await cartPayload(req.sessionId) });
    } catch (error) {
      console.error('Error clearing cart:', error);
      return res.status(500).json({ message: 'Error clearing cart' });
    }
  });

  /**
   * Outbound affiliate handoff. Records the click first-party (needed to
   * reconcile network reports) then redirects to the merchant.
   */
  app.get('/api/go/:productId', async (req, res) => {
    try {
      const productId = parseInt(req.params.productId, 10);
      if (isNaN(productId)) {
        return res.status(400).json({ message: 'Invalid product id' });
      }

      const product = await storage.getProductById(productId);
      if (!product) {
        return res.status(404).json({ message: 'Product not found' });
      }

      // ADDED: second check after ingest; never redirect to a non-web link
      if (!isSafeHttpUrl(product.affiliateUrl)) {
        console.error(`Refusing redirect for product ${product.id}: affiliateUrl is not http(s)`);
        return res.status(422).json({ message: 'This product link is unavailable' });
      }

      const source = typeof req.query.source === 'string' ? req.query.source : 'unknown';
      try {
        await storage.logProductClick(product.id, req.sessionId, source);
      } catch (logError) {
        // Never block the handoff on analytics
        console.error('Error logging product click:', logError);
      }

      return res.redirect(302, product.affiliateUrl);
    } catch (error) {
      console.error('Error handling affiliate redirect:', error);
      return res.status(500).json({ message: 'Error handling affiliate redirect' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
