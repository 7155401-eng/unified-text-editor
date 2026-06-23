## 2025-02-13 - [Prevent XSS in Comparator UI Stream List]
**Vulnerability:** XSS vulnerability in `comparator_ui.js` and `comparator_integrated.js` where user-controlled variables (`s.label`, `s.count`, `sym`) were being directly concatenated and inserted into the DOM via `innerHTML` without prior sanitization. This allowed execution of malicious scripts if external documents or localStorage contained injected payloads.
**Learning:** `innerHTML` concatenations are susceptible to XSS if not properly escaped, specifically because parsed docx files/localStorage configurations can be manipulated.
**Prevention:** Explicitly use an `escapeHtml()` function to escape essential characters (`&`, `<`, `>`, `"`) before injecting dynamically generated text content into `innerHTML` statements.
## 2025-02-13 - [Prevent XSS in dynamically generated indicator bars]
**Vulnerability:** XSS vulnerability in `comparator_ui.js` and `comparator_integrated.js` where user-controlled variables (`s.sym`) were being directly concatenated and inserted into the DOM via `innerHTML` without prior sanitization in the `updateBar` function.
**Learning:** `innerHTML` concatenations are susceptible to XSS if not properly escaped, especially when dynamically generating indicator bars based on user-configured symbols.
**Prevention:** Explicitly use an `escapeHtml()` function to escape essential characters (`&`, `<`, `>`, `"`) before injecting dynamically generated text content into `innerHTML` statements. Backslash escaping for JS string injection also needs to happen after HTML escaping.
