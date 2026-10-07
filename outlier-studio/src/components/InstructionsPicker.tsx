'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AnalysisInstructions } from '@/lib/types';
import { SelectMenu } from './SelectMenu';

const NONE = 'none';

/**
 * Chooses the instructions an analysis follows. Starts on the user's default
 * set; onChange receives a set id, or null for no instructions.
 */
export function InstructionsPicker({ onChange }: { onChange: (id: string | null) => void }) {
  const [items, setItems] = useState<AnalysisInstructions[] | null>(null);
  const [value, setValue] = useState(NONE);

  useEffect(() => {
    api<{ items: AnalysisInstructions[] }>('/api/instructions')
      .then((r) => {
        setItems(r.items);
        const initial = r.items.find((i) => i.isDefault)?.id ?? NONE;
        setValue(initial);
        onChange(initial === NONE ? null : initial);
      })
      // Without the list the server still applies the default set.
      .catch(() => setItems([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (items === null) return null;
  if (items.length === 0) {
    return (
      <p className="muted small">
        Want the analysis to focus on something specific? <Link href="/app/instructions">Add analysis instructions</Link>.
      </p>
    );
  }
  return (
    <div className="instructions-picker">
      <span className="small muted">Follow</span>
      <SelectMenu
        label="Analysis instructions"
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next === NONE ? null : next);
        }}
        options={[...items.map((i) => ({ value: i.id, label: i.isDefault ? `${i.name} (default)` : i.name })), { value: NONE, label: 'No instructions' }]}
      />
      <Link className="small" href="/app/instructions">
        Edit
      </Link>
    </div>
  );
}
