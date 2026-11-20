# Building a Projected-Face Visualization

Nova and Sable are portraits that come to life for each query: they open
their eyes, look around, blink, and grow neon glyphs across their skin while
the model works. This document describes how they were made, written as a
recipe for adding another face from a different picture.

What they do on screen, and how to drive them from the browser console, is
covered under "Nova and Sable" in the [README](../README.md). This document
is about building one.

## The idea

A face is **one picture projected onto a rigged 3D head**.

- The picture supplies the whole look: skin, lighting, make-up, hair,
  background. Nothing is lit or shaded at run time.
- The head, fitted to the picture so that it lines up with the painted face,
  supplies the movement: lids that close, eyes that turn, lips that part, and
  a few degrees of head turn.

Seen from the camera the head was fitted to, the painted head reproduces the
picture exactly. Everything that moves, moves the paint with it.

All of the machinery is shared. A new face is data: a picture, a file of
marks made on it by hand, and a dozen settings.

```
scripts/faces/<face>.jpg|png   the picture          ┐
scripts/faces/<face>.json      marks made by hand   ┘ you make these
        │
        ├─ prepare_face_picture.py ─► static/img/<face>.jpg          clean picture
        │                             static/img/<face>-glyphs.jpg   painted glyphs
        └─ bake-face.mjs ───────────► static/models/<face>.glb       fitted head
                                              │
utils/faceConfigs.ts (settings) ──────────────┤
                                              ▼
                              components/ProjectedFace.tsx
```

Paths in this document are relative to `webapp/` unless they start with
`docs/`; front-end files are under `webapp/front-end/react/`.

## What you need

- **Node 18 or later** for the bake (it uses the built-in `fetch`).
- **Python 3 with Pillow and NumPy** for the picture layers and the two
  marking helpers.
- **About 210 MB of disk** for the ICT-FaceKit source meshes, which the bake
  downloads once into a cache directory.
- **A picture.** What makes one suitable:

  | Wanted | Why |
  | --- | --- |
  | Square | The fit and the canvas both assume it. Crop first. |
  | The face roughly front-on | Nova is turned 13° and tipped 10°, Sable 8° and 9°. Much more and one side of the face has no paint. |
  | Both eyes open and unobstructed | The irises are redrawn and the lids repainted; hair across an eye gets repainted with them. |
  | Mouth closed or slightly parted | The parted lips are matched by the fit and can be eased shut, but a wide smile with teeth is paint that cannot move. |
  | Head and some surroundings in frame | Hair, ears, collar and background come straight from the picture, on a plate behind the head. |
  | 256 px or more | She is shown at 282 CSS px, and the layers are resampled to 1024 whatever the source. Nova's picture is 256 px and Sable's 512 px. More resolution mainly sharpens fine painted glyphs. |

  Glyphs or circuit marks painted on the skin are optional. If the picture
  has them, they are lifted off so they can draw themselves in during a
  query.

## The recipe

The examples use `sable`; substitute the new face's name throughout. The name
must be a single lower-case word: it becomes the file names, the setting's
value and the console handle (`window.sable`).

### 1. Put the picture in place

Save the picture as `scripts/faces/<face>.jpg` (or `.png`) and start
`scripts/faces/<face>.json` from a copy of `sable.json`. Set `reference` to
the picture's file name.

### 2. Mark the picture

This is the only real handwork, and the result depends on it more than on
anything else. The JSON file holds three kinds of marks. **Every number is a
fraction of the picture's width (x) or height (y) from its top-left corner**:
pixel position divided by the picture's size. That keeps the marks valid if
the picture is later replaced by a larger copy of itself.

To read positions accurately, work from enlarged crops with a pixel grid
drawn over them, which `scripts/face_grid.py` makes: one crop per eye, one
for the brows, the nose, the mouth and the chin. The arguments after the
output file are the left, top, right and bottom of the crop in pixels of the
picture; `--scale` and `--step` change the enlargement and the grid spacing.

```bash
python scripts/face_grid.py sable /tmp/sable-eye.png 150 110 290 200
```

#### Landmarks

`landmarks` lists facial landmarks in the 68-point numbering that
ICT-FaceKit uses. Nova and Sable each mark 52 of them. "Her right" is the
viewer's left.

