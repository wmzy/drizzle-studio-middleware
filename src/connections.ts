import type { Proxy, ProxyParams, TransactionProxy } from './types'

type ConnectionResult = {
  packageName: string
  proxy: Proxy
  transactionProxy: TransactionProxy
}

async function tryImport(name: string): Promise<any | null> {
  try {
    return await import(name)
  } catch {
    return null
  }
}

export async function createPostgresProxy(url: string): Promise<ConnectionResult> {
  const postgresModule = await tryImport('postgres')
  if (postgresModule) {
    const client = postgresModule.default(url, { max: 1 })

    const transparentParser = (val: any) => val
    for (const type of ['1184', '1082', '1083', '1114']) {
      client.options.parsers[type] = transparentParser
      client.options.serializers[type] = transparentParser
    }
    client.options.serializers['114'] = transparentParser
    client.options.serializers['3802'] = transparentParser

    const proxy: Proxy = async (params: ProxyParams) => {
      if (params.mode === 'array') {
        return await client.unsafe(params.sql, params.params).values()
      }
      return await client.unsafe(params.sql, params.params)
    }

    const transactionProxy: TransactionProxy = async (queries) => {
      const results: any[] = []
      try {
        await client.begin(async (sql: any) => {
          for (const query of queries) {
            const result = await sql.unsafe(query.sql)
            results.push(result)
          }
        })
      } catch (error) {
        results.push(error as Error)
      }
      return results
    }

    return { packageName: 'postgres', proxy, transactionProxy }
  }

  const pgModule = await tryImport('pg')
  if (pgModule) {
    const pg = pgModule.default

    const builtins = pg.types?.builtins ?? {}
    const pgGetTypeParser = pg.types?.getTypeParser
    const types = pgGetTypeParser
      ? {
          getTypeParser: (typeId: number, format?: string) => {
            if (
              typeId === builtins.TIMESTAMPTZ
              || typeId === builtins.TIMESTAMP
              || typeId === builtins.DATE
              || typeId === builtins.INTERVAL
            ) {
              return (val: any) => val
            }
            return pgGetTypeParser(typeId, format)
          },
        }
      : undefined

    const client = new pg.Pool({ connectionString: url, max: 1 })

    const proxy: Proxy = async (params: ProxyParams) => {
      const result = await client.query({
        text: params.sql,
        values: params.params,
        ...(params.mode === 'array' && { rowMode: 'array' }),
        ...(types && { types }),
      })
      return result.rows
    }

    const transactionProxy: TransactionProxy = async (queries) => {
      const results: any[] = []
      const tx = await client.connect()
      try {
        await tx.query('BEGIN')
        for (const query of queries) {
          const result = await tx.query({ text: query.sql, ...(types && { types }) })
          results.push(result.rows)
        }
        await tx.query('COMMIT')
      } catch (error) {
        await tx.query('ROLLBACK')
        results.push(error as Error)
      } finally {
        tx.release()
      }
      return results
    }

    return { packageName: 'pg', proxy, transactionProxy }
  }

  throw new Error(
    "No PostgreSQL driver found. Please install either 'postgres' or 'pg'.",
  )
}

export async function createMysqlProxy(url: string): Promise<ConnectionResult> {
  const mysql2Module = await tryImport('mysql2/promise')
  if (mysql2Module) {
    const connection = await mysql2Module.createConnection(url)
    await connection.connect()

    const typeCast = (field: any, next: any) => {
      if (field.type === 'TIMESTAMP' || field.type === 'DATETIME' || field.type === 'DATE') {
        return field.string()
      }
      return next()
    }

    const proxy: Proxy = async (params: ProxyParams) => {
      const result = await connection.query({
        sql: params.sql,
        values: params.params,
        rowsAsArray: params.mode === 'array',
        typeCast,
      })
      return result[0] as any[]
    }

    const transactionProxy: TransactionProxy = async (queries) => {
      const results: any[] = []
      try {
        await connection.beginTransaction()
        for (const query of queries) {
          const res = await connection.query(query.sql)
          results.push(res[0])
        }
        await connection.commit()
      } catch (error) {
        await connection.rollback()
        results.push(error as Error)
      }
      return results
    }

    return { packageName: 'mysql2', proxy, transactionProxy }
  }

  throw new Error("No MySQL driver found. Please install 'mysql2'.")
}
