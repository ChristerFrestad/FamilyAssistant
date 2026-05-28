// Sprint 10 — runtime CSS-tokens for brand colors.
//
// `tokens.css` ships defaults that match the FamilyAssistant brand
// (--brand-primary: #1F3F26, etc.). For deploys that override the
// brand at runtime (Husby and friends) we re-emit the
// token block from the /api/config response and inject it as an
// inline <style> tag in <head>. CSS custom-property cascading lets
// the runtime override beat the static defaults without rewriting
// any rule.
//
// Why a function-returning-string instead of a CSS-in-JS framework:
// the bundle is dependency-free by design (DEL 7.4) and these tokens
// only need to be rendered once per app-mount. A 1-KB string template
// is plenty.

export interface BrandColorConfig {
  primaryColor: string;
  accentColor: string;
  dotColor: string;
}

// Light-mode + dark-mode token block. The non-color tokens (cream,
// muted, dark-bg, dark-accent) stay constant across deploys — they
// are part of the design system, not the brand-config surface.
export function brandTokensCss(config: BrandColorConfig): string {
  return `
:root {
  --brand-primary: ${config.primaryColor};
  --brand-accent: ${config.accentColor};
  --brand-dot: ${config.dotColor};
  --brand-cream: #F7F3E8;
  --brand-muted: #5F7A66;
  --brand-dark-bg: #1A2620;
  --brand-dark-accent: #9BC59A;
}
`.trim();
}

// Inserts the rendered token block as a <style> tag in <head>.
// Idempotent — calling twice replaces the previous tag instead of
// stacking. Returns the inserted node so callers can detach it
// (tests, hot-reload).
export function applyBrandTokens(config: BrandColorConfig): HTMLStyleElement {
  const id = 'brand-tokens';
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = brandTokensCss(config);
  return el;
}
