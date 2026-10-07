import { InstructionsManager } from '@/components/InstructionsManager';
import { PageHead } from '@/components/ui';

export const metadata = { title: 'Analysis instructions' };

export default function InstructionsPage() {
  return (
    <div className="stack-lg">
      <PageHead title="Analysis instructions">
        Tell the analyst what you care about. Your default set shapes every new breakdown, its sentence-by-sentence version and its chat.
      </PageHead>
      <InstructionsManager />
    </div>
  );
}
