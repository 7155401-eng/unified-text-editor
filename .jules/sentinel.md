## 2025-02-13 - [Prevent XSS in Comparator UI Stream List]
**Vulnerability:** XSS vulnerability in `comparator_ui.js` and `comparator_integrated.js` where user-controlled variables (`s.label`, `s.count`, `sym`) were being directly concatenated and inserted into the DOM via `innerHTML` without prior sanitization. This allowed execution of malicious scripts if external documents or localStorage contained injected payloads.
**Learning:** `innerHTML` concatenations are susceptible to XSS if not properly escaped, specifically because parsed docx files/localStorage configurations can be manipulated.
**Prevention:** Explicitly use an `escapeHtml()` function to escape essential characters (`&`, `<`, `>`, `"`) before injecting dynamically generated text content into `innerHTML` statements.
