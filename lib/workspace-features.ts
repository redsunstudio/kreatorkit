/**
 * KreatorKit per-workspace module flags.
 *
 * `Workspace.features` is a JSON object of { [module]: boolean }.
 * Unset modules fall back to defaults below — `review` defaults ON so every
 * pre-KreatorKit workspace keeps working unchanged; new modules default OFF
 * and are switched on per client.
 */

export const KREATORKIT_MODULES = ['review', 'handoff', 'published', 'assets', 'reports'] as const;
export type KreatorKitModule = (typeof KREATORKIT_MODULES)[number];

const MODULE_DEFAULTS: Record<KreatorKitModule, boolean> = {
  review: true,
  handoff: false,
  published: true,
  assets: true,
  reports: false,
};

export function normalizeFeatures(raw: unknown): Record<KreatorKitModule, boolean> {
  const out = { ...MODULE_DEFAULTS };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const m of KREATORKIT_MODULES) {
      const v = (raw as Record<string, unknown>)[m];
      if (typeof v === 'boolean') out[m] = v;
    }
  }
  return out;
}

export function hasModule(
  workspace: { features?: unknown } | null | undefined,
  moduleName: KreatorKitModule
): boolean {
  return normalizeFeatures(workspace?.features)[moduleName];
}

/** Validate a PATCH payload; returns null when the shape is unacceptable. */
export function parseFeaturesInput(raw: unknown): Record<string, boolean> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(KREATORKIT_MODULES as readonly string[]).includes(k)) return null;
    if (typeof v !== 'boolean') return null;
    out[k] = v;
  }
  return out;
}
