# AGENTS.md

## Project Overview

`drizzle-studio-middleware` is a standalone package that extracts the Drizzle Studio backend from `drizzle-kit` and exposes it as a mountable Hono app. It allows embedding the Drizzle Studio database browser into any Node.js web application without running a separate `drizzle-kit studio` process.

## Architecture

```
src/
├── types.ts         # Shared type definitions (Setup, ProxyParams, Proxy, etc.)
├── studio.ts        # Core: createStudioApp() returns a Hono app with POST / endpoint
├── connections.ts   # Database driver detection and proxy creation (postgres, pg, mysql2)
└── index.ts         # Public API: createStudioMiddleware(), getStudioUrl(), re-exports
```

### Key Concepts

- **Setup**: The configuration object containing dialect, proxy functions, schema, and relations. This is what `createStudioApp` consumes.
- **Proxy / TransactionProxy**: Functions that execute SQL against the database. The user can provide their own or use the auto-detected ones from `connections.ts`.
- **Hono App**: The middleware returns a standard Hono app instance that handles the Drizzle Studio protocol (init, proxy, tproxy, defaults).

### How Drizzle Studio Frontend Connects

The frontend at `https://local.drizzle.studio` sends POST requests to `http(s)://host:port/` with JSON bodies. It uses `?port=&host=` URL parameters to know where the backend is. The frontend does NOT support custom base paths — the API must be at the root of a dedicated port.

## Development

```bash
pnpm install
npm run build        # Build with tsup (ESM + CJS + DTS)
npm run test         # Run vitest
npm run test:watch   # Watch mode
npm run typecheck    # TypeScript check
```

## Testing

Tests use **vitest** and are in the `test/` directory. Tests for `createStudioApp` use Hono's built-in `app.request()` for HTTP-level testing without starting a real server.

Key test files:
- `test/studio.test.ts` — Tests for the Hono app (init, proxy, tproxy, defaults, CORS, validation)
- `test/index.test.ts` — Tests for `getStudioUrl`
- `test/custom-defaults.test.ts` — Tests for `getCustomDefaults`

## Code Style

- Use `type` instead of `interface` and `enum`
- Avoid `let` — prefer `const` with immediate expressions
- Avoid `class` and OOP patterns
- Minimize conditional branches; use helper functions
- No unnecessary comments

## Dependencies

- `hono` and `drizzle-orm` are **peer dependencies** — the user provides them
- Database drivers (`postgres`, `pg`, `mysql2`) are **optional runtime dependencies** — detected via dynamic `import()`
- `@hono/zod-validator` and `zod` are direct dependencies for request validation
