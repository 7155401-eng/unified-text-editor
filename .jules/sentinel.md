## 2025-02-13 - [Prevent XSS in Comparator UI Stream List]
**Vulnerability:** XSS vulnerability in `comparator_ui.js` and `comparator_integrated.js` where user-controlled variables (`s.label`, `s.count`, `sym`) were being directly concatenated and inserted into the DOM via `innerHTML` without prior sanitization. This allowed execution of malicious scripts if external documents or localStorage contained injected payloads.
**Learning:** `innerHTML` concatenations are susceptible to XSS if not properly escaped, specifically because parsed docx files/localStorage configurations can be manipulated.
**Prevention:** Explicitly use an `escapeHtml()` function to escape essential characters (`&`, `<`, `>`, `"`) before injecting dynamically generated text content into `innerHTML` statements.

## 2025-02-14 - [Prevent XSS in Standalone Apps Script Exports]
**Vulnerability:** XSS vulnerability in `apps-script-export-sanitized/Index.html` where user-controlled inputs (such as user names, emails, customer IDs, and error messages returned by Google Apps Script endpoints) were concatenated directly into the DOM via `innerHTML` without sanitization. Because this standalone file bypasses standard project modules, it lacked a shared escaping utility.
**Learning:** Standalone export files that cannot use ES module imports require inline implementation of core safety functions (like `escapeHtml`) to ensure variables are safely rendered when constructing HTML strings dynamically.
**Prevention:** Always implement and apply an inline `escapeHtml()` utility to sanitize all user-influenced variables before injecting dynamically constructed text strings via `innerHTML` in standalone files.

## 2025-02-14 - [Prevent XSS in Inline JS Event Handlers]
**Vulnerability:** Even when variables are sanitized with `escapeHtml` before being injected into `innerHTML`, applying them within inline JavaScript event handlers (e.g., `<button onclick="doSomething('${user_input}')">`) remains susceptible to XSS. A standard `escapeHtml` function converts quotes to HTML entities, but the browser decodes these entities *before* executing the inline JS. An attacker can input `'); alert(1);//`, which becomes `&#039;); alert(1);//` but executes as `'); alert(1);//`, breaking out of the JavaScript context.
**Learning:** `escapeHtml` alone is insufficient for variables injected into inline JavaScript via `innerHTML`. Context-aware escaping is critical.
**Prevention:** Always apply JavaScript-specific escaping (e.g., backslash-escaping single/double quotes) *in addition to* `escapeHtml` when dynamically injecting variables into `onclick` or other inline event handler attributes using string concatenation.
