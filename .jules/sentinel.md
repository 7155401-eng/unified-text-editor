## 2025-02-13 - [Prevent XSS in Comparator UI Stream List]
**Vulnerability:** XSS vulnerability in `comparator_ui.js` and `comparator_integrated.js` where user-controlled variables (`s.label`, `s.count`, `sym`) were being directly concatenated and inserted into the DOM via `innerHTML` without prior sanitization. This allowed execution of malicious scripts if external documents or localStorage contained injected payloads.
**Learning:** `innerHTML` concatenations are susceptible to XSS if not properly escaped, specifically because parsed docx files/localStorage configurations can be manipulated.
**Prevention:** Explicitly use an `escapeHtml()` function to escape essential characters (`&`, `<`, `>`, `"`) before injecting dynamically generated text content into `innerHTML` statements.

## 2024-05-18 - Prevent XSS in standalone scripts with inline escape functions
**Vulnerability:** Inline variables derived from user input or server responses injected directly into `innerHTML` strings (e.g. `c.name` and `c.email` in `apps-script-export-sanitized/Index.html`) were vulnerable to XSS.
**Learning:** For standalone files without access to ES modules, utility functions like `escapeHtml` and `escapeJsQuote` must be explicitly defined inline to prevent malicious input from compromising the UI or injecting logic.
**Prevention:** Always define context-appropriate escaping utilities (for HTML text injection and JS attribute injection) directly in standalone HTML files that dynamically construct their views using DOM APIs like `innerHTML`.
