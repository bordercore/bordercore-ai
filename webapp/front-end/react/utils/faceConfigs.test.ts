import { describe, expect, it } from "vitest";
import { FACES, isFaceId } from "./faceConfigs";

describe("isFaceId", () => {
  it("accepts every configured face", () => {
    for (const id of Object.keys(FACES)) expect(isFaceId(id)).toBe(true);
  });

  it("rejects other visualizations and inherited property names", () => {
    expect(isFaceId("cyberPortrait")).toBe(false);
    expect(isFaceId("toString")).toBe(false);
  });
});

describe("FACES", () => {
  it("points each face at its own baked assets", () => {
    for (const [id, face] of Object.entries(FACES)) {
      expect(face.model).toBe(`/static/models/${id}.glb`);
      expect(face.picture).toBe(`/static/img/${id}.jpg`);
      expect(face.pictureGlyphs).toBe(`/static/img/${id}-glyphs.jpg`);
    }
  });
});
