const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { Pool } = require("pg");
const { z } = require("zod");

// ── Validate required environment variables ──────────────────────────────────
if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is not set.");
  process.exit(1);
}

// ── Blocked SQL patterns (DDL / destructive statements) ──────────────────────
const BLOCKED_PATTERNS = [
  /\bDROP\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\b(?!.*\bWHERE\b)/i, // DELETE without WHERE
  /\bALTER\b/i,
  /\bCREATE\b/i,
  /\bREPLACE\b/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
  /\bEXECUTE\b/i,
  /\bCOPY\b/i,
  /\bpg_read_file\b/i,
  /\bpg_write_file\b/i,
  /\bpg_ls_dir\b/i,
];

function isSafeQuery(sql) {
  return !BLOCKED_PATTERNS.some((pattern) => pattern.test(sql));
}

// ── PostgreSQL connection pool ────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Railway uses self-signed cert
  max: 5,                             // max concurrent connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,           // kill queries running > 10s
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err.message);
});

// ── Sanitise error messages before returning to client ───────────────────────
function safeError(err) {
  const allowed = ["message", "code", "detail", "hint", "position"];
  const out = {};
  for (const key of allowed) {
    if (err[key]) out[key] = err[key];
  }
  return out;
}

// ── MCP Server ────────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "postgres-mcp-server",
  version: "1.0.0",
});

// Tool: run a SQL query
server.tool(
  "query",
  "Run a read or write SQL query against the PostgreSQL database. Destructive DDL (DROP, TRUNCATE, ALTER, etc.) is blocked.",
  { sql: z.string().max(10000).describe("SQL query to execute") },
  async ({ sql }) => {
    if (!isSafeQuery(sql)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "Query blocked: destructive or administrative statements are not permitted.",
            }),
          },
        ],
        isError: true,
      };
    }

    const client = await pool.connect();
    try {
      const result = await client.query(sql);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ rows: result.rows, rowCount: result.rowCount }, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: safeError(err) }, null, 2) }],
        isError: true,
      };
    } finally {
      client.release();
    }
  }
);

// Tool: list all user tables
server.tool(
  "list_tables",
  "List all user tables in the database",
  {},
  async () => {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT table_schema, table_name
         FROM information_schema.tables
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
         ORDER BY table_schema, table_name`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: safeError(err) }, null, 2) }],
        isError: true,
      };
    } finally {
      client.release();
    }
  }
);

// Tool: describe a table's columns
server.tool(
  "describe_table",
  "Describe the columns of a table",
  {
    table_name: z.string().max(128).describe("Table name"),
    schema: z.string().max(128).optional().describe("Schema name (default: public)"),
  },
  async ({ table_name, schema = "public" }) => {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [schema, table_name]
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: safeError(err) }, null, 2) }],
        isError: true,
      };
    } finally {
      client.release();
    }
  }
);

// ── Startup ───────────────────────────────────────────────────────────────────
async function main() {
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    console.error("PostgreSQL connection established.");
  } catch (err) {
    console.error("Failed to connect to PostgreSQL:", err.message);
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP server running on stdio.");
}

main();
