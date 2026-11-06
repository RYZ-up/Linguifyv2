// Retire every old alias as well as the public route; no paid API calls remain.
export default () => new Response(JSON.stringify({ error: 'Ancienne API désactivée.' }), { status: 410, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
export const config = { path: '/api/ai-correct' };
