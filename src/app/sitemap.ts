import type { MetadataRoute } from 'next'

const BASE_URL = 'https://theoflow.bytheodore.co.za'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const marketingPages = ['', '/about', '/product', '/features', '/contact']

  return marketingPages.map(path => ({
    url: `${BASE_URL}${path}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: path === '' ? 1 : 0.8,
  }))
}
