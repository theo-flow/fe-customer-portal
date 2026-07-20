import type { MetadataRoute } from 'next'

const BASE_URL = 'https://theoflow.bytheodore.co.za'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard', '/upload', '/status', '/forms', '/submissions', '/templates', '/clarifications', '/api'],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  }
}