| Index | Where | Weight |
| --- | --- | --- |
| 8 | Tip of the chin | 0.5 |
| 17–21 | Her right brow, outer end to inner end | 0.5 |
| 22–26 | Her left brow, inner end to outer end | 0.5 |
| 27–29 | Bridge of the nose, from between the eyes downward | 0.5 |
| 30 | Tip of the nose | 1.0 |
| 31–35 | Base of the nose, viewer's left to right; 33 is the middle | 1.0 |
| 36–41 | Her right eye: 36 outer corner, 37 and 38 upper lid, 39 inner corner, 40 and 41 lower lid (back toward the outer corner) | 1.5 |
| 42–47 | Her left eye: 42 inner corner, 43 and 44 upper lid, 45 outer corner, 46 and 47 lower lid (back toward the inner corner) | 1.5 |
| 48–59 | Outer edge of the lips, clockwise as you look at her from the viewer's-left corner (48): upper lip 49–53, right corner 54, lower lip 55–59 | 1.0 |
| 60–67 | Inner edge of the lips, the same way round: left corner 60, upper 61–63, right corner 64, lower 65–67 | 0.7 |

`weight` is how hard the fit pulls on a mark. The eyes are weighted most
because the lids and irises must land exactly; brows, bridge and chin least
because they are the hardest to place by eye.

The jaw outline (0–7 and 9–16) is left out. On a turned head the outline you
see is not at fixed points on the model, and hair usually covers part of it.

Things that matter when marking:

- Mark eye corners where the lids meet, not where the lashes end.
- Mark the lid points on the lid margin, at about a third and two thirds of
  the way across.
- Mark the lips' edges, not the shadow under the lower lip.

The marks were made by hand for both faces. An automatic 68-point detector
could supply a first pass, though that has not been tried here.

#### Irises

`irises` holds one entry per eye, in either order:

```json
{ "x": 0.4209, "y": 0.2949, "radius": 0.0303, "top": -0.6, "bottom": 0.76 }
```

- `x`, `y`, `radius`: the centre and radius of the **whole** iris disc,
  including the part the lids hide. The radius is a fraction of the width.
- `top`, `bottom`: where the lids cut the disc, as fractions of the radius
  above (negative) and below the centre. Only the part between them is
  painted out, so the lash line and lower lid survive.

These marks do two jobs: they say what to paint out of the picture, and the
bake uses them to work out how each eyeball must be turned, and how large
its iris must be drawn, to sit exactly where the painted one was.

#### Glyph boxes

`glyphBoxes` lists rectangles around any glyphs painted on the skin. Use
`[]` if there are none.

```json
{ "box": [0.64, 0.375, 0.775, 0.52], "threshold": 22, "channel": "green" }
```

- `box`: left, top, right, bottom.
- `threshold`: how far a pixel must stand out from a blurred copy of its
  surroundings (0–255) to count as glyph. The two faces use values from 20
  to 36: lower for faint glyphs on even skin, higher next to highlights.
- `channel` (optional): judge by one of `red`, `green`, `blue` instead of the
  brightest channel. Use it where a highlight of another colour crosses the
  glyphs, as the magenta rim light crosses Sable's cyan dots.

Draw boxes tightly. Anything bright and small inside one is treated as a
glyph: a highlight on the nose, a catchlight, a bokeh dot. Several small
boxes are better than one large one.

### 3. Check the fit

Bake to a scratch file with `--debug`, which also writes the fitted
landmarks and the head's wireframe as they fall on the picture, and draw them
over it with `scripts/face_fit_overlay.py`:

```bash
node scripts/bake-face.mjs sable --out /tmp/sable.glb --debug /tmp/sable-fit.json
```

```bash
python scripts/face_fit_overlay.py sable /tmp/sable-fit.json /tmp/sable-overlay.png
```

The first run downloads the source meshes (pass `--cache <dir>` to choose
where; the default is `ict-facekit` in the system temp directory).

In the overlay, green rings are your marks, red dots are where the model put
the same landmarks, and a yellow line joins each pair. Look for:

- **Landmark error** in the bake's output: Nova fits to 0.79% of the
  picture's width and Sable to 0.87%. Around 1% is good. Several per cent
  means a mark has the wrong index or a left and right are swapped.
