const express = require("express");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { Pool } = require("pg");
const { z } = require("zod");
const { randomUUID } = require("node:crypto");

// ── Validate required environment variables ──────────────────────────────────
if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const AUTH_TOKEN = process.env.AUTH_TOKEN;
if (!AUTH_TOKEN) {
  console.error("ERROR: AUTH_TOKEN environment variable is not set.");
  process.exit(1);
}

// ── Blocked SQL patterns ──────────────────────────────────────────────────────
const BLOCKED_PATTERNS = [
  /\bDROP\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\b(?!.*\bWHERE\b)/i,
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
  return !BLOCKED_PATTERNS.some((p) => p.test(sql));
}

// ── PostgreSQL connection pool ────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
});

pool.on("error", (err) => console.error("DB pool error:", err.message));

function safeError(err) {
  const out = {};
  for (const key of ["message", "code", "detail", "hint", "position"]) {
    if (err[key]) out[key] = err[key];
  }
  return out;
}

// ── MCP server factory (one per HTTP session) ─────────────────────────────────
function createMcpServer() {
  const server = new McpServer({ name: "postgres-mcp-server", version: "1.0.0" });

  server.tool(
    "query",
    "Run a SQL query. Destructive DDL (DROP, TRUNCATE, ALTER, etc.) is blocked.",
    { sql: z.string().max(10000).describe("SQL query to execute") },
    async ({ sql }) => {
      if (!isSafeQuery(sql)) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "Query blocked: destructive statements are not permitted." }) }],
          isError: true,
        };
      }
      const client = await pool.connect();
      try {
        const result = await client.query(sql);
        return {
          content: [{ type: "text", text: JSON.stringify({ rows: result.rows, rowCount: result.rowCount }, null, 2) }],
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

  server.tool("list_tables", "List all user tables in the database", {}, async () => {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT table_schema, table_name
         FROM information_schema.tables
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
         ORDER BY table_schema, table_name`
      );
      return { content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: safeError(err) }, null, 2) }],
        isError: true,
      };
    } finally {
      client.release();
    }
  });

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
        return { content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }] };
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

  return server;
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Auth middleware
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${AUTH_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Health check (no auth — used by Railway)
app.get("/health", (req, res) => res.json({ status: "ok" }));

// MCP endpoint
const sessions = new Map();

app.all("/mcp", requireAuth, async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"];

    if (req.method === "POST" && !sessionId) {
      // New session
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => sessions.set(id, transport),
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      const server = createMcpServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } else if (sessionId && sessions.has(sessionId)) {
      await sessions.get(sessionId).handleRequest(req, res, req.body);
    } else {
      res.status(404).json({ error: "Session not found" });
    }
  } catch (err) {
    console.error("MCP request error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function main() {
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    console.log("PostgreSQL connection established.");
  } catch (err) {
    console.error("Failed to connect to PostgreSQL:", err.message);
    process.exit(1);
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`MCP server listening on port ${PORT}`));
}

main();
