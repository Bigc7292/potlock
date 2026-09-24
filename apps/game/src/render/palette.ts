/**
 * "Night Quay, Hot Metal" palette. Every colour in the scene comes from here;
 * do not invent new hues in individual modules.
 */
export const PALETTE = {
  void: 0x07080c,
  wetConcrete: 0x1b1e24,
  rustSteel: 0x3a2a22,
  livery: 0xc45a12,
  sodium: 0xffb35a,
  cyan: 0x3ee0d4,
  combat: 0xe24b3b,
  lanceCore: 0xf6d36a,
  lanceRim: 0xffe9a8,
  fog: 0x0c1016,
  /** Neutral steels derived from the void/concrete ramp. */
  gunmetal: 0x23272e,
  nitride: 0x15171b,
  brass: 0x9c7a45,
  ceramic: 0x0d0e10,
  rubber: 0x121315,
  moon: 0x8fa6c8,
  beacon: 0xff2a1a,
} as const;

/**
 * Seat trim colours for seats 0-5. Kept within the palette family (cyan, sodium, combat red)
 * plus three desaturated partners so six players stay distinguishable without a rainbow.
 */
export const SEAT_TRIM = [0x3ee0d4, 0xffb35a, 0xe24b3b, 0x9fb8ff, 0xd7e86a, 0xf2f2f2] as const;

export function hex(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}
