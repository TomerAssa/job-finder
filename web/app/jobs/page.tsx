import { Suspense } from 'react';
import { listRoles } from '@/lib/data/jobs';
import { JobsView } from './JobsView';

export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  // useSearchParams needs a suspense boundary during prerender.
  return (
    <Suspense>
      <JobsView roles={listRoles()} />
    </Suspense>
  );
}
