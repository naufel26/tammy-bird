import { Redis } from '@upstash/redis';

const KEY = 'leaderboard';
const TOP_N = 10;
const KEEP_N = 1000; // cap the stored set so it can't grow forever
const MAX_SCORE = 9999;
const MAX_NAME_LEN = 16;

// Vercel's Upstash integration may expose either naming scheme
const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token, automaticDeserialization: false }) : null;

// Local dev without a database: keep scores in memory (lost on restart)
const memory = new Map();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function notConfigured() {
  // On Vercel, an in-memory board would silently differ per function instance, so refuse instead
  return !redis && process.env.VERCEL;
}

function cleanName(raw) {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(/\p{C}/gu, '') // control/invisible characters
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LEN);
}

async function topScores() {
  if (!redis) {
    return [...memory]
      .map(([name, score]) => ({ name, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N);
  }
  const flat = await redis.zrange(KEY, 0, TOP_N - 1, { rev: true, withScores: true });
  const entries = [];
  for (let i = 0; i < flat.length; i += 2) {
    entries.push({ name: String(flat[i]), score: Number(flat[i + 1]) });
  }
  return entries;
}

export async function GET() {
  if (notConfigured()) return json({ error: 'Leaderboard database is not configured' }, 503);
  return json({ entries: await topScores() });
}

export async function POST(request) {
  if (notConfigured()) return json({ error: 'Leaderboard database is not configured' }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const name = cleanName(body?.name);
  const score = body?.score;
  if (!name) return json({ error: 'Name is required' }, 400);
  if (!Number.isInteger(score) || score < 1 || score > MAX_SCORE) {
    return json({ error: 'Invalid score' }, 400);
  }

  if (redis) {
    // GT: only replace a player's entry when the new score is higher
    await redis.zadd(KEY, { gt: true }, { score, member: name });
    await redis.zremrangebyrank(KEY, 0, -(KEEP_N + 1));
  } else {
    memory.set(name, Math.max(memory.get(name) ?? 0, score));
  }

  return json({ entries: await topScores() });
}
