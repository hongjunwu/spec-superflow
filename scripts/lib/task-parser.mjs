// One parser for template task IDs, progress, checkpoints and task counts.
export function parseTasks(content) {
  const lines = content.split(/\r?\n/);
  return lines.flatMap((line, index) => {
    const match = line.match(/^[ \t]*- \[([^\]]*)\](?:[ \t]+(.*))?$/);
    if (!match) return [];
    const text = match[2] ?? '';
    const id = text.replace(/^\*\*/, '').match(/^(\d+(?:\.\d+)*)(?=\s|\*\*|$)/)?.[1] ?? null;
    const refs = extractRefs(text);
    const continuation = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^[ \t]*- \[[^\]]*\]/.test(lines[cursor]) || /^\s*#/.test(lines[cursor])) break;
      if (!/^[ \t]+/.test(lines[cursor])) continue;
      continuation.push(lines[cursor]);
      refs.push(...extractRefs(lines[cursor]));
    }
    return [{
      id, text, line, index, complete: /^[xX]$/.test(match[1]), marker: match[1],
      refs: [...new Set(refs)],
      // The checkbox line plus its indented continuation lines: the unit a
      // traceability rule inspects for proof commands and named files.
      body: [line, ...continuation].join('\n'),
    }];
  });
}

function extractRefs(value) {
  const match = value.match(/\bRefs\s*:\s*([^；;\n]+)/i);
  return match ? match[1].split(/[,，]/).map(ref => ref.trim()).filter(Boolean) : [];
}

export function normalizeTaskCheckboxes(content) {
  // Preserve source bytes and old hash behavior except for valid indented tasks.
  return content.replace(/^([ \t]*- \[)[xX](\] .+)(\r?)$/gm, '$1 $2$3');
}
