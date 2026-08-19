import { companyOptions, listPeople } from '@/lib/data/people';
import { ManageView } from './ManageView';

export const dynamic = 'force-dynamic';

export default async function ManagePage() {
  return <ManageView people={listPeople()} companies={companyOptions()} />;
}
