import { listPeople, poolStats } from '@/lib/data/people';
import { PeopleList } from './PeopleList';

export const dynamic = 'force-dynamic';

export default async function PeoplePage() {
  return <PeopleList people={listPeople()} pool={poolStats()} />;
}
