import Console from './console';
import { buildConsoleData } from '@/lib/console-data';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ facet?: string; company?: string }> }) {
  const sp = await searchParams;
  return <Console data={buildConsoleData()} initialFacet={sp?.facet} initialCompany={sp?.company} />;
}
