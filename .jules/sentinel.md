## 2025-02-13 - [Prevent XSS in Comparator UI Stream List]
**Vulnerability:** XSS vulnerability in `comparator_ui.js` and `comparator_integrated.js` where user-controlled variables (`s.label`, `s.count`, `sym`) were being directly concatenated and inserted into the DOM via `innerHTML` without prior sanitization. This allowed execution of malicious scripts if external documents or localStorage contained injected payloads.
**Learning:** `innerHTML` concatenations are susceptible to XSS if not properly escaped, specifically because parsed docx files/localStorage configurations can be manipulated.
**Prevention:** Explicitly use an `escapeHtml()` function to escape essential characters (`&`, `<`, `>`, `"`) before injecting dynamically generated text content into `innerHTML` statements.
## 2026-05-24 - XSS Vulnerability in Comparator Tool
**Vulnerability:** XSS vulnerability in comparator_ui.js and comparator_integrated.js when building the UI markers. Input `s.sym` (marker symbols) were concatenated directly into the HTML without sanitization, allowing malicious script execution if the symbols in the imported  streams were manipulated.
**Learning:** In the standalone and integrated comparator components, a custom `escapeHtml` was declared in the scope of the respective files, but was not uniformly applied to all dynamic content injection points (like `bar.innerHTML += html`).
**Prevention:** Apply the local `escapeHtml` function to the `s.sym` variable before placing it into the HTML structure that is bound via `innerHTML`.
## 2026-05-24 - XSS Vulnerability in Comparator Tool
**Vulnerability:** XSS vulnerability in comparator_ui.js and comparator_integrated.js when building the UI markers. Input s.sym (marker symbols) were concatenated directly into the HTML without sanitization, allowing malicious script execution if the symbols in the imported docx streams were manipulated.
**Learning:** In the standalone and integrated comparator components, a custom escapeHtml was declared in the scope of the respective files, but was not uniformly applied to all dynamic content injection points (like bar.innerHTML += html).
**Prevention:** Apply the local escapeHtml function to the s.sym variable before placing it into the HTML structure that is bound via innerHTML.
