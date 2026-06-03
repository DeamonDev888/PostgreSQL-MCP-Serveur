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

describe("CoreTools - Registration", () => {
  it("registers 10 core tools correctly", async () => {
    const { CoreTools } = await import(
      "../src/tools/coreTools.js"
    );
    const pool = createMockPool();
    const mockServer = { addTool: vi.fn() };
    const tools = new CoreTools(pool as any, mockServer as any);
    tools.registerTools();

    expect(mockServer.addTool).toHaveBeenCalledTimes(10);
    const names = mockServer.addTool.mock.calls.map((c: any) => c[0].name);
    expect(names).toContain("diagnose");
    expect(names).toContain("explore");
    expect(names).toContain("MCP_PG_VECTOR");
    expect(names).toContain("search");
    expect(names).toContain("insert");
    expect(names).toContain("manage_vectors");
    expect(names).toContain("optimize");
    expect(names).toContain("vectorize_row");
    expect(names).toContain("mcp_db_maintenance");
    expect(names).toContain("help");
  });
});
