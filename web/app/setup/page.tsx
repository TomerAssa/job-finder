import { setupStatus } from '@/lib/data/setup';
import { SetupWizard } from './SetupWizard';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  return <SetupWizard status={setupStatus()} />;
}
