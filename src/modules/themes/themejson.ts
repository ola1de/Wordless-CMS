/**
 * theme.json engine (Milestone 5).
 *
 * Parses + validates theme.json versions 1–3, resolves presets to CSS
 * custom properties, and generates the theme stylesheet. Pure functions —
 * no D1, no R2 — so they are unit-testable in isolation.
 *
 * Support matrix (this engine, documented in docs/themes/theme-support.md):
 * - v3: everything below is supported.
 * - v2: everything below EXCEPT `settings.typography.writingMode` and
 *   per-block `elements` inside `styles.blocks.*` (v3 additions) — those
 *   are recorded as unsupported warnings, not errors.
 * - v1: partial — `customTemplates`, `templateParts`, `patterns`,
 *   per-block settings (`settings.blocks`), per-block styles
 *   (`styles.blocks`) and `settings.custom` are NOT supported; they are
 *   recorded as unsupported warnings and ignored.
 *
 * `patterns` are recorded, never executed: a pattern is a reusable block
 * fragment, and rendering patterns is out of scope for v1 of the visual
 * editor (see ARCHITECTURE.md).
 */

export type ThemeJsonVersion = 1 | 2 | 3;

export interface ThemeJsonIssue {
  path: string;
  message: string;
}

export interface ParsedThemeJson {
  version: ThemeJsonVersion;
  /** The raw theme.json object (settings/styles as parsed). */
  theme: Record<string, unknown>;
  settings: Record<string, unknown>;
  styles: Record<string, unknown>;
  customTemplates: Array<Record<string, unknown>>;
  templateParts: Array<Record<string, unknown>>;
  patterns: string[];
  errors: ThemeJsonIssue[];
  warnings: ThemeJsonIssue[];
  /** Feature names the engine does not support for this version. */
  unsupported: string[];
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG_RE.test(value);
}

function isColor(value: unknown): boolean {
  if (typeof value !== "string" || value.trim() === "") return false;
  const v = value.trim();
  if (v.startsWith("#")) return HEX_COLOR_RE.test(v);
  // Functional colours (rgb()/hsl()/color-mix()/var()) and named colours.
  return v.includes("(") || /^[a-zA-Z]+$/.test(v);
}

function cssVarName(...parts: string[]): string {
  return `--wp--${parts.join("--")}`;
}

/** `var:preset|color|accent-1` → `var(--wp--preset--color--accent-1)`. */
export function resolvePresetValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("var:preset|")) return trimmed;
  const parts = trimmed.slice("var:preset|".length).split("|");
  const [kind, ...rest] = parts;
  if (kind === undefined || rest.length === 0) return trimmed;
  if (kind === "custom") return `var(${cssVarName("custom", ...rest)})`;
  return `var(${cssVarName("preset", kind, ...rest)})`;
}

