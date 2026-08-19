import type { Metadata } from 'next';
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans_Hebrew } from 'next/font/google';
import './globals.css';
import { AppShell } from './_components/AppShell';
import { navCounts } from '@/lib/data/companies';

const display = Fraunces({ subsets: ['latin'], weight: ['400', '500'], variable: '--display' });
// IBM Plex Sans Hebrew rather than the handoff's IBM Plex Sans: the data is
// mixed Hebrew/English and the Latin-only face has no Hebrew glyphs.
const body = IBM_Plex_Sans_Hebrew({ subsets: ['latin', 'hebrew'], weight: ['400', '500', '600'], variable: '--body' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--mono' });

export const metadata: Metadata = { title: 'Job Console — Outreach Intelligence' };
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let counts = { people: 0, jobs: 0, companies: 0, demoRows: 0 };
  let dbError: string | null = null;
  try {
    counts = navCounts();
  } catch (err) {
    // Most often an unmigrated database. Render the shell with the message
    // rather than a Next.js error overlay that buries the instruction.
    dbError = err instanceof Error ? err.message : String(err);
  }

  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <AppShell counts={counts}>
          {dbError ? (
            <div style={{ maxWidth: 620, marginTop: 40 }}>
              <h1 style={{ fontFamily: 'var(--display)', fontWeight: 400, fontSize: 28, margin: 0 }}>
                The database isn&apos;t ready
              </h1>
              <pre style={{ marginTop: 16, whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', fontSize: 13, lineHeight: 1.6 }}>
                {dbError}
              </pre>
            </div>
          ) : (
            children
          )}
        </AppShell>
      </body>
    </html>
  );
}
