# -*- coding: utf-8 -*-
import subprocess, os, re

REPO = r"C:\Users\User\migration_work\unified-text-editor"
GATE_SOURCE = os.path.join(REPO, "tool_preview_gate.js")

with open(GATE_SOURCE, encoding="utf-8") as f:
    GATE_CONTENT = f.read()

TOOLS = [
    {"branch": "claude-fix-translate-text-compare-pro", "tool_id": "text-compare-pro",
     "wires": [('wireTextComparePro(paneManager)', 220)],
     "html_buttons": [('data-action="open-text-compare-pro"', 'text-compare-pro')]},
    {"branch": "claude-fix-translate-haredi-caricature", "tool_id": "haredi-caricature",
     "wires": [], "html_buttons": []},
    {"branch": "claude-fix-editor-buttons-audit", "tool_id": "editor-buttons-audit",
     "wires": [], "html_buttons": [('data-cmd="transfer-settings"', 'editor-buttons-audit')]},
    {"branch": "claude-fix-translate-torah-transcription", "tool_id": "torah-transcription",
     "wires": [('wireTorahTranscription(paneManager)', 220)], "html_buttons": []},
    {"branch": "claude-fix-translate-torah-nikud", "tool_id": "torah-nikud",
     "wires": [('wireTorahNikud(paneManager)', 220)], "html_buttons": []},
    {"branch": "claude-fix-translate-nikud-merger", "tool_id": "nikud-merger",
     "wires": [('wireNikudMergerButton(paneManager)', 220)], "html_buttons": []},
    {"branch": "claude-fix-translate-word-extractor", "tool_id": "word-extractor",
     "wires": [], "html_buttons": [('data-cmd="word-import-streams"', 'word-extractor')]},
    {"branch": "claude-fix-translate-comparator-tool", "tool_id": "comparator-tool",
     "wires": [('wireComparatorButton(paneManager)', 220)],
     "html_buttons": [('data-cmd="open-comparator"', 'comparator-tool'),
                      ('data-cmd="open-comparator-integrated"', 'comparator-tool')]},
    {"branch": "claude-fix-translate-sefaria-full", "tool_id": "sefaria-full",
     "wires": [('wireSefariaTools(paneManager)', 220)], "html_buttons": []},
]

def run(cmd):
    return subprocess.run(cmd, shell=True, cwd=REPO, capture_output=True, text=True)

def apply(tool):
    branch = tool["branch"]
    tool_id = tool["tool_id"]
    print("=== " + branch + " (" + tool_id + ") ===")
    r = run("git checkout " + branch)
    if r.returncode:
        print("CHECKOUT FAIL:", r.stderr)
        return
    run("git pull origin " + branch)

    gate_path = os.path.join(REPO, "src", "tool_preview_gate.js")
    with open(gate_path, "w", encoding="utf-8") as f:
        f.write(GATE_CONTENT)

    main_js = os.path.join(REPO, "src", "main.js")
    with open(main_js, encoding="utf-8") as f:
        content = f.read()

    if 'from "./tool_preview_gate.js"' not in content:
        m = re.search(r'(import [^\n]+from "\./[^\n]+\.js";)\n', content)
        if m:
            content = content.replace(
                m.group(1),
                m.group(1) + '\nimport { isToolPreviewAllowed, revealToolButtons } from "./tool_preview_gate.js";',
                1)

    if "revealToolButtons()" not in content:
        content = re.sub(
            r'(setTimeout\(\(\) =>\s*wireTorahTools\(paneManager\),\s*\d+\);)',
            r'revealToolButtons();\n\1',
            content,
            count=1)

    for wire_call, ms in tool["wires"]:
        pattern = r'setTimeout\(\(\)\s*=>\s*' + re.escape(wire_call) + r',\s*\d+\);'
        wrapped = 'if (isToolPreviewAllowed("' + tool_id + '")) {\n  setTimeout(() => ' + wire_call + ', ' + str(ms) + ');\n}'
        new = re.sub(pattern, wrapped, content, count=1)
        if new == content:
            print("  WARN no wire match for", wire_call)
        content = new

    with open(main_js, "w", encoding="utf-8") as f:
        f.write(content)

    index_html = os.path.join(REPO, "index.html")
    if os.path.exists(index_html):
        with open(index_html, encoding="utf-8") as f:
            html = f.read()
        for marker, gate_name in tool["html_buttons"]:
            pattern = r'(<button[^>]*?' + re.escape(marker) + r'[^>]*?)(>)'
            def replacer(m, gn=gate_name):
                tag = m.group(1)
                close = m.group(2)
                if 'data-tool-preview=' in tag:
                    return m.group(0)
                if ' hidden' in tag:
                    return tag.replace(marker, marker + ' data-tool-preview="' + gn + '"', 1) + close
                return tag + ' data-tool-preview="' + gn + '" hidden' + close
            new = re.sub(pattern, replacer, html, count=10)
            if new == html:
                print("  WARN no button match for", marker)
            html = new
        with open(index_html, "w", encoding="utf-8") as f:
            f.write(html)

    run("git add -A")
    url = "https://app.ravtext.com/?tool=" + tool_id + "&k=9q7zX3mP4w"
    msg = "feat: admin preview gate -- test URL " + url
    r = run('git commit -m "' + msg + '"')
    if "nothing to commit" in (r.stdout + r.stderr):
        print("  no changes")
    else:
        print("  committed")
    r = run("git push origin " + branch)
    if r.returncode:
        print("PUSH FAIL:", r.stderr[:200])
    else:
        print("  pushed")

for t in TOOLS:
    apply(t)
run("git checkout main")
print("DONE")
