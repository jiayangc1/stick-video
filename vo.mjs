// Generate one voiceover clip per beat with ElevenLabs.
// Usage: node --env-file=.env vo.mjs [--script script.json] [--voice id] [--only 3,17] [--force]
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    script: { type: 'string', default: 'script.json' },
    voice: { type: 'string', default: 'nPczCjzI2devNBz1zQrb' }, // Brian: deep, calm narrator
    model: { type: 'string', default: 'eleven_multilingual_v2' },
    only: { type: 'string' },
    force: { type: 'boolean', default: false },
    parallel: { type: 'string', default: '2' },
  },
});

const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error('ELEVENLABS_API_KEY is not set');

// Same settings for every beat and every episode, so the narrator never changes.
const voiceSettings = { stability: 0.6, similarity_boost: 0.75, style: 0.1, speed: 0.95 };

const { beats } = JSON.parse(await readFile(values.script, 'utf8'));
const only = values.only && new Set(values.only.split(',').map(Number));
await mkdir('out/audio/vo', { recursive: true });

const exists = (p) => access(p).then(() => true, () => false);
let cost = 0;

async function render(i) {
  const beat = beats[i];
  const out = `out/audio/vo/${String(beat.id).padStart(3, '0')}.mp3`;
  if (only ? !only.has(beat.id) : !values.force && await exists(out)) return;

  // Neighbouring lines keep intonation continuous across clips.
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${values.voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: beat.narration,
      model_id: values.model,
      voice_settings: voiceSettings,
      previous_text: beats[i - 1]?.narration,
      next_text: beats[i + 1]?.narration,
    }),
  });
  if (!res.ok) throw new Error(`beat ${beat.id}: ${res.status} ${await res.text()}`);

  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  const c = Number(res.headers.get('character-cost') ?? 0);
  cost += c;
  console.log(`${out}  (${c} credits)`);
}

const queue = beats.map((_, i) => i);
await Promise.all(Array.from({ length: Number(values.parallel) }, async () => {
  while (queue.length) await render(queue.shift());
}));
console.log(`total: ${cost} credits`);
