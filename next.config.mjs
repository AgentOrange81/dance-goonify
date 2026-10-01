/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // face-api.js ships WASM and model weights; we host them from /public/templates/models/
  // No special webpack config needed — Next handles it.
  // We don't need any server-side image processing (sharp), so no images config changes.
  experimental: {
    // Keep server actions off — every interaction in this app is client-side
    serverActions: { allowedOrigins: ["dance.goonify.fun", "localhost:3000"] },
  },
  // Cloudflare Pages: use the default static export for now; can switch to
  // node runtime per route if we ever need /api/lapdance server logic.
};

export default nextConfig;
