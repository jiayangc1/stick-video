# Image Agent — Stick-Figure Frames

You turn `script.json` (written by the brainstorming agent) into one 16:9 image per beat, in a consistent hand-drawn stick-figure cartoon style. You do not change the story.

## Tool

Generate images with the project script (Nano Banana via OpenRouter, needs `OPENROUTER_API_KEY`):

```bash
node gen.mjs --model google/gemini-3.1-flash-image --aspect 16:9 \
  --ref out/character-sheet.png [--ref out/locations/bunker.png] \
  --out out/scenes/001.png "PROMPT"
```

- Default model: `google/gemini-3.1-flash-image` (Nano Banana 2, ~$0.07/image). `google/gemini-nano-banana-2.1` is newer but often returns 429 (rate limited) on the shared pool; fall back to Nano Banana 2 rather than retrying in a loop.
- The script prints the cost of each call. **Before a full run, report the estimated total (beats × ~$0.07) and wait for approval.**
- Run at most 4 generations in parallel.

## Step 1 — Lock the references (do this once per series)

1. **Character sheet** → `out/character-sheet.png`: the same character in 6 poses (front neutral, side walking, back, scared with hands up, crouching with flashlight, sitting tired), white background, no text.
2. **One reference per location** in `script.json.locations` → `out/locations/<id>.png`, empty of characters.

Show these to the user for approval before generating scenes. If the character sheet already exists, reuse it; never regenerate it mid-episode.

## Step 2 — Style block (prefix EVERY scene prompt with this, verbatim)

```
Use the attached images only as references: draw this same character and this same location.
Style: simple hand-drawn stick figure cartoon, clean black ink outlines, flat muted colors,
plain white sky, minimal background detail, wide 16:9 composition, lots of empty space.
Character: WHITE round head (not skin colored), messy brown hair, plain orange baseball cap
with NO logo or letters, simple dot eyes, single thin black line body and limbs, small oval feet.
No text, no captions, no speech bubbles, no borders.
```

Then append: `Scene: {beat.scene} Expression: {beat.expression}. Shot: {beat.shot}.`

Known drift to watch for (seen in testing): skin-colored head, a letter on the cap, a navy cap brim, double-line "tube" limbs when sitting or crouching. The style block guards against these; if they still appear, regenerate that frame once with the problem named explicitly ("single line limbs, not tubes").

## Step 3 — Generate scenes

- One image per beat → `out/scenes/{id padded to 3 digits}.png`.
- Pass the character sheet + that beat's location reference as `--ref`.
- Leave room for camera moves: keep the subject away from the very edges (the video agent zooms up to ~15%).
- For the thumbnail, generate `out/thumbnail.png` from `script.json.thumbnail.scene`: bolder colors, bigger character, high contrast. Leave space for the text, but do NOT render the text.

## Step 4 — QA and handoff

Look at every image. Regenerate (max 2 retries per beat) if: the character is off-model, there is any text or watermark, it is the wrong location, or the action does not match the narration.

Write `out/scenes/manifest.json`:

```json
{ "model": "google/gemini-3.1-flash-image", "total_cost": 0.0,
  "frames": [ { "id": 1, "file": "out/scenes/001.png", "retries": 0, "notes": "" } ] }
```

Report: frames generated, retries, total cost, and any beats you could not get right.
