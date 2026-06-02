import re

with open('styles.css', 'r', encoding='utf-8') as f:
    content = f.read()

focus_visible_rule = """
/* Accessibility: Focus visible outline for buttons */
button:not([class*="ribbon-tab"]):not(.btn-stream):not(.btn-render-prominent):not(.pdf-tb-btn):focus-visible,
.tb-group button:not(.btn-render-prominent):not(.pdf-tb-btn):focus-visible,
.toolbar button:not(.btn-render-prominent):not(.pdf-tb-btn):focus-visible,
.settings-btn:focus-visible {
  outline: 2px solid var(--rt-accent, #2c5aa0);
  outline-offset: 2px;
}
"""

if "Accessibility: Focus visible outline for buttons" not in content:
    with open('styles.css', 'w', encoding='utf-8') as f:
        f.write(content + "\n" + focus_visible_rule)
