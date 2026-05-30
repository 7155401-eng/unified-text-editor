
## 2024-05-30 - [Missing ARIA Labels on Toolbars]
**Learning:** Found multiple icon-only buttons (`h1`-`h6`, formatting size buttons), select menus, and standalone inputs in complex toolbars missing `aria-label`s, which hinders screen reader accessibility.
**Action:** Always verify `aria-label`s exist on all `<button>`, `<select>`, and `<input>` elements in newly created toolbars, especially when they lack visible text labels.