- **One long yellow line** among short ones: that mark is misplaced.
- **The wireframe**: its eye openings should sit on the painted eyes, its
  lips on the painted lips, and its outline inside the painted face.
- **The pose** in the output (`yaw`, `pitch`, `roll`) should look like the
  turn of the head in the picture.

Move marks and re-run until it does. The fit is deliberately a little stiff:
it will not chase a mark that asks for an unlikely face, so a stubborn
residual on one mark usually means the mark is off, not the fit.

### 4. Split the picture and bake the model

```bash
python scripts/prepare_face_picture.py sable
```

```bash
node scripts/bake-face.mjs sable
```

Open the two layers in `static/img/` and check them:

- `<face>.jpg` should look like the picture with the glyphs gone, clean skin
  in their place, and each iris replaced by a smooth patch between intact
  lash lines.
- `<face>-glyphs.jpg` should show only the glyphs on black. If it shows skin
  highlights too, tighten the boxes, raise the threshold or name a
  `channel`. If glyphs are missing from it, lower the threshold.

Both scripts are deterministic, so they can be re-run at any time.

### 5. Register the face

Edits to three files make it selectable:

1. `utils/faceConfigs.ts`: add the name to the `FaceId` type and an entry to
   `FACES` (start from a copy of Sable's; step 6 covers the values).
2. `stores/ChatStoreContext.tsx`: add the name to the `VisualizationType`
   type and the `VISUALIZATIONS` list.
3. `components/PreferencesMenu.tsx`: add `{ value, label }` to
   `VISUALIZATION_OPTIONS`.

`ChatApp.tsx` needs no change: it renders `ProjectedFace` for any value that
`isFaceId` accepts. The quality setting, the console handle and the styling
follow automatically.

### 6. Tune the settings

These are the things that cannot be read off the picture. With the app
running, select the face and compare it with the reference picture side by
side while driving it from the console (step 7).

| Setting | What it does | How to set it |
| --- | --- | --- |
| `irisPlacement` | `"marked"` turns each eye and sizes its iris to cover the marked one. | Use `"marked"`. (`"level"` exists so that Nova keeps the look she was tuned with.) |
| `iris.inner`, `iris.outer` | Iris colour next to the pupil and at the rim, linear RGB. | Pick from the picture. Values above 1 glow through the bloom. |
| `iris.exposure` | The brightness of the painted-out eye at which the iris shows at full strength. | Lower it if the iris is dull; raise it if it burns out to white. Nova's eyes are in shadow (0.11); Sable's are bright (0.3). |
| `iris.pupil`, `iris.pupilColor` | Pupil size as a fraction of the iris, and its colour. | Match the picture. A glowing eye wants a small pupil tinted with the iris colour. |
| `iris.limbal` | How far the iris darkens toward its rim. | Higher for a defined ring, lower for a soft glow. |
| `iris.catchlight` | Strength of the highlight on the eye. | Lower it where the iris is already bright. |
| `lid.shade` | Brightness of a closed lid against the skin around the eye. | Lower it where the eyes light the skin around them, as Sable's do. |
| `lid.blur` | How much the skin above and below the eye is blurred before it is spread over the lid. | Raise it if lashes or eyeliner streak across the closed lid. |
| `lid.cover` | Whether the whole lid is repainted (1) or only the part over the painted eye (0). | Raise it if bright streaks appear on the lid as it closes. |
| `constellationSide` | Which cheek, from the viewer's side, takes the live constellation; circuit traces take the other. | The cheek the picture's own glyphs leave freer. |
| `revealFrom` | The point in the picture that its own glyphs draw in from. | A point on the painted glyphs, such as the end nearest the eye. |
| `pictureGlyphGain` | Strength of the painted glyphs once drawn in. | Start at 1.25. Raise it for fine or faint lines (Sable: 2.4). |
| `mouthOpenness` | How far the lips are parted at rest: 1 as painted, 0 closed. | 0.25 for both faces so far. |

### 7. Check it on screen

While the face is selected it can be driven by hand as `window.<face>`.
Compare each of these with the reference picture:

```js
sable.setState("submit");     // eyes open, eye contact: should match the picture
sable.lookAt(15, 5);          // irises turn; the whites and lashes stay put
sable.lookAt(-15, -5);
sable.lookAt(null);
sable.blink();                // lids meet; no eye shows through them
sable.setState("idle");       // eyes closed at rest: clean lids, a lash line
sable.setState("waiting");
sable.setGlyphIntensity(1);   // everything drawn in, painted glyphs included
sable.setState("done");       // glyphs dissolve
sable.setState(null);         // follow the chat again
```

Then run a real query, since the console cannot show how it follows the
stream.

What to look at:

- **At rest with eyes open** the head should be indistinguishable from the
  picture. A doubled edge or a seam means the fit is off: go back to step 3.
- **The irises** should sit where the painted ones were, at the same size.
  If not, check the iris marks.
- **The closed eyes** are where a new picture most often needs tuning.
- **The outline** of the head should never show against the hair or
  background while she moves.

### 8. Finish

```bash
npm run test:react
```

```bash
npm run typecheck
```

```bash
npm run lint:react
```

```bash
NODE_ENV=production npm run vite:build
```

The built bundle in `static/vite/` is committed, so rebuild it. Then:

- Add the face to the "Nova and Sable" section and the Appearance list in
  the README.
- Add its model's name to `static/models/ICT-FaceKit.LICENSE.txt`.
- Commit the picture and marks (`scripts/faces/`), the two layers
  (`static/img/`), the model (`static/models/`), the code edits and the
  bundle. The ICT-FaceKit cache is not part of the repository.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Landmark error of several per cent | A mark has the wrong index, or left and right are swapped | Check the indices against the table; remember "her right" is the viewer's left |
| Features doubled or sliding when she moves | The head does not line up with the paint | Improve the marks around that feature and re-bake |
| Irises too small, too large or off-centre | Iris marks are off, or `irisPlacement` is `"level"` | Re-mark the whole disc; use `"marked"` |
| Iris burnt out to white | The picture is bright where the iris was | Raise `iris.exposure`, lower the iris colours or `catchlight` |
| Iris dull or nearly black | The picture is dark there | Lower `iris.exposure` |
| A ring of the old iris around the new one | The marked radius is too small | Enlarge `radius` and re-run both scripts |
| Closed eyes still show the eye | The repainted area misses part of the painted eye | Check the eye-corner marks (36, 39, 42, 45); raise `lid.cover` |
| Bright or dark streaks on the closed lid | Lash-line pixels stretched over the unfolding lid | Raise `lid.cover` and `lid.blur` |
| Closed lids look like bright patches | The eyes light the skin around them | Lower `lid.shade` |
| Skin highlights light up with the glyphs | The glyph boxes caught them | Tighten boxes, raise `threshold`, or set `channel` |
| Painted glyphs barely visible when drawn in | Fine lines, or a small source picture | Raise `pictureGlyphGain`; use a larger copy of the picture |
| Nothing on screen | Assets missing or misnamed | The console logs "`<Label>` failed to load"; check the three files exist under the face's name |

## How it works

Enough to know where to look when a face needs something the settings do
not offer.

### The bake (`scripts/bake-face.mjs`)

ICT-FaceKit (MIT licence) is a linear face model: a neutral head, plus
weighted "identity" shapes that change whose face it is, plus weighted
expression shapes. The bake:

1. **Fits the head to the marks.** It solves for the head's pose, a mix of
   30 identity shapes and 18 expression shapes (jaw, lids, brows, lips) that
   bring the model's landmarks onto the marked ones, as seen by a fixed
   camera (20° field of view, 6 units away). Identity and expression weights
   are pulled gently toward zero so the fit does not chase marks that are
   only good to a pixel or two.
2. **Records where each skin vertex falls in the picture**, as a second set
   of UVs, with a *trust* value: high where the picture really shows that
   part of the surface, low where it faces away or is hidden (the far side
   of the nose, under the chin, the back of the head). Untrusted vertices
   take coordinates spread outward from trusted neighbours.
3. **Rescales each blink** so that a weight of 1 closes the eye the fit
   produced, which need not be as tall as the neutral one.
4. **Works out the eyes.** Each eyeball is a separate node pivoted at its
   centre. From the iris marks the bake computes the turn and iris size that
   put a drawn iris over the painted one.
5. **Writes a compact GLB**: skin, teeth and two eyeballs; the kit's 53
   expression shapes as sparse morph targets under their ARKit names; vertex
   data quantised. The fitted pose, the expression weights that complete the
   match (`restWeights`) and the 68 landmarks go in the scene's extras.

The skin also carries a first set of UVs, a cylindrical unwrap of the front
of the head, which is the space the live glyphs are laid out in.

### The picture layers (`scripts/prepare_face_picture.py`)

Glyphs are found inside the boxes as pixels that stand out from a blurred
copy of the picture, and painted out by letting the surrounding colour
diffuse in. The glyph layer is simply the original minus the painted-out
result, so adding it back reproduces the picture. The irises are then
painted out of the clean layer the same way.

### The component (`components/ProjectedFace.tsx`, `utils/faceShaders.ts`)

- **Same camera as the fit.** The renderer uses the camera the bake
  recorded, so the head at rest reproduces the picture. There are no lights
  and no tone mapping.
- **A backplate.** The picture itself stands behind the head and turns with
  it, supplying hair, ears, collar and background. The head fades into it
  wherever trust is low, so its outline never shows.
- **Skin.** Each fragment samples the picture at its vertex's recorded
  place. Because that place is fixed to the vertex, the paint moves with the
  skin.
- **Eyes.** The eyeball samples the picture where its surface currently is,
  so the white, the lashes across it and their shadow stay put while it
  turns. The iris, which was painted out, is drawn around the eyeball's own
  axis and lit by the brightness of the picture beneath it.
- **Closed lids.** In the picture the eyes are open, so the skin around
  each eye carries lash lines and slivers of eye. As a lid closes, that skin
  is repainted from the skin above and below the eye, and a lash line is
  drawn along the closed lid. Where the painted eye is in the picture is
  worked out from the eye-corner landmarks.
- **Rest weights.** Every expression shape starts from its weight in the
  fitted pose, so motion is always relative to how the picture looks.
- **Glyphs.** The painted ones are added back as light, drawn in outward
  from `revealFrom`. The live ones are drawn onto a 2D canvas, laid out from
  the model's landmarks, and used as a texture in the cylindrical UV space.
- **Cost.** Pixel ratio is capped, bloom runs at half resolution, the glyph
  canvas is redrawn less often than the frame, and nothing is drawn while
  she rests.

### Behaviour (`utils/faceMotion.ts`, `utils/faceGlyphs.ts`)

The lifecycle turns two signals from the chat (a response is being
generated; a chunk of text arrived) into the states `idle`, `submit`,
`waiting`, `streaming` and `done`. The motion model turns the state into a
pose: gaze, blinks, head noise, lips. The glyph model lays out the
constellation, traces, character columns and scan line for each query. All
three are pure and take their randomness as an argument, which is what lets
the unit tests step them deterministically.

### What is shared and what is per face

| Per face | Shared |
| --- | --- |
| Picture and marks in `scripts/faces/` | The two build scripts and the two marking helpers |
| Two layers in `static/img/`, model in `static/models/` | `ProjectedFace.tsx`, shaders, motion, glyphs |
| One `FACES` entry in `utils/faceConfigs.ts` | Lifecycle, quality levels, console API |
| Three one-line registrations | Styling (`.projected-face`), tests |

A few things are shared constants that a very different picture might
strain: the neck pivot the head turns about and the size of the repainted
area around each eye relative to the eye corners (`ProjectedFace.tsx`), the
lamp direction for the catchlight (`faceShaders.ts`), and the colours of
the live glyphs (`faceGlyphs.ts`). If a face needs one of them changed, make it a field of
`FaceConfig` with the current value as both existing faces' setting, rather
than branching on the face's name.

## The faces so far

| | Nova | Sable |
| --- | --- | --- |
| Source picture | 256 px PNG | 512 px JPEG |
| Fitted pose (yaw, pitch, roll) | −13.2°, −10.5°, −1.4° | 7.9°, −9.1°, −4.3° |
| Landmark error | 0.79% of width | 0.87% of width |
| Painted glyphs | A constellation on one cheek, marks on the other cheekbone and the forehead | Circuit marks under one eye and across that cheek, dots under the other |
| Eyes | In shadow, violet to blue | Glowing electric blue |
| Iris placement | `level` | `marked` |
| Lid repaint | Over the painted eye only | Whole lid, darker |
| Model size | 2.4 MB | 2.4 MB |
