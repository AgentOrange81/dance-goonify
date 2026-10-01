/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // face-api.js ships WASM and model weights; we host them from /public/templates/models/
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
