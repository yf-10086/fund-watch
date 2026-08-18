const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  output: 'export',
  basePath,
  images: {
    unoptimized: true
  }
};

module.exports = nextConfig;
