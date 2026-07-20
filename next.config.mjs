/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export for S3+CloudFront production deploy.
  // During dev, `npm run dev` serves locally without this restriction.
  // Uncomment before running `npm run build` for S3 deploy:
  // output: 'export',

  // react-pdf's documented requirement for Next.js < 15.0.0-canary.53 (we're
  // on 14.2.5) -- SWC's minifier can mangle the import.meta.url-based
  // pdf.worker URL construction in DocumentPreview.tsx without this.
  swcMinify: false,

  experimental: {
    // Output file tracing for this app's routes falls back to treating the
    // entire node_modules as a dependency (likely triggered by @aws-sdk-v3's
    // dynamic requires in its credential-provider chain, which the static
    // tracer can't resolve). That inflates the Lambda deploy bundle well
    // past AWS's 250MB unzipped limit -- confirmed by build: prod-only deps
    // came to ~289MB, of which @next/swc-* alone is ~130MB and is never
    // referenced anywhere in the compiled .next/server output (it's a
    // build-time-only compiler binary, not a runtime one). playwright/
    // playwright-core are `devOptional` in the lockfile yet still resolved
    // into a `--omit=dev` install -- excluded here too since nothing in the
    // app imports them. Explicitly excluding these brings the deploy bundle
    // back down to what's actually needed at runtime.
    outputFileTracingExcludes: {
      '*': [
        'node_modules/@next/swc-*/**',
        'node_modules/playwright-core/**',
        'node_modules/playwright/**',
        'node_modules/@playwright/**',
      ],
    },
  },
}

export default nextConfig
