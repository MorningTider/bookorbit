import { describe, expect, it } from 'vitest'
import { selectSourceDestination } from './source-destination'

describe('source destination', () => {
  it('uses an accessible configured ebook destination', () => {
    expect(selectSourceDestination([{ id: 2 }, { id: 1 }], 1)).toBe(1)
  })
  it('requires selection when multiple libraries have no accessible default', () => {
    expect(selectSourceDestination([{ id: 2 }, { id: 1 }], 9)).toBeNull()
    expect(selectSourceDestination([{ id: 2 }, { id: 1 }], null)).toBeNull()
  })
  it('selects the only available destination', () => {
    expect(selectSourceDestination([{ id: 1 }], null)).toBe(1)
    expect(selectSourceDestination([], 1)).toBeNull()
  })
})
