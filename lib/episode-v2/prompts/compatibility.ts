/** v1.7 adds validated position/interaction fields; older snapshots remain readable. */
const preparationVersions: Record<string, readonly string[]> = {
  "casting-producer": ["1.0.0", "1.1.0", "1.2.0", "1.6.0", "1.7.0"],
  "independent-guest-preparation": ["1.0.0", "1.1.0", "1.2.0", "1.6.0", "1.7.0"],
  "responsive-host-preparation": ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.6.0", "1.7.0"],
};

export function compatiblePreparationPrompt(saved: { id: string; version: string } | null | undefined, expected: { id: string }) {
  return !!saved && saved.id === expected.id && !!preparationVersions[expected.id]?.includes(saved.version);
}
