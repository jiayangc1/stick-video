// Generate an image with Nano Banana via OpenRouter.
// Usage: node gen.mjs --out out.png [--ref ref.png ...] [--aspect 16:9] [--model id] "prompt"
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', default: 'out.png' },
    ref: { type: 'string', multiple: true, default: [] },
    aspect: { type: 'string', default: '16:9' },
    model: { type: 'string', default: 'google/gemini-nano-banana-2.1' },
  },
});

const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error('OPENROUTER_API_KEY is not set');

const prompt = positionals.join(' ');
if (!prompt) throw new Error('Missing prompt');

const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const refs = await Promise.all(values.ref.map(async (p) => ({
  type: 'image_url',
  image_url: { url: `data:${mime[extname(p).toLowerCase()] ?? 'image/png'};base64,${(await readFile(p)).toString('base64')}` },
})));

const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: values.model,
    modalities: ['image', 'text'],
    image_config: { aspect_ratio: values.aspect },
    messages: [{ role: 'user', content: [...refs, { type: 'text', text: prompt }] }],
  }),
});

const data = await res.json();
if (!res.ok) throw new Error(JSON.stringify(data.error ?? data));

const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
if (!url) throw new Error(`No image returned: ${JSON.stringify(data.choices?.[0]?.message?.content)}`);

await mkdir(dirname(values.out), { recursive: true });
await writeFile(values.out, Buffer.from(url.split(',')[1], 'base64'));
console.log(`${values.out}  (cost: $${data.usage?.cost ?? '?'})`);
