## 2025-02-13 - [Prevent XSS in Comparator UI Stream List]
**Vulnerability:** XSS vulnerability in `comparator_ui.js` and `comparator_integrated.js` where user-controlled variables (`s.label`, `s.count`, `sym`) were being directly concatenated and inserted into the DOM via `innerHTML` without prior sanitization. This allowed execution of malicious scripts if external documents or localStorage contained injected payloads.
**Learning:** `innerHTML` concatenations are susceptible to XSS if not properly escaped, specifically because parsed docx files/localStorage configurations can be manipulated.
**Prevention:** Explicitly use an `escapeHtml()` function to escape essential characters (`&`, `<`, `>`, `"`) before injecting dynamically generated text content into `innerHTML` statements.
## 2026-07-05 - [Prevent XSS in Apps Script Template]
**Vulnerability:** XSS vulnerability in `apps-script-export-sanitized/Index.html` where user-controlled variables (customer id, name, email, status) were concatenated directly into `innerHTML` without escaping.
**Learning:** HTML templates used in Google Apps Script contexts require explicit string sanitization for all user-controlled data when rendering views via string concatenation, as they bypass standard frontend framework protections.
**Prevention:** Explicitly apply an `escapeHtml()` function (and `escapeJsQuote()` when inside inline JS handlers) to escape HTML entities before injecting text content into the DOM via `innerHTML`.
