import { describe, expect, it } from 'vitest'
import {
  isShopStatus,
  SHOP_STATUS_LABELS,
  SHOP_STATUSES,
  type ShopStatus,
  type SiteContent,
} from './site.ts'

describe('site contract', () => {
  it('labels every shop status and nothing else', () => {
    expect(Object.keys(SHOP_STATUS_LABELS).sort()).toEqual([...SHOP_STATUSES].sort())
    for (const status of SHOP_STATUSES) expect(SHOP_STATUS_LABELS[status].length).toBeGreaterThan(0)
  })

  it('recognises only the two shop statuses', () => {
    expect(isShopStatus('COMING_SOON')).toBe(true)
    expect(isShopStatus('OPEN')).toBe(true)
    expect(isShopStatus('open')).toBe(false)
    expect(isShopStatus(null)).toBe(false)
    expect(isShopStatus(1)).toBe(false)
  })

  it('has no duplicate status', () => {
    expect(new Set(SHOP_STATUSES).size).toBe(SHOP_STATUSES.length)
  })

  it('accepts a complete site payload', () => {
    const shopStatus: ShopStatus = 'COMING_SOON'
    const content: SiteContent = {
      site: {
        name: 'Sceptre Drive',
        tagline: 'Genuine and aftermarket spares.',
        heroHeading: 'Parts that keep Ghana moving.',
        heroBody: 'Find the part, check the branch, talk to a counter.',
        aboutBody: 'A multi-branch spare-parts business.',
        announcement: '',
        shopStatus,
        contactEmail: '',
        contactPhone: '',
        whatsapp: '',
        social: { instagram: '', facebook: '', tiktok: '' },
      },
      branches: [
        {
          code: 'ACC-SPX',
          name: 'Accra Spintex',
          city: 'Accra',
          area: 'Spintex',
          address: null,
          phone: null,
          hours: null,
          mapUrl: null,
        },
      ],
      updatedAt: '2026-10-29T10:00:00.000Z',
    }

    expect(content.branches[0]?.code).toBe('ACC-SPX')
    expect(content.site.social.instagram).toBe('')
  })
})
