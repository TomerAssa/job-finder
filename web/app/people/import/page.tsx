import { listPool, poolStats } from '@/lib/data/people';
import { ImportView } from './ImportView';

export const dynamic = 'force-dynamic';

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  return (
    <ImportView
      initialTab={sp?.tab === 'pool' ? 'pool' : sp?.tab === 'add' ? 'add' : 'bulk'}
      pool={listPool({ limit: 400 })}
      stats={poolStats()}
    />
  );
}
