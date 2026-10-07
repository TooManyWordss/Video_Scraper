import { json, readJson, route } from '@/server/http';
import { createInstructions, InstructionsInput, listInstructions } from '@/server/instructions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route('user', async ({ user }) => json({ items: await listInstructions(user.id) }));

export const POST = route('user', async ({ req, user }) => {
  const input = await readJson(req, InstructionsInput);
  return json({ instructions: await createInstructions(user.id, input) }, { status: 201 });
});
