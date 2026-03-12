import { describe, it, expect, vi } from 'vitest'
import { pgTable, text, integer, uuid } from 'drizzle-orm/pg-core'
import { createStudioApp } from '../src/studio'
import type { Setup } from '../src/types'

const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  age: integer('age'),
})

function createMockSetup(overrides?: Partial<Setup>): Setup {
  return {
    dbHash: 'test-hash-abc123',
    dialect: 'postgresql',
    packageName: 'postgres',
    proxy: vi.fn(async () => []),
    transactionProxy: vi.fn(async () => []),
    customDefaults: [],
    schema: { public: { users } },
    relations: {},
    ...overrides,
  }
}

describe('createStudioApp', () => {
  it('should return a Hono app', () => {
    const app = createStudioApp(createMockSetup())
    expect(app).toBeDefined()
    expect(app.fetch).toBeTypeOf('function')
  })

  describe('POST / with type=init', () => {
    it('should return schema metadata', async () => {
      const app = createStudioApp(createMockSetup())

      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'init' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.version).toBe('6.2')
      expect(body.dialect).toBe('postgresql')
      expect(body.packageName).toBe('postgres')
      expect(body.dbHash).toBe('test-hash-abc123')
      expect(body.customDefaults).toBeInstanceOf(Array)
      expect(body.relations).toBeInstanceOf(Array)
    })

    it('should include custom defaults metadata', async () => {
      const app = createStudioApp(
        createMockSetup({
          customDefaults: [
            { schema: 'public', table: 'users', column: 'id', func: () => 'uuid-value' },
          ],
        }),
      )

      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'init' }),
      })

      const body = await res.json()
      expect(body.customDefaults).toEqual([
        { schema: 'public', table: 'users', column: 'id' },
      ])
    })
  })

  describe('POST / with type=proxy', () => {
    it('should call proxy and return result', async () => {
      const mockProxy = vi.fn(async () => [{ id: '1', name: 'Alice' }])
      const app = createStudioApp(createMockSetup({ proxy: mockProxy }))

      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'proxy',
          data: {
            sql: 'SELECT * FROM users',
            params: [],
            mode: 'object',
            method: 'all',
          },
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual([{ id: '1', name: 'Alice' }])
      expect(mockProxy).toHaveBeenCalledWith({
        sql: 'SELECT * FROM users',
        params: [],
        mode: 'object',
        method: 'all',
      })
    })

    it('should handle BigInt in response', async () => {
      const mockProxy = vi.fn(async () => [{ count: BigInt(42) }])
      const app = createStudioApp(createMockSetup({ proxy: mockProxy }))

      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'proxy',
          data: { sql: 'SELECT count(*)', params: [], mode: 'object', method: 'all' },
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual([{ count: '42' }])
    })

    it('should handle Error in response', async () => {
      const mockProxy = vi.fn(async () => [new Error('query failed')])
      const app = createStudioApp(createMockSetup({ proxy: mockProxy }))

      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'proxy',
          data: { sql: 'BAD SQL', params: [], mode: 'object', method: 'all' },
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual([{ error: 'query failed' }])
    })
  })

  describe('POST / with type=tproxy', () => {
    it('should call transactionProxy and return result', async () => {
      const mockTProxy = vi.fn(async () => [[{ id: '1' }], [{ id: '2' }]])
      const app = createStudioApp(createMockSetup({ transactionProxy: mockTProxy }))

      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'tproxy',
          data: [
            { sql: 'INSERT INTO users (name) VALUES ($1)' },
            { sql: 'SELECT * FROM users' },
          ],
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual([[{ id: '1' }], [{ id: '2' }]])
      expect(mockTProxy).toHaveBeenCalledWith([
        { sql: 'INSERT INTO users (name) VALUES ($1)' },
        { sql: 'SELECT * FROM users' },
      ])
    })
  })

  describe('POST / with type=defaults', () => {
    it('should return custom default values', async () => {
      const app = createStudioApp(
        createMockSetup({
          customDefaults: [
            { schema: 'public', table: 'users', column: 'id', func: () => 'generated-uuid' },
          ],
        }),
      )

      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'defaults',
          data: [{ schema: 'public', table: 'users', column: 'id' }],
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual([
        { schema: 'public', table: 'users', column: 'id', value: 'generated-uuid' },
      ])
    })

    it('should throw for unknown custom default', async () => {
      const app = createStudioApp(createMockSetup())

      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'defaults',
          data: [{ schema: 'public', table: 'users', column: 'nonexistent' }],
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('error')
      expect(body.error).toContain('Custom default not found')
    })
  })

  describe('request validation', () => {
    it('should reject invalid request body', async () => {
      const app = createStudioApp(createMockSetup())

      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'invalid' }),
      })

      expect(res.status).toBe(400)
    })

    it('should reject GET requests', async () => {
      const app = createStudioApp(createMockSetup())

      const res = await app.request('/', { method: 'GET' })
      expect(res.status).toBe(404)
    })
  })

  describe('CORS headers', () => {
    it('should include Access-Control-Allow-Private-Network header', async () => {
      const app = createStudioApp(createMockSetup())

      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'init' }),
      })

      expect(res.headers.get('Access-Control-Allow-Private-Network')).toBe('true')
    })
  })
})
