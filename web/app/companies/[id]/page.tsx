import { notFound } from 'next/navigation';
import {
  candidatesForCompany, connectionsAtCompany, getCompany, introductionsIntoCompany, peopleAtCompany,
} from '@/lib/data/companies';
import { rolesForCompany } from '@/lib/data/jobs';
import { CompanyView } from './CompanyView';

export const dynamic = 'force-dynamic';

export default async function CompanyPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ role?: string }>;
}) {
  const { id } = await params;
  const { role } = await searchParams;
  const companyId = Number(id);
  if (!Number.isInteger(companyId)) notFound();

  const company = getCompany(companyId);
  if (!company) notFound();

  return (
    <CompanyView
      company={company}
      roles={rolesForCompany(companyId)}
      focusRoleId={role ? Number(role) : null}
      people={peopleAtCompany(companyId)}
      candidates={candidatesForCompany(companyId)}
      connections={connectionsAtCompany(companyId)}
      introductions={introductionsIntoCompany(companyId)}
    />
  );
}
