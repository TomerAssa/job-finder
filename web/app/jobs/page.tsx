import { listRoles } from '@/lib/data/jobs';
import { JobsView } from './JobsView';

export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  return <JobsView roles={listRoles()} />;
}
