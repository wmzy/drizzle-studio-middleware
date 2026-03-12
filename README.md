# drizzle-studio-middleware

Mount [Drizzle Studio](https://orm.drizzle.team/drizzle-studio/overview) as middleware in your Hono app. No need to run a separate `drizzle-kit studio` process.

> **Note:** The Drizzle Studio frontend is hosted at `https://local.drizzle.studio` and is not open source. This package only provides the backend API that the frontend connects to.

## Install

```bash
pnpm add drizzle-studio-middleware
```

Peer dependencies: `hono` (>=4), `drizzle-orm` (>=0.30)

## Quick Start (High-level API)

```typescript
import { serve } from '@hono/node-server'
import { createStudioMiddleware, getStudioUrl } from 'drizzle-studio-middleware'
import * as schema from './db/schema'

const studioApp = await createStudioMiddleware({
  dialect: 'postgresql',
  dbUrl: process.env.DATABASE_URL!,
  schema: { public: schema },
  casing: 'snake_case',
})

// Studio frontend requires the API at the root path of a host:port,
// so run it on a dedicated port.
serve({ fetch: studioApp.fetch, port: 4983 }, () => {
  console.log(`Drizzle Studio: ${getStudioUrl('127.0.0.1', 4983)}`)
})
```

## Low-level API (Custom Proxy)

If you need full control over how queries are executed:

```typescript
import { createHash } from 'crypto'
import { createStudioApp } from 'drizzle-studio-middleware'
import type { ProxyParams } from 'drizzle-studio-middleware'
import * as schema from './db/schema'

const studioApp = createStudioApp({
  dbHash: createHash('sha256').update(dbUrl).digest('hex'),
  dialect: 'postgresql',
  packageName: 'postgres',
  proxy: async (params: ProxyParams) => {
    // Execute SQL using your own database client
    return await db.unsafe(params.sql, params.params)
  },
  transactionProxy: async (queries) => {
    const results: any[] = []
    await db.begin(async (sql) => {
      for (const q of queries) {
        results.push(await sql.unsafe(q.sql))
      }
    })
    return results
  },
  customDefaults: [],
  schema: { public: schema },
  relations: {},
})
```

## Usage with Existing Hono App

The Drizzle Studio frontend (`local.drizzle.studio`) sends requests to the **root path** of a given `host:port`. It does not support custom base paths like `/studio`. Therefore, the Studio API must run on its own port:

```typescript
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createStudioMiddleware, getStudioUrl } from 'drizzle-studio-middleware'
import * as schema from './db/schema'

// Your main app
const app = new Hono()
app.get('/health', (c) => c.json({ ok: true }))

serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log('App running on http://localhost:3000')
})

// Studio on a separate port
const studioApp = await createStudioMiddleware({
  dialect: 'postgresql',
  dbUrl: process.env.DATABASE_URL!,
  schema: { public: schema },
})

serve({ fetch: studioApp.fetch, port: 4983 }, () => {
  console.log(`Studio: ${getStudioUrl()}`)
})
```

## Supported Databases

| Dialect      | Drivers                    |
| ------------ | -------------------------- |
| `postgresql` | `postgres`, `pg`           |
| `mysql`      | `mysql2`                   |
| `sqlite`     | Use low-level API          |

## How It Works

1. This package extracts the Drizzle Studio backend logic from `drizzle-kit`
2. It creates a Hono app with a single `POST /` endpoint that handles:
   - `init` — returns schema metadata, relations, dialect info
   - `proxy` — executes a single SQL query
   - `tproxy` — executes a transaction (multiple queries)
   - `defaults` — returns custom default values for columns
3. The `local.drizzle.studio` frontend connects to this API via `?port=&host=` URL parameters

## License

MIT
