# stick-video

Pipeline for faceless, second-person survival story videos with hand-drawn stick-figure visuals.

## Agents

Run in order. Each one hands its output to the next.

1. [`agents/1-brainstorm.md`](agents/1-brainstorm.md): pitches and writes the episode as `script.json` (beats, chapters, shots, SFX, music).
2. [`agents/2-image.md`](agents/2-image.md): locks the character and location references, then renders one 16:9 frame per beat.
3. [`agents/3-video.md`](agents/3-video.md): voiceover, camera motion, sound design, captions, final MP4, chapters and thumbnail.

## Image generation

`gen.mjs` calls Nano Banana through OpenRouter. It needs Node 18+ and `OPENROUTER_API_KEY`.

```bash
node gen.mjs --model google/gemini-3.1-flash-image --aspect 16:9 \
  --ref out/character-sheet.png --out out/scenes/001.png "prompt"
```

`out/character-sheet.png` is the reference for the main character.
