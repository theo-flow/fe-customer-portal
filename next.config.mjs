/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export for S3+CloudFront production deploy.
  // During dev, `npm run dev` serves locally without this restriction.
  // Uncomment before running `npm run build` for S3 deploy:
  // output: 'export',
}

export default nextConfig
