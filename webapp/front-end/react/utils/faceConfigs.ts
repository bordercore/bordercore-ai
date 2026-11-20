/**
 * The faces the ProjectedFace component can show.
 *
 * Every face is the same machinery around a different picture: a head model
 * baked by scripts/bake-face.mjs and two picture layers written by
 * scripts/prepare_face_picture.py, both from the marks in
 * scripts/faces/<id>.json. What is left to say here is the little that
 * cannot be read off the picture.
 */

export type FaceId = "nova" | "sable";

/** Linear red, green and blue; values above one are picked up by the bloom. */
type Rgb = [number, number, number];

export interface IrisStyle {
  /** Colour next to the pupil. */
  inner: Rgb;
  /** Colour at the rim. */
  outer: Rgb;
  /** Radius of the pupil as a fraction of the iris. */
  pupil: number;
  pupilColor: Rgb;
  /** How far the iris darkens toward its rim, 0 to 1. */
  limbal: number;
  /**
   * Brightness of the picture, where the iris was painted out, at which the
   * iris shows at full strength. The lashes' shadow dims it from there.
   */
  exposure: number;
  /** Strength of the highlight on the eye, 0 to 1. */
  catchlight: number;
}

/** How the skin of a closed eyelid is made up from the picture. */
export interface LidStyle {
  /**
   * How far the skin above and below the eye is blurred before it is spread
   * over the lid, as a mipmap level of the picture. Higher where lashes or
   * make-up there would otherwise streak across it.
   */
  blur: number;
  /** Brightness of the lid against that skin, 0 to 1. */
  shade: number;
  /**
   * How much of the lid itself is made up that way, 0 to 1, beyond the part
   * that lies over the painted eye. Higher where the picture's lash line is
   * bright and would otherwise show on the lid as it unfolds.
   */
  cover: number;
}

export interface FaceConfig {
  /** Name shown in messages. */
  label: string;
  /** The baked head model. */
  model: string;
  /** The picture with its glyphs and irises painted out. */
  picture: string;
  /** The glyphs that were painted on the picture, on black. */
  pictureGlyphs: string;
  /**
   * The cheek, from the viewer's side, that the live constellation is drawn
   * on: the one the picture's own glyphs leave freer.
   */
  constellationSide: "left" | "right";
  /**
   * Where in the picture its own glyphs start to draw in from, as fractions
   * of its width and height from the top-left corner.
   */
  revealFrom: [number, number];
  /**
   * Strength of the picture's own glyphs once drawn in; above 1 so the
   * bloom picks them up, and higher the finer their lines are.
   */
  pictureGlyphGain: number;
  /** How far the lips are parted at rest: 1 is as painted, 0 is closed. */
  mouthOpenness: number;
  /**
   * Where the drawn irises sit when she looks at the viewer. "marked" turns
   * each eye, and sizes its iris, to cover the iris marked on the picture.
   * "level" turns both eyes straight back against the turn of the head and
   * draws the irises at a fixed size.
   */
  irisPlacement: "marked" | "level";
  iris: IrisStyle;
  lid: LidStyle;
}

const assets = (id: FaceId) => ({
  model: `/static/models/${id}.glb`,
  picture: `/static/img/${id}.jpg`,
  pictureGlyphs: `/static/img/${id}-glyphs.jpg`,
});

export const FACES: Record<FaceId, FaceConfig> = {
  nova: {
    label: "Nova",
    ...assets("nova"),
    constellationSide: "left",
    revealFrom: [0.664, 0.457],
    pictureGlyphGain: 1.25,
    mouthOpenness: 0.25,
    irisPlacement: "level",
    // Violet-pink at the pupil to blue at the rim, in shadow.
    iris: {
      inner: [0.6, 0.12, 0.62],
      outer: [0.14, 0.1, 0.75],
      pupil: 0.4,
      pupilColor: [0.02, 0.0, 0.012],
      limbal: 0.8,
      exposure: 0.11,
      catchlight: 1,
    },
    lid: { blur: 3.5, shade: 0.9, cover: 0 },
  },
  sable: {
    label: "Sable",
    ...assets("sable"),
    constellationSide: "right",
    revealFrom: [0.3, 0.36],
    pictureGlyphGain: 2.4,
    mouthOpenness: 0.25,
    irisPlacement: "marked",
    // Lit from within: pale cyan at the pupil to electric blue at the rim.
    iris: {
      inner: [0.0, 0.3, 1.3],
      outer: [0.0, 0.09, 0.95],
      pupil: 0.22,
      pupilColor: [0.0, 0.004, 0.03],
      limbal: 0.55,
      exposure: 0.3,
      catchlight: 0.4,
    },
    // Her eyes light the skin around them, so the closed lids are drawn a
    // good deal darker than it.
    lid: { blur: 5.5, shade: 0.6, cover: 1 },
  },
};

export function isFaceId(value: string): value is FaceId {
  return Object.prototype.hasOwnProperty.call(FACES, value);
}
