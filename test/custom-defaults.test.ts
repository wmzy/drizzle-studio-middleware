import { describe, it, expect } from 'vitest'
import { pgTable, text } from 'drizzle-orm/pg-core'
import { getCustomDefaults } from '../src/studio'

describe('getCustomDefaults', () => {
  it('should return empty array for tables without defaultFn', () => {
    const users = pgTable('users', {
      id: text('id').primaryKey(),
      name: text('name'),
    })

    const result = getCustomDefaults({ public: { users } })
    expect(result).toEqual([])
  })

  it('should extract columns with $defaultFn', () => {
    const users = pgTable('users', {
      id: text('id').primaryKey().$defaultFn(() => 'generated-id'),
      name: text('name'),
    })

    const result = getCustomDefaults({ public: { users } })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      schema: 'public',
      table: 'users',
      column: 'id',
    })
    expect(result[0].func).toBeTypeOf('function')
    expect(result[0].func()).toBe('generated-id')
  })

  it('should handle multiple schemas', () => {
    const users = pgTable('users', {
      id: text('id').primaryKey().$defaultFn(() => `user-${Date.now()}`),
    })
    const posts = pgTable('posts', {
      id: text('id').primaryKey().$defaultFn(() => `post-${Date.now()}`),
    })

    const result = getCustomDefaults({
      public: { users },
      blog: { posts },
    })
    expect(result).toHaveLength(2)
    expect(result.map((d) => d.schema)).toContain('public')
    expect(result.map((d) => d.schema)).toContain('blog')
  })
})
