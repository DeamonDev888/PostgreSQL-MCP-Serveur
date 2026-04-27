import { describe, it, expect, vi } from "vitest";

function createMockPool(queryResult: any = { rows: [], rowCount: 0 }) {
  const mockClient = {
    query: vi.fn().mockResolvedValue(queryResult),
    release: vi.fn(),
  };
  return {
    connect: vi.fn().mockResolvedValue(mockClient),
    query: vi.fn().mockResolvedValue(queryResult),
    on: vi.fn(),
    end: vi.fn(),
    mockClient,
  };
}

describe("IntelligentSearchTools - Registration", () => {
  it("registers 5 intelligent search tools", async () => {
    const { IntelligentSearchTools } = await import(
      "../src/tools/intelligentSearch.js"
    );
    const pool = createMockPool();
    const mockServer = { addTool: vi.fn() };
    const tools = new IntelligentSearchTools(pool as any, mockServer as any);
    tools.registerTools();

    expect(mockServer.addTool).toHaveBeenCalledTimes(5);
    const names = mockServer.addTool.mock.calls.map((c: any) => c[0].name);
    expect(names).toContain("intelligent_search");
    expect(names).toContain("search_with_mode");
    expect(names).toContain("analyze_query");
    expect(names).toContain("benchmark_search");
    expect(names).toContain("get_search_suggestions");
  });
});

describe("PGVectorTools - Registration", () => {
  it("registers pgvector tools", async () => {
    const { PGVectorTools } = await import("../src/tools/pgvector.js");
    const pool = createMockPool();
    const mockServer = { addTool: vi.fn() };
    const tools = new PGVectorTools(pool as any, mockServer as any);
    tools.registerTools();

    expect(mockServer.addTool.mock.calls.length).toBeGreaterThan(5);
    const names = mockServer.addTool.mock.calls.map((c: any) => c[0].name);
    expect(names).toContain("pgvector_check_extension");
    expect(names).toContain("pgvector_search");
    expect(names).toContain("pgvector_stats");
  });
});
