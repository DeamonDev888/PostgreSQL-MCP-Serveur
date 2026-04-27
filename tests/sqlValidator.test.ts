import { describe, it, expect } from "vitest";
import {
  validateIdentifier,
  validateTableName,
  validateColumnName,
  validateSchema,
  validateDimensions,
  validateIdType,
  sanitizeIndexName,
  buildFullTableName,
  validateSelectColumns,
} from "../src/utils/sqlValidator.js";

describe("sqlValidator", () => {
  describe("validateIdentifier", () => {
    it("accepts valid identifiers", () => {
      expect(validateIdentifier("users")).toBe('"users"');
      expect(validateIdentifier("_private")).toBe('"_private"');
      expect(validateIdentifier("table_1")).toBe('"table_1"');
    });

    it("rejects identifiers with special characters", () => {
      expect(() => validateIdentifier("evil; DROP TABLE x; --")).toThrow(
        /invalid characters/i,
      );
      expect(() => validateIdentifier("table name")).toThrow(
        /invalid characters/i,
      );
      expect(() => validateIdentifier("1startWithNumber")).toThrow(
        /invalid characters/i,
      );
    });

    it("rejects empty identifiers", () => {
      expect(() => validateIdentifier("")).toThrow(/non-empty string/);
      expect(() => validateIdentifier(null as any)).toThrow(/non-empty string/);
    });
  });

  describe("validateTableName", () => {
    it("accepts valid table names", () => {
      expect(validateTableName("documents")).toBe('"documents"');
      expect(validateTableName("enhanced_news")).toBe('"enhanced_news"');
    });

    it("rejects SQL injection in table name", () => {
      expect(() => validateTableName("x; DROP TABLE users; --")).toThrow(
        /invalid characters/i,
      );
      expect(() => validateTableName("table`; DROP TABLE x;--")).toThrow(
        /invalid characters/i,
      );
    });
  });

  describe("validateColumnName", () => {
    it("accepts valid column names", () => {
      expect(validateColumnName("embedding")).toBe('"embedding"');
      expect(validateColumnName("id")).toBe('"id"');
    });

    it("rejects SQL injection in column name", () => {
      expect(() =>
        validateColumnName("col) VALUES (1); DROP TABLE x;--"),
      ).toThrow(/invalid characters/i);
    });
  });

  describe("validateSchema", () => {
    it("accepts valid schema names", () => {
      expect(validateSchema("public")).toBe('"public"');
    });
  });

  describe("validateDimensions", () => {
    it("accepts valid dimensions", () => {
      expect(() => validateDimensions(4096)).not.toThrow();
      expect(() => validateDimensions(1536)).not.toThrow();
      expect(() => validateDimensions(1)).not.toThrow();
    });

    it("rejects invalid dimensions", () => {
      expect(() => validateDimensions(0)).toThrow();
      expect(() => validateDimensions(-1)).toThrow();
      expect(() => validateDimensions(1.5)).toThrow();
      expect(() => validateDimensions(70000)).toThrow();
    });
  });

  describe("validateIdType", () => {
    it("accepts valid id types", () => {
      expect(validateIdType("SERIAL PRIMARY KEY")).toBe(
        "SERIAL PRIMARY KEY",
      );
      expect(validateIdType("UUID PRIMARY KEY DEFAULT gen_random_uuid()")).toBe(
        "UUID PRIMARY KEY DEFAULT gen_random_uuid()",
      );
    });

    it("rejects invalid id types", () => {
      expect(() => validateIdType("VARCHAR(255)")).toThrow(/Invalid idType/);
    });
  });

  describe("sanitizeIndexName", () => {
    it("accepts valid index names", () => {
      expect(sanitizeIndexName("my_idx")).toBe('"my_idx"');
    });

    it("rejects invalid index names", () => {
      expect(() => sanitizeIndexName("idx; DROP TABLE x;--")).toThrow(
        /invalid characters/i,
      );
    });
  });

  describe("buildFullTableName", () => {
    it("builds properly quoted schema.table", () => {
      expect(buildFullTableName("public", "documents")).toBe(
        '"public"."documents"',
      );
    });

    it("rejects injection via schema", () => {
      expect(() => buildFullTableName("public; DROP SCHEMA public;--", "t")).toThrow();
    });
  });

  describe("validateSelectColumns", () => {
    it("accepts wildcard", () => {
      expect(validateSelectColumns("*")).toBe("*");
    });

    it("accepts valid column names", () => {
      expect(validateSelectColumns("id,name")).toBe('"id", "name"');
    });

    it("accepts function calls", () => {
      expect(validateSelectColumns("COUNT(*)")).toBe("COUNT(*)");
    });

    it("rejects invalid column names", () => {
      expect(() => validateSelectColumns("id; DROP TABLE x;--")).toThrow();
    });
  });
});
