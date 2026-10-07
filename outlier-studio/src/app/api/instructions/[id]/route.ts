import { z } from 'zod';
import { notFound } from '@/server/errors';
import { json, readJson, route } from '@/server/http';
import { deleteInstructions, InstructionsInput, updateInstructions } from '@/server/instructions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const id = (params: Record<string, string>) => {
  const parsed = z.string().uuid().safeParse(params.id);
  if (!parsed.success) throw notFound();
  return parsed.data;
};

/** Any subset of the fields; isDefault: true makes this the set every new analysis follows. */
const Patch = InstructionsInput.partial();

export const PUT = route('user', async ({ req, user, params }) => {
  const input = await readJson(req, Patch);
  return json({ instructions: await updateInstructions(user.id, id(params), input) });
});

export const DELETE = route('user', async ({ user, params }) => {
  await deleteInstructions(user.id, id(params));
  return json({ ok: true });
});
