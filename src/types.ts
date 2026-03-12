import type { AnyTable, Relations } from 'drizzle-orm'

export type CasingType = 'snake_case' | 'camelCase'

export type ProxyParams = {
  sql: string
  params?: any[]
  typings?: any[]
  mode: 'array' | 'object'
  method: 'values' | 'get' | 'all' | 'run' | 'execute'
}

export type Proxy = (params: ProxyParams) => Promise<any[]>

export type TransactionProxy = (
  queries: { sql: string; method?: ProxyParams['method'] }[],
) => Promise<any[]>

export type CustomDefault = {
  schema: string
  table: string
  column: string
  func: () => unknown
}

export type SchemaFile = {
  name: string
  content: string
}

export type Setup = {
  dbHash: string
  dialect: 'postgresql' | 'mysql' | 'sqlite' | 'singlestore'
  packageName: string
  driver?: 'aws-data-api' | 'd1-http' | 'd1' | 'turso' | 'pglite'
  databaseName?: string
  proxy: Proxy
  transactionProxy: TransactionProxy
  customDefaults: CustomDefault[]
  schema: Record<string, Record<string, AnyTable<{}>>>
  relations: Record<string, Relations>
  casing?: CasingType
  schemaFiles?: SchemaFile[]
}

export type StudioMiddlewareOptions = {
  dialect: 'postgresql' | 'mysql' | 'sqlite' | 'singlestore'
  dbUrl: string
  schema: Record<string, Record<string, AnyTable<{}>>>
  relations?: Record<string, Relations>
  casing?: CasingType
  schemaFiles?: SchemaFile[]
}
