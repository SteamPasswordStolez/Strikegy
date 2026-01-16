import pathlib

path = pathlib.Path('src/campaign/CampaignData.js')
text = path.read_text(encoding='utf-8')

out = []
i = 0
n = len(text)
converted = 0

# Helper to check identifier boundary

def is_id_char(c: str) -> bool:
    return c.isalnum() or c in ['_', '$']

while i < n:
    # find 'en' key pattern: en: <ws> '...'
    if text.startswith('en', i):
        # ensure boundary
        prev = text[i-1] if i > 0 else ''
        nxt = text[i+2] if i+2 < n else ''
        if (i == 0 or not is_id_char(prev)):
            j = i + 2
            # skip spaces
            while j < n and text[j].isspace():
                j += 1
            if j < n and text[j] == ':':
                j += 1
                while j < n and text[j].isspace():
                    j += 1
                if j < n and text[j] == "'":
                    # parse single-quoted JS string
                    start = i
                    out.append(text[i:j])  # include 'en:' and spaces up to quote
                    j += 1
                    buf = []
                    while j < n:
                        c = text[j]
                        if c == '\\':
                            if j+1 < n:
                                buf.append(c)
                                buf.append(text[j+1])
                                j += 2
                                continue
                            else:
                                buf.append(c)
                                j += 1
                                continue
                        if c == "'":
                            j += 1
                            break
                        buf.append(c)
                        j += 1
                    # Convert content to double-quoted string.
                    content = ''.join(buf)
                    # We keep existing backslash escapes as-is, but must escape double quotes.
                    content = content.replace('"', '\\"')
                    out.append('"' + content + '"')
                    converted += 1
                    i = j
                    continue
    out.append(text[i])
    i += 1

new_text = ''.join(out)
path.write_text(new_text, encoding='utf-8')
print(f'Converted en single-quoted strings -> double-quoted: {converted}')
