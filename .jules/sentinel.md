## 2025-02-13 - [Prevent XSS in Comparator UI Stream List]
**Vulnerability:** XSS vulnerability in `comparator_ui.js` and `comparator_integrated.js` where user-controlled variables (`s.label`, `s.count`, `sym`) were being directly concatenated and inserted into the DOM via `innerHTML` without prior sanitization. This allowed execution of malicious scripts if external documents or localStorage contained injected payloads.
**Learning:** `innerHTML` concatenations are susceptible to XSS if not properly escaped, specifically because parsed docx files/localStorage configurations can be manipulated.
**Prevention:** Explicitly use an `escapeHtml()` function to escape essential characters (`&`, `<`, `>`, `"`) before injecting dynamically generated text content into `innerHTML` statements.

## 2025-02-27 - [Standalone HTML XSS Prevention]
**Vulnerability:** XSS vulnerabilities in `apps-script-export-sanitized/Index.html` due to unescaped user-supplied variables concatenated into `innerHTML` statements and inline JS event handlers (e.g. `onclick`).
**Learning:** Standalone HTML files (like those deployed to Google Apps Script or external environments) cannot rely on ES module imports for shared utility functions. These environments require inline implementations of security utilities like `escapeHtml` and `escapeJsQuote` to prevent XSS. Furthermore, data embedded into JS execution strings (like `onclick` attributes) needs separate JS string escaping in addition to or instead of standard HTML escaping.
**Prevention:** Implement inline sanitization functions directly inside the `<script>` tag of standalone HTML files. Explicitly escape dynamic data passed to `innerHTML` with `escapeHtml` and use `escapeJsQuote` inside inline event handlers strings.

## 2025-02-27 - [Event Handler XSS Double Escaping]
**Vulnerability:** Even when using `escapeJsQuote` for variables inserted into inline HTML event handlers (e.g. `onclick="doThing(' + escapeJsQuote(val) + ')"`), XSS breakouts are still possible because the browser decodes HTML entities before JavaScript parsing. An input like `&#39;` bypasses JS quote escaping but decodes to a raw quote, allowing execution escape.
**Learning:** For dynamic variables embedded within JS event handlers mapped directly inside HTML elements, the variable must be both JS-escaped AND HTML-escaped (`escapeHtml(escapeJsQuote(val))`) to ensure safety against entity decoding bypasses.
**Prevention:** Apply `escapeHtml(escapeJsQuote(variable))` whenever interpolating strings into `on*` inline event handlers inside `innerHTML`.
