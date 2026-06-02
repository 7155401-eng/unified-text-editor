import re

def fix_buttons():
    with open('index.html', 'r', encoding='utf-8') as f:
        content = f.read()

    def repl(m):
        full_button = m.group(0)

        if 'aria-label=' in full_button:
            return full_button

        title_match = re.search(r'title="([^"]*)"', full_button)
        if not title_match:
            return full_button

        title_val = title_match.group(1)

        new_button = full_button.replace(f'title="{title_val}"', f'title="{title_val}" aria-label="{title_val}"', 1)
        return new_button

    start_tag_pattern = re.compile(r'<button[^>]+>')
    new_content = start_tag_pattern.sub(repl, content)

    with open('index.html', 'w', encoding='utf-8') as f:
        f.write(new_content)

fix_buttons()
