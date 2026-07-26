import type { Metadata } from 'next';
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans_Hebrew } from 'next/font/google';
import './globals.css';

const display = Fraunces({ subsets: ['latin'], weight: ['400', '500'], variable: '--display' });
const body = IBM_Plex_Sans_Hebrew({ subsets: ['latin', 'hebrew'], weight: ['400', '500', '600'], variable: '--body' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--mono' });

export const metadata: Metadata = { title: 'Job Console — Outreach Intelligence' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
