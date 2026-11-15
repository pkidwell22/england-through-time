import type { NextConfig } from "next";
// LTT_DIST lets a production build be checked without disturbing a running dev server.
const config: NextConfig = { reactStrictMode: false, devIndicators: false, distDir: process.env.LTT_DIST ?? ".next" };
export default config;
