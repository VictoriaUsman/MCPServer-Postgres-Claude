# PostgreSQL MCP Server

Connect Claude to your PostgreSQL database and query it using plain English — via Claude.ai in the browser or Claude Desktop.

---

## How It Works

```
Claude (browser or desktop) → MCP Server (Railway) → PostgreSQL (Railway)
```

The MCP server runs on Railway and is accessed over HTTPS. Anyone with the secret URL can connect — no local setup required beyond Claude.

---

## Deploy to Railway

### 1. Push this repo to GitHub

### 2. Add as a new service in your existing Railway project

- Open your Railway project → **New Service** → **GitHub Repo**
- Select this repository
- Under **Settings → Root Directory**, set it to `/my-mcp-server`

### 3. Set environment variables

In the service **Variables** tab, add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://postgres:PASSWORD@postgres.railway.internal:5432/railway` |
| `AUTH_TOKEN` | A strong secret (generate: `node -e "require('crypto').randomBytes(32).toString('hex').replace(/^/, s => console.log(s))"`) |

> Use the **internal** Railway URL for `DATABASE_URL` — both services share Railway's private network, so no public proxy needed.

### 4. Get your public URL

Railway → your service → **Settings → Networking → Generate Domain**

Your MCP URL will be:
```
https://YOUR-APP.up.railway.app/mcp/YOUR_AUTH_TOKEN
```

---

## Connect Claude.ai (Browser)

1. Go to [claude.ai](https://claude.ai) → profile → **Settings**
2. Click **Customize** → **Add custom connector**
3. Fill in:
   - **Name:** `postgres`
   - **URL:** `https://YOUR-APP.up.railway.app/mcp/YOUR_AUTH_TOKEN`
4. Leave OAuth fields empty
5. Save — the hammer icon (🔨) will appear in new chats

---

## Connect Claude Desktop

Open your Claude Desktop config file:

**Windows (Store app):**
```
C:\Users\YOUR_USERNAME\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json
```

**Mac:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

Merge this into the file:

```json
{
  "mcpServers": {
    "postgres": {
      "type": "sse",
      "url": "https://YOUR-APP.up.railway.app/mcp/YOUR_AUTH_TOKEN",
      "headers": {}
    }
  }
}
```

Fully quit Claude Desktop and reopen it.

---

## Usage

Ask Claude naturally in any chat:

- *"List all tables in my database"*
- *"Describe the users table"*
- *"Show me the last 10 orders"*
- *"How many rows are in each table?"*

---

## Available Tools

| Tool | Description |
|------|-------------|
| `list_tables` | Lists all tables in the database |
| `describe_table` | Shows columns and data types for a table |
| `query` | Runs a SQL query and returns results |

---

## Security

- Access is protected via a secret token embedded in the URL
- Destructive operations are blocked: `DROP`, `TRUNCATE`, `ALTER`, `CREATE`, `GRANT`, `REVOKE`, `COPY`
- `DELETE` without a `WHERE` clause is blocked
- Queries auto-cancelled after 10 seconds
- Error messages are sanitised — internal details never exposed
- Max 5 concurrent database connections
- HTTPS enforced via Railway
- `.env` is gitignored — secrets never committed to source control

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AUTH_TOKEN` | Yes | Secret token — also used as the URL path |
| `PORT` | No | HTTP port (Railway sets this automatically) |

---

## Troubleshooting

**"Error connecting to MCP server" on Claude.ai**
→ Make sure the full URL includes the token: `.../mcp/YOUR_AUTH_TOKEN`

**Hammer icon not showing in Claude Desktop**
→ Fully quit (not just close) and reopen Claude Desktop.

**DB connection error on Railway**
→ Use the internal hostname (`postgres.railway.internal`), not the public proxy URL.

**Build failed on Railway**
→ Make sure Root Directory is set to `/my-mcp-server` in service Settings.

By: Ian Tristan Cultura