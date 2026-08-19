/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native module — keep it external to the server bundle.
  serverExternalPackages: ['better-sqlite3'],

  // The console imports the shared people layer and the agents from ../src, which
  // are NodeNext modules and therefore write `./foo.js` when they mean `./foo.ts`.
  // Webpack does not apply that mapping to files outside the app, so spell it out.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
  turbopack: {
    resolveAlias: {},
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.mjs'],
  },
};
export default nextConfig;
