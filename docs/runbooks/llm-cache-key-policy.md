# LLM cache-key policy — multi-tenant safety

> Quick-reference rule for anyone adding or modifying LLM-cache writes
> (`server/repositories/system.repo.js` `llmCache.*`).
>
> Background: the `llm_cache` table has no `family_id` column. It's a
> global LRU keyed by an opaque cache_key string. The 2026-05-02
> multi-tenant audit (`docs/analyses/2026-05-02-multi-tenant-audit.md`)
> confirmed no active leaks today, but flagged the cache as a footgun
> if future code starts embedding per-family content in the prompt
> without including the family in the cache key.

---

## The rule

If the prompt that produced the cached value is conditioned on any
family-scoped data, the cache_key MUST include the family id.

Examples of family-scoped conditioning:

- The user's allergies, dislikes, or diet tags
- The family's roster (members + portion factors)
- A specific family's pantry contents, planned meals, or shopping list
- The family's recipe library (e.g. ingredient-similarity score)

Examples of inputs that do NOT need family in the cache_key:

- Plain recipe-name look-up (e.g. "kjøttdeig" → ingredient class)
- Generic ingredient normalisation (raw text → canonical product key)
- Plain image-OCR cache where the cached value is the literal text
- Public product-catalog enrichment from Kassal API

## Pattern

```js
// Good — generic input, no family conditioning, no family in key.
const key = `ingredient-norm:v3:${rawText}`;

// Good — family-scoped prompt, family explicit in key.
const familyId = getFamilyId();
const key = `recipe-suggest:v2:${familyId}:${query}`;

// Bad — family-scoped prompt, but family NOT in key.
//        Two families with identical query strings would share the
//        same cached response, leaking the first family's allergies
//        into the second family's render.
const key = `recipe-suggest:v2:${query}`;
```

## Where to enforce

There is no automated check today. Reviewers should challenge any
new LLM-cache write that:

- Reads `getFamilyId()` or any family-scoped repo in the prompt-build
  path
- Embeds member names, allergies, dislikes, diet tags, pantry
  productKeys, recipe ids, or shopping list items in the prompt

If the answer to "would two families produce different prompts?" is
yes, the cache_key needs `family_id`.

## Future hardening

Two options if the cache is ever re-architected:

1. Add `family_id INTEGER` to `llm_cache` and enforce a `(family_id,
   cache_key)` UNIQUE. Cleanest, but a migration; skip until a real
   bug forces it.
2. Standardise the cache helper to require `family_id` as a first
   argument and let it prefix the key automatically. Cheaper, no
   migration. Trade-off: doesn't help for genuinely-global caches
   (Kassal enrichment, generic normalisation).

For now, this doc is the policy.
