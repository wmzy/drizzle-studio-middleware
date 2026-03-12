import { createHash } from 'crypto'
import type { Hono } from 'hono'
import { createStudioApp, getCustomDefaults } from './studio'
import { createPostgresProxy, createMysqlProxy } from './connections'
import type { Setup, StudioMiddlewareOptions, Proxy, TransactionProxy } from './types'

export type { Setup, StudioMiddlewareOptions, ProxyParams, Proxy, TransactionProxy, CasingType, CustomDefault, SchemaFile } from './types'
export { createStudioApp } from './studio'
export { createPostgresProxy, createMysqlProxy } from './connections'

/**
 * High-level API: create a Studio Hono app from connection URL and schema.
 * Automatically detects installed database driver and creates proxy functions.
 */
export async function createStudioMiddleware(options: StudioMiddlewareOptions): Promise<Hono> {
  const { dialect, dbUrl, schema, relations = {}, casing, schemaFiles } = options

  let proxy: Proxy
  let transactionProxy: TransactionProxy
  let packageName: string

  if (dialect === 'postgresql') {
    const conn = await createPostgresProxy(dbUrl)
    proxy = conn.proxy
    transactionProxy = conn.transactionProxy
    packageName = conn.packageName
  } else if (dialect === 'mysql') {
    const conn = await createMysqlProxy(dbUrl)
    proxy = conn.proxy
    transactionProxy = conn.transactionProxy
    packageName = conn.packageName
  } else {
    throw new Error(`Dialect "${dialect}" is not yet supported by createStudioMiddleware. Use createStudioApp with a custom proxy instead.`)
  }

  const dbHash = createHash('sha256').update(dbUrl).digest('hex')
  const customDefaults = getCustomDefaults(schema, casing)

  const setup: Setup = {
    dbHash,
    dialect,
    packageName,
    proxy,
    transactionProxy,
    customDefaults,
    schema,
    relations,
    casing,
    schemaFiles,
  }

  return createStudioApp(setup)
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