/** cyrb53 — small deterministic sync hash (URL versioning, not security). */
export function stylesheetHash(css: string): string {
  let h1 = 0xdeadbeef ^ css.length;
  let h2 = 0x41c6ce57 ^ css.length;
  for (let i = 0; i < css.length; i++) {
    const ch = css.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0")).slice(0, 12);
}

interface Validator {
  errors: ThemeJsonIssue[];
  warnings: ThemeJsonIssue[];
  unsupported: string[];
}

function checkSlugEntry(v: Validator, entry: unknown, path: string, fields: string[]): void {
  if (!isObject(entry)) {
    v.errors.push({ path, message: "Must be an object." });
    return;
  }
  if (!isSlug(entry.slug)) {
    v.errors.push({ path: `${path}.slug`, message: "Must be a lowercase slug (letters, digits, hyphens)." });
  }
  for (const field of fields) {
    const value = entry[field];
    if (value === undefined) {
      v.errors.push({ path: `${path}.${field}`, message: `Missing required field "${field}".` });
    } else if (typeof value !== "string" || value.trim() === "") {
      v.errors.push({ path: `${path}.${field}`, message: `Must be a non-empty string.` });
    }
  }
}

function validatePalette(v: Validator, palette: unknown, path: string): void {
  if (!Array.isArray(palette)) {
    v.errors.push({ path, message: "Must be an array of {slug, color, name} entries." });
    return;
  }
  palette.forEach((entry, i) => {
    const p = `${path}[${i}]`;
    checkSlugEntry(v, entry, p, ["name"]);
    if (isObject(entry) && entry.color !== undefined && !isColor(entry.color)) {
      v.errors.push({ path: `${p}.color`, message: "Must be a CSS colour (#hex, rgb(), hsl(), color-mix(), var() or a named colour)." });
    }
    if (isObject(entry) && entry.color === undefined) {
      v.errors.push({ path: `${p}.color`, message: 'Missing required field "color".' });
    }
  });
}

function validateSettings(v: Validator, settings: unknown, version: ThemeJsonVersion, path: string): void {
  if (!isObject(settings)) {
    v.errors.push({ path, message: "Must be an object." });
    return;
  }
  const color = settings.color;
  if (color !== undefined) {
    if (!isObject(color)) {
      v.errors.push({ path: `${path}.color`, message: "Must be an object." });
    } else {
      if (color.palette !== undefined) validatePalette(v, color.palette, `${path}.color.palette`);
      if (color.gradients !== undefined) {
        if (!Array.isArray(color.gradients)) {
          v.errors.push({ path: `${path}.color.gradients`, message: "Must be an array of {slug, gradient, name} entries." });
        } else {
          color.gradients.forEach((entry, i) => checkSlugEntry(v, entry, `${path}.color.gradients[${i}]`, ["gradient", "name"]));
        }
      }
      if (color.duotone !== undefined) {
        if (!Array.isArray(color.duotone)) {
          v.errors.push({ path: `${path}.color.duotone`, message: "Must be an array of {slug, colors, name} entries." });
        } else {
          color.duotone.forEach((entry, i) => {
            const p = `${path}.color.duotone[${i}]`;
            checkSlugEntry(v, entry, p, ["name"]);
            if (isObject(entry) && !Array.isArray(entry.colors)) {
              v.errors.push({ path: `${p}.colors`, message: "Must be an array of colours." });
            }
          });
        }
      }
    }
  }
  const typography = settings.typography;
  if (typography !== undefined) {
    if (!isObject(typography)) {
      v.errors.push({ path: `${path}.typography`, message: "Must be an object." });
    } else {
      if (typography.writingMode !== undefined && version < 3) {
        v.unsupported.push("settings.typography.writingMode (theme.json v3 only)");
        v.warnings.push({ path: `${path}.typography.writingMode`, message: "Not supported before theme.json v3; ignored." });
      }
      if (typography.fontSizes !== undefined) {
        if (!Array.isArray(typography.fontSizes)) {
          v.errors.push({ path: `${path}.typography.fontSizes`, message: "Must be an array of {slug, size, name} entries." });
        } else {
          typography.fontSizes.forEach((entry, i) => {
            const p = `${path}.typography.fontSizes[${i}]`;
            checkSlugEntry(v, entry, p, ["name"]);
            if (isObject(entry)) {
              if (entry.size === undefined) {
                v.errors.push({ path: `${p}.size`, message: 'Missing required field "size".' });
              } else if (typeof entry.size === "string" && entry.size.trim() === "") {
                v.errors.push({ path: `${p}.size`, message: "Must be a non-empty size." });
              } else if (typeof entry.size !== "string" && typeof entry.size !== "number") {
                v.errors.push({ path: `${p}.size`, message: "Must be a size string (e.g. \"1rem\") or a number." });
              }
              if (entry.fluid !== undefined) {
                const fluid = entry.fluid;
                if (fluid !== false && !isObject(fluid)) {
                  v.errors.push({ path: `${p}.fluid`, message: "Must be false or an object {min, max}." });
                } else if (isObject(fluid) && (typeof fluid.min !== "string" || typeof fluid.max !== "string")) {
                  v.errors.push({ path: `${p}.fluid`, message: 'Fluid sizes need string "min" and "max" (e.g. "1rem" / "1.5rem").' });
                }
              }
            }
          });
        }
      }
      if (typography.fontFamilies !== undefined) {
        if (!Array.isArray(typography.fontFamilies)) {
          v.errors.push({ path: `${path}.typography.fontFamilies`, message: "Must be an array of {slug, fontFamily, name} entries." });
        } else {
          typography.fontFamilies.forEach((entry, i) =>
            checkSlugEntry(v, entry, `${path}.typography.fontFamilies[${i}]`, ["fontFamily", "name"]),
          );
        }
      }
    }
  }
  const spacing = settings.spacing;
  if (spacing !== undefined) {
    if (!isObject(spacing)) {
      v.errors.push({ path: `${path}.spacing`, message: "Must be an object." });
    } else {
      if (spacing.spacingSizes !== undefined) {
        if (!Array.isArray(spacing.spacingSizes)) {
          v.errors.push({ path: `${path}.spacing.spacingSizes`, message: "Must be an array of {slug, size, name} entries." });
        } else {
          spacing.spacingSizes.forEach((entry, i) =>
            checkSlugEntry(v, entry, `${path}.spacing.spacingSizes[${i}]`, ["size", "name"]),
          );
        }
      }
      if (spacing.units !== undefined && !Array.isArray(spacing.units)) {
        v.errors.push({ path: `${path}.spacing.units`, message: "Must be an array of unit strings." });
      }
    }
  }
  const layout = settings.layout;
  if (layout !== undefined) {
    if (!isObject(layout)) {
      v.errors.push({ path: `${path}.layout`, message: "Must be an object." });
    } else {
      for (const key of ["contentSize", "wideSize"]) {
        if (layout[key] !== undefined && typeof layout[key] !== "string") {
          v.errors.push({ path: `${path}.layout.${key}`, message: "Must be a size string (e.g. \"680px\")." });
        }
      }
    }
  }
  if (settings.custom !== undefined) {
    if (version < 2) {
      v.unsupported.push("settings.custom (theme.json v2+)");
      v.warnings.push({ path: `${path}.custom`, message: "Not supported in theme.json v1; ignored." });
    } else if (!isObject(settings.custom)) {
      v.errors.push({ path: `${path}.custom`, message: "Must be an object of custom values." });
    }
  }
  if (settings.blocks !== undefined && version < 2) {
    v.unsupported.push("settings.blocks (theme.json v2+)");
    v.warnings.push({ path: `${path}.blocks`, message: "Per-block settings are not supported in theme.json v1; ignored." });
  }
}

function validateStyleObject(v: Validator, styles: unknown, path: string, version: ThemeJsonVersion, allowElements: boolean): void {
  if (!isObject(styles)) {
    v.errors.push({ path, message: "Must be an object." });
    return;
  }
  const color = styles.color;
  if (color !== undefined && !isObject(color)) {
    v.errors.push({ path: `${path}.color`, message: "Must be an object." });
  }
  const typography = styles.typography;
  if (typography !== undefined && !isObject(typography)) {
    v.errors.push({ path: `${path}.typography`, message: "Must be an object." });
  }
  const spacing = styles.spacing;
  if (spacing !== undefined && !isObject(spacing)) {
    v.errors.push({ path: `${path}.spacing`, message: "Must be an object." });
  }
  const elements = styles.elements;
  if (elements !== undefined) {
    if (!allowElements) {
      v.unsupported.push("styles.elements (theme.json v2+)");
      v.warnings.push({ path: `${path}.elements`, message: "Element styles are not supported in theme.json v1; ignored." });
    } else if (!isObject(elements)) {
      v.errors.push({ path: `${path}.elements`, message: "Must be an object keyed by element name (link, heading, button, h1–h6)." });
    } else {
      for (const [name, el] of Object.entries(elements)) {
        if (!isObject(el)) {
          v.errors.push({ path: `${path}.elements.${name}`, message: "Must be a style object." });
        }
      }
    }
  }
}

function validateStyles(v: Validator, styles: unknown, version: ThemeJsonVersion, path: string): void {
  if (!isObject(styles)) {
    v.errors.push({ path, message: "Must be an object." });
    return;
  }
  validateStyleObject(v, styles, path, version, version >= 2);
  const blocks = styles.blocks;
  if (blocks !== undefined) {
    if (version < 2) {
      v.unsupported.push("styles.blocks (theme.json v2+)");
      v.warnings.push({ path: `${path}.blocks`, message: "Per-block styles are not supported in theme.json v1; ignored." });
    } else if (!isObject(blocks)) {
      v.errors.push({ path: `${path}.blocks`, message: "Must be an object keyed by block name." });
    } else {
      for (const [name, blockStyles] of Object.entries(blocks)) {
        const blockPath = `${path}.blocks.${name}`;
        if (!isObject(blockStyles)) {
          v.errors.push({ path: blockPath, message: "Must be a style object." });
          continue;
        }
        // Per-block `elements` arrived with theme.json v3.
        const hasBlockElements = blockStyles.elements !== undefined;
        if (hasBlockElements && version < 3) {
          v.unsupported.push(`styles.blocks.${name}.elements (theme.json v3 only)`);
          v.warnings.push({ path: `${blockPath}.elements`, message: "Per-block element styles are not supported before theme.json v3; ignored." });
        }
        const { elements, ...rest } = blockStyles;
        void elements;
        validateStyleObject(v, rest, blockPath, version, true);
      }
    }
  }
}

/** Validate a partial `settings` object (customizer variations reuse this). */
export function validateThemeSettings(settings: unknown, version: ThemeJsonVersion = 3): ThemeJsonIssue[] {
  const v: Validator = { errors: [], warnings: [], unsupported: [] };
  if (!isObject(settings)) {
    return [{ path: "settings", message: "Must be an object." }];
  }
  validateSettings(v, settings, version, "settings");
  return v.errors;
}

/** Parse + validate a theme.json value. Never throws on bad input. */
export function parseThemeJson(raw: unknown): ParsedThemeJson {
  const v: Validator = { errors: [], warnings: [], unsupported: [] };
  if (!isObject(raw)) {
    return {
      version: 3,
      theme: {},
      settings: {},
      styles: {},
      customTemplates: [],
      templateParts: [],
      patterns: [],
      errors: [{ path: "", message: "theme.json must be a JSON object." }],
      warnings: [],
      unsupported: [],
    };
  }
  const versionRaw = raw.version;
  const version: ThemeJsonVersion = versionRaw === 1 || versionRaw === 2 || versionRaw === 3 ? versionRaw : 3;
  if (versionRaw !== 1 && versionRaw !== 2 && versionRaw !== 3) {
    v.errors.push({ path: "version", message: "Must be 1, 2 or 3." });
  }
  const settings = isObject(raw.settings) ? raw.settings : {};
  if (raw.settings !== undefined && !isObject(raw.settings)) {
    v.errors.push({ path: "settings", message: "Must be an object." });
  } else if (isObject(raw.settings)) {
    validateSettings(v, raw.settings, version, "settings");
  }
  const styles = isObject(raw.styles) ? raw.styles : {};
  if (raw.styles !== undefined && !isObject(raw.styles)) {
    v.errors.push({ path: "styles", message: "Must be an object." });
  } else if (isObject(raw.styles)) {
    validateStyles(v, raw.styles, version, "styles");
  }
  const customTemplates = Array.isArray(raw.customTemplates)
    ? (raw.customTemplates.filter((t) => isObject(t)) as Array<Record<string, unknown>>)
    : [];
  if (raw.customTemplates !== undefined) {
    if (!Array.isArray(raw.customTemplates)) {
      v.errors.push({ path: "customTemplates", message: "Must be an array." });
    } else if (version < 2) {
      v.unsupported.push("customTemplates (theme.json v2+)");
      v.warnings.push({ path: "customTemplates", message: "Not supported in theme.json v1; ignored." });
    }
  }
  const templateParts = Array.isArray(raw.templateParts)
    ? (raw.templateParts.filter((t) => isObject(t)) as Array<Record<string, unknown>>)
    : [];
  if (raw.templateParts !== undefined) {
    if (!Array.isArray(raw.templateParts)) {
      v.errors.push({ path: "templateParts", message: "Must be an array." });
    } else if (version < 2) {
      v.unsupported.push("templateParts (theme.json v2+)");
      v.warnings.push({ path: "templateParts", message: "Not supported in theme.json v1; ignored." });
    }
  }
  let patterns: string[] = [];
  if (raw.patterns !== undefined) {
    if (Array.isArray(raw.patterns)) {
      patterns = raw.patterns.filter((p) => typeof p === "string") as string[];
    } else {
      v.errors.push({ path: "patterns", message: "Must be an array of pattern slugs." });
    }
    if (version < 2) {
      v.unsupported.push("patterns (theme.json v2+)");
      v.warnings.push({ path: "patterns", message: "Not supported in theme.json v1; ignored." });
    }
  }
  for (const key of Object.keys(raw)) {
    if (!["$schema", "version", "settings", "styles", "customTemplates", "templateParts", "patterns"].includes(key)) {
      v.warnings.push({ path: key, message: `Unknown top-level key "${key}"; ignored.` });
    }
  }
  return {
    version,
    theme: raw,
    settings,
    styles,
    customTemplates,
    templateParts,
    patterns,
    errors: v.errors,
    warnings: v.warnings,
    unsupported: [...new Set(v.unsupported)],
  };
}

// ------------------------------------------------------------------ CSS output

function presetSize(size: unknown, fontSizes: Array<Record<string, unknown>>): string | null {
  if (typeof size !== "string") return null;
  if (size.startsWith("var:")) return resolvePresetValue(size);
  const match = fontSizes.find((f) => f.slug === size);
  if (match !== undefined) return `var(--wp--preset--font-size--${size})`;
  return size;
}

function fluidClamp(fluid: { min: string; max: string }): string {
  // WordPress fluid formula, fixed viewport range 20rem–75rem.
  return `clamp(${fluid.min}, calc(${fluid.min} + (${fluid.max} - ${fluid.min}) * ((100vw - 20rem) / 55rem)), ${fluid.max})`;
}

function flattenCustom(obj: Record<string, unknown>, prefix: string[], out: Array<[string, string]>): void {
  for (const key of Object.keys(obj).sort()) {
    const value = obj[key];
    if (value === undefined) continue;
    const path = [...prefix, key];
    if (isObject(value)) {
      flattenCustom(value, path, out);
    } else if (typeof value === "string" || typeof value === "number") {
      out.push([`--wp--custom--${path.join("--")}`, String(value)]);
    }
  }
}

function styleProps(style: Record<string, unknown>, fontSizes: Array<Record<string, unknown>>): string[] {
  const props: string[] = [];
  const color = isObject(style.color) ? style.color : {};
  if (typeof color.background === "string") props.push(`background-color: ${resolvePresetValue(color.background)}`);
  if (typeof color.gradient === "string") props.push(`background: ${resolvePresetValue(color.gradient)}`);
  if (typeof color.text === "string") props.push(`color: ${resolvePresetValue(color.text)}`);
  const typo = isObject(style.typography) ? style.typography : {};
  if (typeof typo.fontFamily === "string") props.push(`font-family: ${resolvePresetValue(typo.fontFamily)}`);
  if (typo.fontSize !== undefined) {
    const resolved = presetSize(typo.fontSize, fontSizes);
    if (resolved !== null) props.push(`font-size: ${resolved}`);
  }
  if (typeof typo.lineHeight === "string" || typeof typo.lineHeight === "number") props.push(`line-height: ${typo.lineHeight}`);
  if (typeof typo.fontWeight === "string" || typeof typo.fontWeight === "number") props.push(`font-weight: ${typo.fontWeight}`);
  if (typeof typo.fontStyle === "string") props.push(`font-style: ${typo.fontStyle}`);
  if (typeof typo.letterSpacing === "string") props.push(`letter-spacing: ${typo.letterSpacing}`);
  if (typeof typo.textTransform === "string") props.push(`text-transform: ${typo.textTransform}`);
  if (typeof typo.textDecoration === "string") props.push(`text-decoration: ${typo.textDecoration}`);
  const spacing = isObject(style.spacing) ? style.spacing : {};
  for (const key of ["padding", "margin"] as const) {
    const value = spacing[key];
    if (typeof value === "string") {
      props.push(`${key}: ${resolvePresetValue(value)}`);
    } else if (isObject(value)) {
      for (const side of ["top", "right", "bottom", "left"] as const) {
        if (typeof value[side] === "string") {
          props.push(`${key}-${side}: ${resolvePresetValue(value[side] as string)}`);
        }
      }
    }
  }
  return props;
}

function elementProps(el: Record<string, unknown>, fontSizes: Array<Record<string, unknown>>): string[] {
  return styleProps(el, fontSizes);
}

/** Generate the deterministic stylesheet for a parsed theme.json. */
export function generateThemeCss(parsed: ParsedThemeJson): string {
  const { settings, styles } = parsed;
  const lines: string[] = [];
  const rootVars: string[] = [];

  const color = isObject(settings.color) ? settings.color : {};
  if (Array.isArray(color.palette)) {
    for (const entry of color.palette as Array<Record<string, unknown>>) {
      if (isSlug(entry.slug) && typeof entry.color === "string") {
        rootVars.push(`  ${cssVarName("preset", "color", entry.slug)}: ${entry.color};`);
      }
    }
  }
  if (Array.isArray(color.gradients)) {
    for (const entry of color.gradients as Array<Record<string, unknown>>) {
      if (isSlug(entry.slug) && typeof entry.gradient === "string") {
        rootVars.push(`  ${cssVarName("preset", "gradient", entry.slug)}: ${entry.gradient};`);
      }
    }
  }
  const typo = isObject(settings.typography) ? settings.typography : {};
  const fontSizes = Array.isArray(typo.fontSizes) ? (typo.fontSizes as Array<Record<string, unknown>>) : [];
  for (const entry of fontSizes) {
    if (!isSlug(entry.slug)) continue;
    if (isObject(entry.fluid) && typeof entry.fluid.min === "string" && typeof entry.fluid.max === "string") {
      rootVars.push(`  ${cssVarName("preset", "font-size", entry.slug)}: ${fluidClamp(entry.fluid as { min: string; max: string })};`);
    } else if (typeof entry.size === "string" || typeof entry.size === "number") {
      rootVars.push(`  ${cssVarName("preset", "font-size", entry.slug)}: ${entry.size};`);
    }
  }
  if (Array.isArray(typo.fontFamilies)) {
    for (const entry of typo.fontFamilies as Array<Record<string, unknown>>) {
      if (isSlug(entry.slug) && typeof entry.fontFamily === "string") {
        rootVars.push(`  ${cssVarName("preset", "font-family", entry.slug)}: ${entry.fontFamily};`);
      }
    }
  }
  const spacing = isObject(settings.spacing) ? settings.spacing : {};
  if (Array.isArray(spacing.spacingSizes)) {
    for (const entry of spacing.spacingSizes as Array<Record<string, unknown>>) {
      if (isSlug(entry.slug) && (typeof entry.size === "string" || typeof entry.size === "number")) {
        rootVars.push(`  ${cssVarName("preset", "spacing", entry.slug)}: ${entry.size};`);
      }
    }
  }
  const layout = isObject(settings.layout) ? settings.layout : {};
  if (typeof layout.contentSize === "string") {
    rootVars.push(`  --wp--style--global--content-size: ${layout.contentSize};`);
  }
  if (typeof layout.wideSize === "string") {
    rootVars.push(`  --wp--style--global--wide-size: ${layout.wideSize};`);
  }
  if (isObject(styles.spacing) && typeof styles.spacing.blockGap === "string") {
    rootVars.push(`  --wp--style--block-gap: ${styles.spacing.blockGap};`);
  }
  if (isObject(settings.custom)) {
    const flat: Array<[string, string]> = [];
    flattenCustom(settings.custom, [], flat);
    for (const [name, value] of flat) rootVars.push(`  ${name}: ${value};`);
  }
  if (rootVars.length > 0) {
    lines.push(":root {");
    lines.push(...rootVars);
    lines.push("}");
  }

  const bodyProps = styleProps(styles, fontSizes);
  if (bodyProps.length > 0) {
    lines.push("body {");
    for (const prop of bodyProps) lines.push(`  ${prop};`);
    lines.push("}");
  }

  const elements = isObject(styles.elements) ? styles.elements : {};
  if (isObject(elements.link)) {
    const props = elementProps(elements.link, fontSizes);
    if (props.length > 0) {
      lines.push("a {");
      for (const prop of props) lines.push(`  ${prop};`);
      lines.push("}");
    }
  }
  if (isObject(elements.heading)) {
    const props = elementProps(elements.heading, fontSizes);
    if (props.length > 0) {
      lines.push("h1, h2, h3, h4, h5, h6 {");
      for (const prop of props) lines.push(`  ${prop};`);
      lines.push("}");
    }
  }
  for (const level of ["h1", "h2", "h3", "h4", "h5", "h6"] as const) {
    const el = elements[level];
    if (isObject(el)) {
      const props = elementProps(el, fontSizes);
      if (props.length > 0) {
        lines.push(`${level} {`);
        for (const prop of props) lines.push(`  ${prop};`);
        lines.push("}");
      }
    }
  }
  if (isObject(elements.button)) {
    const props = elementProps(elements.button, fontSizes);
    if (props.length > 0) {
      lines.push("button, .wp-element-button, input[type=\"submit\"] {");
      for (const prop of props) lines.push(`  ${prop};`);
      lines.push("}");
    }
  }

  const blocks = isObject(styles.blocks) ? styles.blocks : {};
  for (const name of Object.keys(blocks).sort()) {
    const blockStyles = blocks[name];
    if (!isObject(blockStyles)) continue;
    const { elements: _el, ...rest } = blockStyles;
    void _el;
    const props = styleProps(rest, fontSizes);
    if (props.length === 0) continue;
    const className = `wp-block-${name.replace(/^core\//, "").replace(/\//g, "-")}`;
    lines.push(`.${className} {`);
    for (const prop of props) lines.push(`  ${prop};`);
    lines.push("}");
  }

  if (typeof layout.contentSize === "string" || typeof layout.wideSize === "string") {
    lines.push("main, .wp-site-blocks {");
    if (typeof layout.contentSize === "string") {
      lines.push("  max-width: var(--wp--style--global--content-size);");
    }
    lines.push("  margin-left: auto;");
    lines.push("  margin-right: auto;");
    lines.push("}");
    if (typeof layout.wideSize === "string") {
      lines.push(".alignwide {");
      lines.push("  max-width: var(--wp--style--global--wide-size);");
      lines.push("}");
    }
  }

  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}

/**
 * Deep-merge variation settings over base settings. Arrays of
 * `{slug, …}` entries merge by slug (override wins per slug, new slugs
 * appended); other arrays replace; objects merge recursively.
 */
export function mergeThemeSettings(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key];
    if (isObject(value) && isObject(existing)) {
      out[key] = mergeThemeSettings(existing, value);
    } else if (Array.isArray(value) && Array.isArray(existing)) {
      const merged = [...existing] as Array<Record<string, unknown>>;
      for (const entry of value as Array<Record<string, unknown>>) {
        if (isObject(entry) && typeof entry.slug === "string") {
          const idx = merged.findIndex((e) => isObject(e) && e.slug === entry.slug);
          if (idx >= 0) merged[idx] = { ...merged[idx], ...entry };
          else merged.push(entry);
        } else {
          merged.push(entry);
        }
      }
      out[key] = merged;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Apply a variation's settings to a parsed theme and regenerate its CSS. */
export function generateThemeCssWithVariation(parsed: ParsedThemeJson, variation: Record<string, unknown>): string {
  const merged: ParsedThemeJson = {
    ...parsed,
    settings: mergeThemeSettings(parsed.settings, variation),
  };
  return generateThemeCss(merged);
}
