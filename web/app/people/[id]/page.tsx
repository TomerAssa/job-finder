import { notFound } from 'next/navigation';
import { getPersonListItem, connectorNames, companyOptions } from '@/lib/data/people';
import { repo } from '@/lib/repo';
import { PersonProfile } from './PersonProfile';

export const dynamic = 'force-dynamic';

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const personId = Number(id);
  if (!Number.isInteger(personId)) notFound();

  const person = getPersonListItem(personId);
  if (!person) notFound();

  const r = repo();
  return (
    <PersonProfile
      person={person}
      introductions={r.introductionsFor(personId)}
      interactions={r.interactionsFor(personId)}
      similar={r.similarPeople(personId).map((p) => ({ id: p.id, name: p.full_name }))}
      connectorNames={connectorNames()}
      companies={companyOptions()}
    />
  );
}
