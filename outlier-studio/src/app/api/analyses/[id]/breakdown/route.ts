import { z } from 'zod';
import { createLongBreakdown } from '@/server/ai/features/breakdown';
import { notFound } from '@/server/errors';
import { json, route } from '@/server/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Builds the sentence-by-sentence breakdown of a saved analysis and stores it on that analysis. */
export const POST = route('user', async ({ req, user, params }) => {
  const id = z.string().uuid().safeParse(params.id);
  if (!id.success) throw notFound();
  return json(await createLongBreakdown(user.id, id.data, req.signal), { status: 201 });
});
