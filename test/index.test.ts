import { describe, it, expect } from 'vitest'
import { getStudioUrl } from '../src/index'

describe('getStudioUrl', () => {
  it('should return default URL with no params', () => {
    expect(getStudioUrl()).toBe('https://local.drizzle.studio')
  })

  it('should return default URL for default host and port', () => {
    expect(getStudioUrl('127.0.0.1', 4983)).toBe('https://local.drizzle.studio')
  })

  it('should include port param when non-default', () => {
    expect(getStudioUrl('127.0.0.1', 3000)).toBe('https://local.drizzle.studio?port=3000')
  })

  it('should include host param when non-default', () => {
    expect(getStudioUrl('0.0.0.0', 4983)).toBe('https://local.drizzle.studio?host=0.0.0.0')
  })

  it('should include both params when both non-default', () => {
    const url = getStudioUrl('0.0.0.0', 3000)
    expect(url).toContain('port=3000')
    expect(url).toContain('host=0.0.0.0')
    expect(url).toMatch(/^https:\/\/local\.drizzle\.studio\?/)
  })
})
