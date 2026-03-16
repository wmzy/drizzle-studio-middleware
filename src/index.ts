import { createHash } from 'crypto'
import type { Hono } from 'hono'
import { createStudioApp, getCustomDefaults } from './studio'
import { createPostgresProxy, createMysqlProxy, type ConnectionResult } from './connections'
import type { Setup, StudioMiddlewareOptions } from './types'

export type { Setup, StudioMiddlewareOptions, ProxyParams, Proxy, TransactionProxy, CasingType, CustomDefault, SchemaFile } from './types'
export { createStudioApp } from './studio'
export { createPostgresProxy, createMysqlProxy } from './connections'

/**
 * High-level API: create a Studio Hono app from connection URL and schema.
 * Automatically detects installed database driver and creates proxy functions.
 */
async function createConnectionProxy(dialect: string, dbUrl: string) {
  const creators: Record<string, (url: string) => Promise<ConnectionResult>> = {
    postgresql: createPostgresProxy,
    mysql: createMysqlProxy,
  }
  const create = creators[dialect]
  if (!create) {
    throw new Error(`Dialect "${dialect}" is not yet supported by createStudioMiddleware. Use createStudioApp with a custom proxy instead.`)
  }
  return create(dbUrl)
}

export async function createStudioMiddleware(options: StudioMiddlewareOptions): Promise<Hono> {
  const { dialect, dbUrl, schema, relations = {}, casing, schemaFiles } = options
  const { proxy, transactionProxy, packageName } = await createConnectionProxy(dialect, dbUrl)

  return createStudioApp({
    dbHash: createHash('sha256').update(dbUrl).digest('hex'),
    dialect,
    packageName,
    proxy,
    transactionProxy,
    customDefaults: getCustomDefaults(schema, casing),
    schema,
    relations,
    casing,
    schemaFiles,
  })
}

/**
 * Get the Drizzle Studio URL for a given host and port.
 */
export function getStudioUrl(host = '127.0.0.1', port = 4983): string {
  const params = new URLSearchParams()
  if (port !== 4983) params.set('port', String(port))
  if (host !== '127.0.0.1') params.set('host', host)
  const qs = params.toString()
  return `https://local.drizzle.studio${qs ? `?${qs}` : ''}`
}
