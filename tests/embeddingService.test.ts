import { describe, it, expect, vi, beforeEach } from "vitest";

describe("EmbeddingService", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("getDimensionsForModel", () => {
    it("returns 4096 for qwen3-embedding-8b", async () => {
      const { EmbeddingService } = await import(
        "../src/services/embeddingService.js"
      );
      const svc = new EmbeddingService();
      expect(svc.getDimensionsForModel("qwen/qwen3-embedding-8b")).toBe(4096);
    });

    it("returns 1536 for text-embedding-3-small", async () => {
      const { EmbeddingService } = await import(
        "../src/services/embeddingService.js"
      );
      const svc = new EmbeddingService();
      expect(svc.getDimensionsForModel("text-embedding-3-small")).toBe(1536);
    });

    it("returns 1536 for text-embedding-ada-002", async () => {
      const { EmbeddingService } = await import(
        "../src/services/embeddingService.js"
      );
      const svc = new EmbeddingService();
      expect(svc.getDimensionsForModel("text-embedding-ada-002")).toBe(1536);
    });

    it("returns 3072 for text-embedding-3-large", async () => {
      const { EmbeddingService } = await import(
        "../src/services/embeddingService.js"
      );
      const svc = new EmbeddingService();
      expect(svc.getDimensionsForModel("text-embedding-3-large")).toBe(3072);
    });

    it("returns 1536 as fallback for unknown model", async () => {
      const { EmbeddingService } = await import(
        "../src/services/embeddingService.js"
      );
      const svc = new EmbeddingService();
      expect(svc.getDimensionsForModel("some-unknown-model")).toBe(1536);
    });
  });

  describe("generateEmbedding", () => {
    it("returns zero vector for empty text", async () => {
      const { EmbeddingService } = await import(
        "../src/services/embeddingService.js"
      );
      const svc = new EmbeddingService();
      const result = await svc.generateEmbedding("  ", {
        dimensions: 8,
      });
      expect(result).toEqual(new Array(8).fill(0));
    });

    it("throws when no API key configured", async () => {
      const origEnv = { ...process.env };
      delete process.env.OVERMIND_EMBEDDING_KEY;
      delete process.env.OPEN_ROUTER_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.OPENAI_API_KEY;

      try {
        const { EmbeddingService } = await import(
          "../src/services/embeddingService.js"
        );
        const svc = new EmbeddingService();
        await expect(
          svc.generateEmbedding("test query"),
        ).rejects.toThrow(/No API Configuration found/);
      } finally {
        process.env = origEnv;
      }
    });

    it("mentions all three key names in error message", async () => {
      const origEnv = { ...process.env };
      delete process.env.OVERMIND_EMBEDDING_KEY;
      delete process.env.OPEN_ROUTER_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.OPENAI_API_KEY;

      try {
        const { EmbeddingService } = await import(
          "../src/services/embeddingService.js"
        );
        const svc = new EmbeddingService();
        try {
          await svc.generateEmbedding("test");
        } catch (e: any) {
          expect(e.message).toContain("OPENROUTER_API_KEY");
          expect(e.message).toContain("OPEN_ROUTER_API_KEY");
          expect(e.message).toContain("OVERMIND_EMBEDDING_KEY");
        }
      } finally {
        process.env = origEnv;
      }
    });
  });

  describe("LRU Cache", () => {
    it("evicts oldest entry when cache is full via addToCache", async () => {
      const { EmbeddingService } = await import(
        "../src/services/embeddingService.js"
      );
      const svc = new EmbeddingService();
      svc.clearCache();

      for (let i = 0; i < 1001; i++) {
        (svc as any).addToCache(`key:${i}`, [i]);
      }

      expect((svc as any).cache.size).toBeLessThanOrEqual(1000);
      expect((svc as any).cache.has("key:0")).toBe(false);
    });

    it("re-promotes accessed keys (LRU behavior)", async () => {
      const { EmbeddingService } = await import(
        "../src/services/embeddingService.js"
      );
      const svc = new EmbeddingService();
      svc.clearCache();

      (svc as any).addToCache("old", [1]);
      for (let i = 0; i < 1000; i++) {
        (svc as any).addToCache(`fill:${i}`, [i]);
      }

      expect((svc as any).cache.has("old")).toBe(false);
    });

    it("addToCache re-promotes existing key so it is not evicted", async () => {
      const { EmbeddingService } = await import(
        "../src/services/embeddingService.js"
      );
      const svc = new EmbeddingService();
      svc.clearCache();

      (svc as any).addToCache("hot", [1]);
      for (let i = 0; i < 999; i++) {
        (svc as any).addToCache(`fill:${i}`, [i]);
      }
      (svc as any).addToCache("hot", [2]);

      for (let i = 999; i < 1000; i++) {
        (svc as any).addToCache(`extra:${i}`, [i]);
      }

      expect((svc as any).cache.has("hot")).toBe(true);
      expect((svc as any).cache.get("hot")).toEqual([2]);
    });
  });
});
