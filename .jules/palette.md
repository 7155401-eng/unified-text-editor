
## 2024-05-18 - Adding ARIA labels to icon-only buttons
**Learning:** In Hebrew interfaces (dir="rtl", lang="he"), screen readers rely heavily on aria-labels for icon-only buttons (like `❝`, `⟨/⟩`, `{ }`, `⛓⃠`, `👁`) that aren't semantically meaningful when read aloud. Also, when an icon button is used in multiple places (like the eye icon for revealing API keys), the `aria-label` needs to be specific enough to describe its context (e.g., "הצג/הסתר מפתח Anthropic" instead of just "הצג/הסתר").
**Action:** Always verify that buttons containing only symbols, emoji, or non-alphanumeric characters have an `aria-label` attribute in Hebrew, matching or expanding on their `title` attribute for proper accessibility context.
