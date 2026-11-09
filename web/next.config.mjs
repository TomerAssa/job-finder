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

  // Both of the next two exist because this console is also served to a phone
  // over Tailscale (scripts/phone.sh), where every request arrives under a
  // different host than localhost. JOB_WEB_ORIGINS overrides the list,
  // comma-separated; nothing here is baked into the client bundle, so changing
  // it needs no rebuild.
  //
  // The dev server refuses cross-origin requests from a host it was not told
  // about.
  allowedDevOrigins: (process.env.JOB_WEB_ORIGINS ?? 'tomers-macbook-air.tail7ab05f.ts.net,100.76.168.105')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  // And Next checks a Server Action's Origin against the forwarded host,
  // returning 403 when they disagree. `tailscale serve` preserves Host, so this
  // may well be redundant — but the symptom when it is not is every mutation in
  // the app failing silently, which is a miserable thing to diagnose from a phone.
  experimental: {
    serverActions: {
      allowedOrigins: [
        'localhost:4311',
        '127.0.0.1:4311',
        ...(process.env.JOB_WEB_ORIGINS ?? 'tomers-macbook-air.tail7ab05f.ts.net')
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ],
    },
  },
};
export default nextConfig;
