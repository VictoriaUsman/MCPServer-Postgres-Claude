# PostgreSQL MCP Server for Claude Desktop

Connect Claude Desktop to your PostgreSQL database and query it using plain English.

---

## How It Works

```
Claude Desktop → MCP Server (Railway) → PostgreSQL (Railway)
```

The MCP server runs on Railway and is accessed over HTTPS. Anyone with the URL and auth token can connect — no local setup required beyond Claude Desktop.

---

## Deploy to Railway

### 1. Push this repo to GitHub

### 2. Create a new Railway service

- Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
- Select this repository

### 3. Set environment variables in Railway

In your Railway service → **Variables** tab, add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your PostgreSQL internal URL (e.g. `postgresql://postgres:PASSWORD@postgres.railway.internal:5432/railway`) |
| `AUTH_TOKEN` | A strong secret token (generate one with `openssl rand -hex 32`) |

> Use the **internal** Railway URL for DATABASE_URL — both services are on the same private network.

### 4. Get your deployment URL

Once deployed, Railway gives you a public URL like:
```
https://my-mcp-server-production.up.railway.app
```

---

## Connect Claude Desktop

Open your Claude Desktop config file:

**Windows:**
```
C:\Users\YOUR_USERNAME\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json
```

**Mac:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

Add the `mcpServers` block:

```json
{
  "mcpServers": {
    "postgres": {
      "url": "https://YOUR-APP.up.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_AUTH_TOKEN"
      }
    }
  }
}
```

Fully quit Claude Desktop and reopen it. Look for the **hammer icon (🔨)** in the chat input — that confirms it's connected.

---

## Usage

Ask Claude naturally:

- *"List all tables in my database"*
- *"Describe the users table"*
- *"Show me the last 10 orders"*
- *"How many rows are in each table?"*

---

## Available Tools

| Tool | Description |
|------|-------------|
| `list_tables` | Lists all tables in the database |
| `describe_table` | Shows columns and types for a table |
| `query` | Runs a SQL query and returns results |

---

## Security

- All requests require a Bearer token (`AUTH_TOKEN`)
- Destructive operations blocked: `DROP`, `TRUNCATE`, `ALTER`, `CREATE`, `GRANT`, `REVOKE`, `COPY`
- `DELETE` without a `WHERE` clause is blocked
- Queries auto-cancelled after 10 seconds
- Error messages sanitised — internal details never exposed
- Max 5 concurrent database connections
- HTTPS enforced via Railway

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AUTH_TOKEN` | Yes | Secret token for API authentication |
| `PORT` | No | HTTP port (Railway sets this automatically) |

---

## Troubleshooting

**Hammer icon not showing in Claude Desktop**
→ Fully quit (not just close) Claude Desktop and reopen it.

**401 Unauthorized**
→ Check that the `AUTH_TOKEN` in your config matches the one set in Railway variables.

**Connection refused / timeout**
→ Check that the Railway service is running and the URL is correct.

**DB connection error on Railway**
→ Make sure `DATABASE_URL` uses the internal Railway hostname (`postgres.railway.internal`), not the public proxy URL.
