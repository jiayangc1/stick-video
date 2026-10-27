// Assemble script.json + out/scenes + out/audio/vo (+ optional out/clips) into out/final.mp4.
// Usage: node render.mjs [--script script.json] [--only 3,17] [--parallel 4]
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';

const run = promisify(execFile);
const { values } = parseArgs({
  options: {
    script: { type: 'string', default: 'script.json' },
    only: { type: 'string' },
    parallel: { type: 'string', default: '4' },
  },
});

const FPS = 30, PAD = 0.3, FADE = 0.25;
const script = JSON.parse(await readFile(values.script, 'utf8'));
const { beats, chapters } = script;
const pad = (n) => String(n).padStart(3, '0');
const exists = (p) => access(p).then(() => true, () => false);
const ffmpeg = (args) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 1 << 26 });

async function duration(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(stdout);
}

// Eased 0 -> 1 over the beat, so moves start and stop gently.
const E = `((1-cos(PI*on/{N}))/2)`;
const center = { x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' };
const moves = {
  zoom_in: { z: `1+0.12*${E}`, ...center },
  zoom_out: { z: `1.12-0.12*${E}`, ...center },
  still: { z: `1+0.03*${E}`, ...center },
  pan_right: { z: '1.1', x: `(iw-iw/zoom)*${E}`, y: center.y },
  pan_left: { z: '1.1', x: `(iw-iw/zoom)*(1-${E})`, y: center.y },
  // 0.4s shake at the start of the beat.
  shake: { z: '1.06', x: `(iw-iw/zoom)/2+if(lt(on,12),28*sin(on*2.7),0)`, y: `(ih-ih/zoom)/2+if(lt(on,12),20*cos(on*3.1),0)` },
};

const chapterStarts = new Set(chapters.map((c) => c.start_beat));
const timeSkip = (b) => /^(Day|Week) \d+\./.test(b.narration);
const fadeIn = (i) => i > 0 && (chapterStarts.has(beats[i].id) || timeSkip(beats[i]));
const fadeOut = (i) => i < beats.length - 1 && fadeIn(i + 1);

await mkdir('out/build', { recursive: true });
const vo = await Promise.all(beats.map((b) => duration(`out/audio/vo/${pad(b.id)}.mp3`)));
const clipDurs = await Promise.all(beats.map(async (b) => {
  const clip = `out/clips/${pad(b.id)}.mp4`;
  return b.motion === 'animate' && await exists(clip) ? duration(clip) : 0;
}));
// Veo clips play at up to 2x so the action fits; if still longer than the VO, the beat holds in silence.
const MAX_SPEED = 2;
const durs = vo.map((d, i) => Math.max(d + PAD, clipDurs[i] / MAX_SPEED));

async function renderBeat(i) {
  const b = beats[i], id = pad(b.id), dur = durs[i], frames = Math.round(dur * FPS);
  const clip = `out/clips/${id}.mp4`;
  const useClip = clipDurs[i] > 0;

  const fades = [
    fadeIn(i) && `fade=t=in:st=0:d=${FADE}`,
    fadeOut(i) && `fade=t=out:st=${(dur - FADE).toFixed(3)}:d=${FADE}`,
  ].filter(Boolean);

  let input, video;
  if (useClip) {
    // Veo clip: retime to the beat, fit to 1080p, hold the last frame if it is still short.
    input = ['-an', '-i', clip];
    const stretch = Math.min(1, dur / clipDurs[i]);
    video = `setpts=${stretch.toFixed(4)}*PTS,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=${FPS},tpad=stop_mode=clone:stop_duration=${dur}`;
  } else {
    // Stills (and animate beats without a clip yet, as zoom_in): move at 2x resolution, then output 1080p.
    const m = moves[b.motion] ?? moves.zoom_in;
    const sub = (s) => s.replaceAll('{N}', frames);
    input = ['-i', `out/scenes/${id}.png`];
    video = `scale=3840:2160:force_original_aspect_ratio=increase,crop=3840:2160,` +
      `zoompan=z='${sub(m.z)}':x='${sub(m.x)}':y='${sub(m.y)}':d=${frames}:s=1920x1080:fps=${FPS}`;
  }

  await ffmpeg([
    ...input, '-i', `out/audio/vo/${id}.mp3`,
    '-filter_complex', `[0:v]${[video, ...fades, 'format=yuv420p'].join(',')}[v];[1:a]apad,aresample=48000[a]`,
    '-map', '[v]', '-map', '[a]', '-t', dur.toFixed(3),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
    `out/build/${id}.mp4`,
  ]);
  console.log(`beat ${id}  ${dur.toFixed(2)}s  ${useClip ? 'clip' : b.motion}`);
}

const only = values.only && new Set(values.only.split(',').map(Number));
const queue = beats.map((_, i) => i).filter((i) => !only || only.has(beats[i].id));
await Promise.all(Array.from({ length: Number(values.parallel) }, async () => {
  while (queue.length) await renderBeat(queue.shift());
}));

// Captions: split each beat's narration into chunks of <= 7 words, timed by word count.
const ts = (t) => {
  const ms = Math.round(t * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:` +
    `${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
const starts = durs.reduce((acc, d, i) => [...acc, acc[i] + d], [0]);
const srt = [];
beats.forEach((b, i) => {
  const words = b.narration.split(/\s+/);
  const chunks = [];
  for (let w = 0; w < words.length; w += 7) chunks.push(words.slice(w, w + 7));
  const speech = vo[i];
  let t = starts[i];
  for (const c of chunks) {
    const len = speech * (c.length / words.length);
    srt.push(`${srt.length + 1}\n${ts(t)} --> ${ts(t + len)}\n${c.join(' ')}\n`);
    t += len;
  }
});
await writeFile('out/captions.srt', srt.join('\n'));

// Concatenate, burn captions, normalize loudness to -14 LUFS / -1 dBTP.
await writeFile('out/build/list.txt', beats.map((b) => `file '${pad(b.id)}.mp4'`).join('\n') + '\n');
await ffmpeg(['-f', 'concat', '-safe', '0', '-i', 'out/build/list.txt', '-c', 'copy', 'out/build/joined.mp4']);
const style = 'FontName=DejaVu Sans,Bold=1,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=28';
await ffmpeg([
  '-i', 'out/build/joined.mp4',
  '-vf', `subtitles=out/captions.srt:force_style='${style}'`,
  '-af', 'loudnorm=I=-14:TP=-1:LRA=11',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart',
  'out/final.mp4',
]);

// YouTube description with real chapter timestamps.
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const chapterLines = chapters.map((c) => `${mmss(starts[beats.findIndex((b) => b.id === c.start_beat)])} ${c.title}`);
await writeFile('out/youtube.txt', `${script.title}\n\n${script.logline}\n\n${chapterLines.join('\n')}\n`);
console.log(`out/final.mp4  ${mmss(starts.at(-1))}`);
