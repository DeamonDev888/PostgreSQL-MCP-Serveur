const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const VALID_DIMENSIONS = /^(4096|1536|3072|1024|768|384|512|256|128|64|32|16)$/;

export function validateIdentifier(
  name: string,
  type: string = "identifier",
): string {
  if (!name || typeof name !== "string") {
    throw new Error(`Invalid ${type}: must be a non-empty string`);
  }
  if (!VALID_IDENTIFIER.test(name)) {
    throw new Error(
      `Invalid ${type}: "${name}" contains invalid characters. Only alphanumeric and underscore allowed, must start with letter or underscore.`,
    );
  }
  return `"${name}"`;
}

export function validateSchema(schema: string): string {
  return validateIdentifier(schema, "schema");
}

export function validateTableName(table: string): string {
  return validateIdentifier(table, "table name");
}

export function validateColumnName(column: string): string {
  return validateIdentifier(column, "column name");
}

export function validateDimensions(dimensions: number): void {
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 65535) {
    throw new Error(
      `Invalid dimensions: ${dimensions}. Must be an integer between 1 and 65535.`,
    );
  }
}

export function validateIdType(idType: string): string {
  const ALLOWED_ID_TYPES = [
    "SERIAL PRIMARY KEY",
    "BIGSERIAL PRIMARY KEY",
    "UUID PRIMARY KEY DEFAULT gen_random_uuid()",
    "UUID PRIMARY KEY DEFAULT uuid_generate_v4()",
    "INTEGER PRIMARY KEY",
    "BIGINT PRIMARY KEY",
    "TEXT PRIMARY KEY",
  ];
  const upper = idType.trim().toUpperCase();
  const match = ALLOWED_ID_TYPES.find((t) => t.toUpperCase() === upper);
  if (!match) {
    throw new Error(
      `Invalid idType: "${idType}". Allowed: ${ALLOWED_ID_TYPES.join(", ")}`,
    );
  }
  return match;
}

export function validateAdditionalColumns(columns: string): string[] {
  const parts = columns
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const validated: string[] = [];
  for (const part of parts) {
    const tokens = part.split(/\s+/);
    if (tokens.length < 2) {
      throw new Error(
        `Invalid additional column definition: "${part}". Expected format: "name TYPE"`,
      );
    }
    const colName = validateIdentifier(tokens[0], "additional column name");
    const colType = tokens.slice(1).join(" ");
    validated.push(`${colName} ${colType}`);
  }
  return validated;
}

export function buildFullTableName(schema: string, tableName: string): string {
  return `${validateSchema(schema)}.${validateTableName(tableName)}`;
}

export function validateTopK(topK: number, max: number = 1000): number {
  if (!Number.isInteger(topK) || topK < 1) {
    throw new Error(`Invalid topK: ${topK}. Must be a positive integer.`);
  }
  if (topK > max) {
    throw new Error(`topK ${topK} exceeds maximum allowed value of ${max}.`);
  }
  return topK;
}

export function sanitizeIndexName(name: string): string {
  if (!VALID_IDENTIFIER.test(name)) {
    throw new Error(
      `Invalid index name: "${name}" contains invalid characters.`,
    );
  }
  return `"${name}"`;
}

export function validateSelectColumns(columns: string): string {
  if (columns.trim() === "*") return "*";
  const cols = columns.split(",").map((c) => c.trim());
  const validated = cols.map((col) => {
    if (VALID_IDENTIFIER.test(col)) return `"${col}"`;
    if (col.includes("(") || col.includes(")")) return col;
    throw new Error(`Invalid select column: "${col}"`);
  });
  return validated.join(", ");
}
