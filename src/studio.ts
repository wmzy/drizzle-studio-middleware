import { AnyColumn, AnyTable, is } from 'drizzle-orm'
import { AnyMySqlTable, getTableConfig as mysqlTableConfig, MySqlTable } from 'drizzle-orm/mysql-core'
import { AnyPgTable, getTableConfig as pgTableConfig, PgTable } from 'drizzle-orm/pg-core'
import {
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
  Many,
  normalizeRelation,
  One,
  Relations,
  type TablesRelationalConfig,
} from 'drizzle-orm/relations'
import {
  AnySingleStoreTable,
  getTableConfig as singlestoreTableConfig,
  SingleStoreTable,
} from 'drizzle-orm/singlestore-core'
import { AnySQLiteTable, getTableConfig as sqliteTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { toCamelCase, toSnakeCase } from 'drizzle-orm/casing'
import { Hono } from 'hono'
import { compress } from 'hono/compress'
import { cors } from 'hono/cors'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { CasingType, CustomDefault, Setup } from './types'

// --- Helpers extracted from drizzle-kit ---

function getColumnCasing(
  column: { keyAsName: boolean; name: string | undefined },
  casing: CasingType | undefined,
): string {
  if (!column.name) return ''
  return !column.keyAsName || casing === undefined
    ? column.name
    : casing === 'camelCase'
      ? toCamelCase(column.name)
      : toSnakeCase(column.name)
}

type Relation = {
  name: string
  type: 'one' | 'many'
  table: string
  schema: string
  columns: string[]
  refTable: string
  refSchema: string
  refColumns: string[]
}

function extractRelations(
  tablesConfig: {
    tables: TablesRelationalConfig
    tableNamesMap: Record<string, string>
  },
  casing?: CasingType,
): Relation[] {
  return Object.values(tablesConfig.tables)
    .map((it) =>
      Object.entries(it.relations).map(([name, relation]) => {
        try {
          const normalized = normalizeRelation(
            tablesConfig.tables,
            tablesConfig.tableNamesMap,
            relation,
          )
          const rel = relation
          const refTable = rel.referencedTable
          const fields = normalized.fields
            .map((it) => getColumnCasing(it, casing))
            .flat()
          const refColumns = normalized.references
            .map((it) => getColumnCasing(it, casing))
            .flat()

          let refSchema: string | undefined
          if (is(refTable, PgTable)) {
            refSchema = pgTableConfig(refTable).schema
          } else if (is(refTable, MySqlTable)) {
            refSchema = mysqlTableConfig(refTable).schema
          } else if (is(refTable, SQLiteTable)) {
            refSchema = undefined
          } else if (is(refTable, SingleStoreTable)) {
            refSchema = singlestoreTableConfig(refTable).schema
          } else {
            throw new Error('unsupported dialect')
          }

          let type: 'one' | 'many'
          if (is(rel, One)) {
            type = 'one'
          } else if (is(rel, Many)) {
            type = 'many'
          } else {
            throw new Error('unsupported relation type')
          }

          return {
            name,
            type,
            table: it.dbName,
            schema: it.schema || 'public',
            columns: fields,
            refTable: rel.referencedTableName,
            refSchema: refSchema || 'public',
            refColumns,
          }
        } catch (error) {
          throw new Error(
            `Invalid relation "${relation.fieldName}" for table "${it.schema ? `${it.schema}.${it.dbName}` : it.dbName}"`,
          )
        }
      }),
    )
    .flat()
}

export function getCustomDefaults<T extends AnyTable<{}>>(
  schema: Record<string, Record<string, T>>,
  casing?: CasingType,
): CustomDefault[] {
  const customDefaults: CustomDefault[] = []

  Object.entries(schema).map(([schemaName, tables]) => {
    Object.entries(tables).map(([, table]) => {
      let tableConfig: { name: string; columns: AnyColumn[] }
      if (is(table, PgTable)) {
        tableConfig = pgTableConfig(table)
      } else if (is(table, MySqlTable)) {
        tableConfig = mysqlTableConfig(table)
      } else if (is(table, SQLiteTable)) {
        tableConfig = sqliteTableConfig(table)
      } else {
        tableConfig = singlestoreTableConfig(table as SingleStoreTable)
      }

      tableConfig.columns.map((column) => {
        if (column.defaultFn) {
          customDefaults.push({
            schema: schemaName,
            table: tableConfig.name,
            column: getColumnCasing(column, casing),
            func: column.defaultFn,
          })
        }
      })
    })
  })

  return customDefaults
}

// --- Zod schemas for request validation ---

const initSchema = z.object({ type: z.literal('init') })

const proxySchema = z.object({
  type: z.literal('proxy'),
  data: z.object({
    sql: z.string(),
    params: z.array(z.any()).optional(),
    typings: z.string().array().optional(),
    mode: z.enum(['array', 'object']).default('object'),
    method: z.union([
      z.literal('values'),
      z.literal('get'),
      z.literal('all'),
      z.literal('run'),
      z.literal('execute'),
    ]),
  }),
})

const transactionProxySchema = z.object({
  type: z.literal('tproxy'),
  data: z
    .object({
      sql: z.string(),
      method: z
        .union([
          z.literal('values'),
          z.literal('get'),
          z.literal('all'),
          z.literal('run'),
          z.literal('execute'),
        ])
        .optional(),
    })
    .array(),
})

const defaultsSchema = z.object({
  type: z.literal('defaults'),
  data: z
    .array(
      z.object({
        schema: z.string(),
        table: z.string(),
        column: z.string(),
      }),
    )
    .min(1),
})

const requestSchema = z.union([initSchema, proxySchema, transactionProxySchema, defaultsSchema])

// --- JSON serializer ---

function jsonStringify(data: any): string {
  return JSON.stringify(data, (_key, value) => {
    if (value instanceof Error) {
      return { error: value.message }
    }
    if (typeof value === 'bigint') {
      return value.toString()
    }
    if (
      (value && typeof value === 'object' && 'type' in value && 'data' in value && value.type === 'Buffer')
      || value instanceof ArrayBuffer
      || (typeof Buffer !== 'undefined' && value instanceof Buffer)
    ) {
      return Buffer.from(value).toString('base64')
    }
    return value
  })
}

// --- Main API ---

export function createStudioApp(setup: Setup): Hono {
  const {
    dialect,
    driver,
    packageName,
    databaseName,
    proxy,
    transactionProxy,
    customDefaults,
    schema: drizzleSchema,
    relations,
    dbHash,
    casing,
    schemaFiles,
  } = setup

  const app = new Hono()

  app.use(compress())
  app.use(async (ctx, next) => {
    await next()
    ctx.header('Access-Control-Allow-Private-Network', 'true')
  })
  app.use(cors())
  app.onError((err, ctx) => {
    console.error(err)
    return ctx.json({ status: 'error', error: err.message })
  })

  const relationalSchema: Record<string, unknown> = {
    ...Object.fromEntries(
      Object.entries(drizzleSchema)
        .map(([schemaName, schema]) => {
          return Object.entries(schema).map(([tableName, table]) => {
            return [`__${schemaName}__.${tableName}`, table]
          })
        })
        .flat(),
    ),
    ...relations,
  }

  const relationsConfig = extractTablesRelationalConfig(
    relationalSchema,
    createTableRelationsHelpers,
  )

  app.post('/', zValidator('json', requestSchema), async (c) => {
    const body = c.req.valid('json')
    const { type } = body

    if (type === 'init') {
      const preparedDefaults = customDefaults.map((d) => ({
        schema: d.schema,
        table: d.table,
        column: d.column,
      }))

      let extractedRelations: Relation[] = []
      try {
        extractedRelations = extractRelations(relationsConfig, casing)
      } catch (error) {
        console.warn('Failed to extract relations:', (error as Error).message)
      }

      return c.json({
        version: '6.2',
        dialect,
        driver,
        packageName,
        schemaFiles,
        customDefaults: preparedDefaults,
        relations: extractedRelations,
        dbHash,
        databaseName,
      })
    }

    if (type === 'proxy') {
      const result = await proxy({
        ...body.data,
        params: body.data.params || [],
      })
      return c.json(JSON.parse(jsonStringify(result)))
    }

    if (type === 'tproxy') {
      const result = await transactionProxy(body.data)
      return c.json(JSON.parse(jsonStringify(result)))
    }

    if (type === 'defaults') {
      const columns = body.data
      const result = columns.map((column) => {
        const found = customDefaults.find(
          (d) => d.schema === column.schema && d.table === column.table && d.column === column.column,
        )
        if (!found) {
          throw new Error(`Custom default not found for ${column.schema}.${column.table}.${column.column}`)
        }
        return { ...column, value: found.func() }
      })
      return c.json(JSON.parse(jsonStringify(result)))
    }

    throw new Error(`Unknown type: ${type}`)
  })

  return app
}
