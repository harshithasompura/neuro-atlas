import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  outputFileTracingIncludes: { "/api/**": ["./data/**"] },
};

export { config as default };
