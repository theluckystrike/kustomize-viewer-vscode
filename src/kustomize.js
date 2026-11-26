'use strict';
// Offline Kustomize overlay parser and static analyzer. Zero dependencies, zero network/cluster calls.

const SECRET_LITERAL_RE = /(pass(word|wd)?|secret|token|api[_-]?key|private[_-]?key|auth|credential|dsn|jwt|signing)/i;

function stripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle && line[i - 1] !== '\\') inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquote(val) {
  const s = String(val == null ? '' : val).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseKv(text) {
  const idx = text.indexOf(':');
  if (idx <= 0) return null;
  const key = text.slice(0, idx).trim();
  const rest = text.slice(idx + 1).trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(key)) return null;
  return { key, value: unquote(rest), rawValue: rest };
}

function parseFlowList(raw) {
  const inner = raw.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map((x) => unquote(x)).filter(Boolean);
}

/**
 * Lightweight line-tracking parser for Kustomize YAML manifests.
 */
function parseKustomization(input, fileName = 'kustomization.yaml') {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const meta = {
    apiVersion: '',
    kind: '',
    namespace: '',
    namePrefix: '',
    nameSuffix: '',
  };

  const sections = {
    bases: [],
    resources: [],
    components: [],
    patches: [],
    patchesStrategicMerge: [],
    patchesJson6902: [],
    images: [],
    configMapGenerator: [],
    secretGenerator: [],
    replicas: [],
    crds: [],
    transformers: [],
    generators: [],
    commonLabels: [],
    commonAnnotations: [],
  };

  let curTop = null;
  let curItem = null;
  let curItemIndent = -1;
  let curSubListKey = null;
  let curSubListIndent = -1;
  let curSubObjKey = null;
  let curSubObjIndent = -1;

  const LIST_SCALAR_KEYS = new Set(['bases', 'resources', 'components', 'patchesStrategicMerge', 'crds', 'transformers', 'generators']);
  const LIST_OBJ_KEYS = new Set(['patches', 'patchesJson6902', 'images', 'configMapGenerator', 'secretGenerator', 'replicas']);
  const MAP_KEYS = new Set(['commonLabels', 'commonAnnotations']);

  for (let i = 0; i < rawLines.length; i += 1) {
    const lineNo = i + 1;
    const clean = stripComment(rawLines[i]).replace(/\s+$/, '');
    if (!clean.trim() || clean.trim() === '---' || clean.trim() === '...') continue;

    const indent = clean.match(/^(\s*)/)[1].length;
    const trimmed = clean.trim();

    if (indent === 0) {
      curItem = null;
      curItemIndent = -1;
      curSubListKey = null;
      curSubListIndent = -1;
      curSubObjKey = null;
      curSubObjIndent = -1;
      const kv = parseKv(trimmed);
      if (!kv) continue;
      curTop = kv.key;
      if (Object.prototype.hasOwnProperty.call(meta, kv.key)) {
        meta[kv.key] = kv.value;
        continue;
      }
      if (LIST_SCALAR_KEYS.has(kv.key) && kv.rawValue.startsWith('[') && kv.rawValue.endsWith(']')) {
        for (const v of parseFlowList(kv.rawValue)) {
          sections[kv.key].push({ line: lineNo, value: v });
        }
      }
      continue;
    }

    if (!curTop) continue;

    if (MAP_KEYS.has(curTop)) {
      const kv = parseKv(trimmed);
      if (kv) sections[curTop].push({ line: lineNo, key: kv.key, value: kv.value });
      continue;
    }

    if (LIST_SCALAR_KEYS.has(curTop)) {
      if (trimmed.startsWith('-')) {
        const val = unquote(trimmed.slice(1).trim());
        if (val) sections[curTop].push({ line: lineNo, value: val });
      }
      continue;
    }

    if (LIST_OBJ_KEYS.has(curTop)) {
      if (trimmed.startsWith('-')) {
        // Could be a new top-level list item OR a nested sub-list item (e.g. literals/files/envs)
        if (curSubListKey && curItem && indent > curItemIndent && indent >= curSubListIndent) {
          const val = unquote(trimmed.slice(1).trim());
          if (val) curItem[curSubListKey].push({ line: lineNo, value: val });
          continue;
        }
        curSubListKey = null;
        curSubListIndent = -1;
        curSubObjKey = null;
        curSubObjIndent = -1;
        curItemIndent = indent;
        const afterDash = trimmed.slice(1).trim();
        const obj = { line: lineNo };
        if (afterDash) {
          const kv = parseKv(afterDash);
          if (kv) {
            if (kv.rawValue.startsWith('[') && kv.rawValue.endsWith(']')) {
              obj[kv.key] = parseFlowList(kv.rawValue).map((v) => ({ line: lineNo, value: v }));
            } else {
              obj[kv.key] = kv.value;
            }
          } else {
            obj.value = unquote(afterDash);
          }
        }
        sections[curTop].push(obj);
        curItem = obj;
        continue;
      }

      if (curItem && indent > curItemIndent) {
        if (curSubObjKey && indent > curSubObjIndent) {
          const kv = parseKv(trimmed);
          if (kv) {
            curItem[curSubObjKey] = curItem[curSubObjKey] || {};
            curItem[curSubObjKey][kv.key] = kv.value;
          }
          continue;
        }
        curSubObjKey = null;
        curSubObjIndent = -1;
        curSubListKey = null;
        curSubListIndent = -1;
        const kv = parseKv(trimmed);
        if (kv) {
          if (kv.rawValue === '') {
            if (kv.key === 'literals' || kv.key === 'files' || kv.key === 'envs') {
              curItem[kv.key] = curItem[kv.key] || [];
              curSubListKey = kv.key;
              curSubListIndent = indent;
            } else if (kv.key === 'target' || kv.key === 'options') {
              curItem[kv.key] = curItem[kv.key] || {};
              curSubObjKey = kv.key;
              curSubObjIndent = indent;
            } else {
              curItem[kv.key] = '';
            }
          } else if (kv.rawValue.startsWith('[') && kv.rawValue.endsWith(']')) {
            curItem[kv.key] = parseFlowList(kv.rawValue).map((v) => ({ line: lineNo, value: v }));
          } else {
            curItem[kv.key] = kv.value;
          }
        }
      }
    }
  }

  // Build rows, image table, generator summary, and static findings
  const rows = [];
  const findings = [];
  const images = [];
  const generators = [];
  let rowIndex = 0;

  function addRow(section, name, detail, line, extra = {}) {
    rowIndex += 1;
    const row = {
      index: rowIndex,
      line,
      section,
      name: String(name || ''),
      detail: String(detail || ''),
      status: 'ok',
      errorCount: 0,
      warningCount: 0,
      findings: [],
      meta: extra,
    };
    rows.push(row);
    return row;
  }

  function addFinding(row, severity, category, rule, line, message) {
    const f = { severity, category, rule, line, section: row ? row.section : 'overlay', message };
    findings.push(f);
    if (row) {
      row.findings.push(f);
      if (severity === 'error') row.errorCount += 1;
      else row.warningCount += 1;
      row.status = row.errorCount > 0 ? 'error' : (row.warningCount > 0 ? 'warning' : 'ok');
    }
  }

  // Metadata / overlay settings checks
  const headerLine = 1;
  if (!meta.apiVersion || !meta.kind) {
    const r = addRow('metadata', 'apiVersion / kind', `${meta.apiVersion || '(missing)'} / ${meta.kind || '(missing)'}`, headerLine);
    addFinding(r, 'warning', 'schema', 'missing-api-version', headerLine, 'Overlay is missing apiVersion or kind (expected kustomize.config.k8s.io/v1beta1 and Kustomization).');
  }
  if (!meta.namespace) {
    const r = addRow('metadata', 'namespace', '(not set)', headerLine);
    addFinding(r, 'warning', 'drift', 'missing-namespace', headerLine, 'No namespace set in this overlay; resources will rely on default or cluster context namespace.');
  } else {
    addRow('metadata', 'namespace', meta.namespace, headerLine);
  }
  if (meta.namePrefix) addRow('metadata', 'namePrefix', meta.namePrefix, headerLine);
  if (meta.nameSuffix) addRow('metadata', 'nameSuffix', meta.nameSuffix, headerLine);

  // Deprecated bases:
  const seenRefs = new Set();
  for (const b of sections.bases) {
    const r = addRow('base', b.value, 'bases (deprecated)', b.line);
    addFinding(r, 'warning', 'deprecation', 'deprecated-bases', b.line, `Deprecated "bases:" entry "${b.value}". Move base paths into "resources:" for Kustomize v5+ compatibility.`);
    if (seenRefs.has(b.value)) {
      addFinding(r, 'warning', 'drift', 'duplicate-resource', b.line, `Duplicate reference "${b.value}" appears multiple times.`);
    }
    seenRefs.add(b.value);
  }

  // Resources & components
  for (const res of sections.resources) {
    const r = addRow('resource', res.value, 'resources', res.line);
    if (seenRefs.has(res.value)) {
      addFinding(r, 'warning', 'drift', 'duplicate-resource', res.line, `Duplicate resource "${res.value}" appears multiple times.`);
    }
    seenRefs.add(res.value);
  }
  for (const c of sections.components) {
    addRow('component', c.value, 'components', c.line);
  }

  // Patches (current + deprecated)
  for (const p of sections.patches) {
    const targetDesc = p.target ? [p.target.kind, p.target.name, p.target.namespace].filter(Boolean).join('/') : '';
    const name = p.path || (p.patch ? '(inline patch)' : p.value || '(patch)');
    const detail = targetDesc ? `target: ${targetDesc}` : (p.path ? 'path patch' : 'inline patch');
    const r = addRow('patch', name, detail, p.line, { target: p.target || null });
    if (!p.path && !p.patch && !p.value) {
      addFinding(r, 'warning', 'schema', 'unsafe-patch-target', p.line, 'Patch entry has neither path nor inline patch content.');
    }
  }
  for (const p of sections.patchesStrategicMerge) {
    const r = addRow('patch', p.value, 'patchesStrategicMerge (deprecated)', p.line);
    addFinding(r, 'warning', 'deprecation', 'deprecated-patches-strategic', p.line, `Deprecated "patchesStrategicMerge:" entry "${p.value}". Migrate to the unified "patches:" field.`);
  }
  for (const p of sections.patchesJson6902) {
    const name = p.path || '(json6902 patch)';
    const r = addRow('patch', name, 'patchesJson6902 (deprecated)', p.line);
    addFinding(r, 'warning', 'deprecation', 'deprecated-patches-strategic', p.line, `Deprecated "patchesJson6902:" entry "${name}". Migrate to the unified "patches:" field.`);
  }

  // Images
  for (const img of sections.images) {
    const name = img.name || '(unnamed image)';
    const newName = img.newName || name;
    const newTag = img.newTag || '';
    const digest = img.digest || '';
    const effective = digest ? `${newName}@${digest}` : (newTag ? `${newName}:${newTag}` : newName);
    const r = addRow('image', name, effective, img.line, { newName, newTag, digest });
    let imgStatus = 'ok';
    if (!digest && (!newTag || newTag.toLowerCase() === 'latest')) {
      imgStatus = 'error';
      addFinding(r, 'error', 'security', 'unpinned-image', img.line, `Image override "${name}" uses "${newTag || '(no tag)'}" without a digest. Pin a version tag or sha256 digest.`);
    }
    images.push({ line: img.line, name, newName, newTag: newTag || '(none)', digest: digest || '-', effective, status: imgStatus });
  }

  // ConfigMapGenerator
  for (const g of sections.configMapGenerator) {
    const name = g.name || '(unnamed configMap)';
    const litCount = Array.isArray(g.literals) ? g.literals.length : 0;
    const fileCount = Array.isArray(g.files) ? g.files.length : 0;
    const envCount = Array.isArray(g.envs) ? g.envs.length : 0;
    const behavior = g.behavior || 'create';
    const detail = `${behavior} · ${litCount} literals, ${fileCount} files, ${envCount} envs`;
    addRow('configMapGenerator', name, detail, g.line, { behavior, litCount, fileCount, envCount });
    generators.push({ line: g.line, kind: 'ConfigMap', name, behavior, literals: litCount, files: fileCount, envs: envCount, status: 'ok' });
  }

  // SecretGenerator
  for (const g of sections.secretGenerator) {
    const name = g.name || '(unnamed secret)';
    const lits = Array.isArray(g.literals) ? g.literals : [];
    const fileCount = Array.isArray(g.files) ? g.files.length : 0;
    const envCount = Array.isArray(g.envs) ? g.envs.length : 0;
    const behavior = g.behavior || 'create';
    const detail = `${g.type || 'Opaque'} · ${lits.length} literals, ${fileCount} files, ${envCount} envs`;
    const r = addRow('secretGenerator', name, detail, g.line, { behavior, type: g.type || 'Opaque', litCount: lits.length, fileCount, envCount });
    let genStatus = 'ok';
    for (const lit of lits) {
      const [k, ...rest] = String(lit.value || '').split('=');
      const val = rest.join('=').trim();
      if (val && (SECRET_LITERAL_RE.test(k) || !/^\$\{.*\}$/.test(val))) {
        genStatus = 'error';
        addFinding(r, 'error', 'security', 'hardcoded-secret', lit.line || g.line, `Hardcoded secret literal "${k.trim()}" in secretGenerator "${name}". Use an external secret manager or untracked env file.`);
      }
    }
    generators.push({ line: g.line, kind: 'Secret', name, behavior, literals: lits.length, files: fileCount, envs: envCount, status: genStatus });
  }

  // Replicas & Labels
  for (const rep of sections.replicas) {
    addRow('replica', rep.name || '(unnamed)', `count: ${rep.count || '?'}`, rep.line);
  }
  for (const lbl of sections.commonLabels) {
    addRow('label', lbl.key, lbl.value, lbl.line);
  }

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const securityCount = findings.filter((f) => f.category === 'security').length;
  const deprecationCount = findings.filter((f) => f.category === 'deprecation').length;

  return {
    fileName,
    totalLines: rawLines.length,
    meta,
    sections,
    rows,
    images,
    generators,
    findings,
    stats: {
      entryCount: rows.length,
      resourceCount: sections.resources.length + sections.components.length,
      baseCount: sections.bases.length,
      patchCount: sections.patches.length + sections.patchesStrategicMerge.length + sections.patchesJson6902.length,
      imageCount: images.length,
      generatorCount: generators.length,
      securityCount,
      deprecationCount,
      errorCount,
      warningCount,
    },
  };
}

function buildAuditMarkdown(entries) {
  const lines = [
    '# Kustomize Overlay Drift & Security Audit',
    '',
    `Generated offline by Kustomize Overlay Viewer (${entries.length} overlay${entries.length === 1 ? '' : 's'}).`,
    '',
    '| File | Namespace | Resources | Bases | Patches | Images | Generators | Errors | Warnings |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const e of entries) {
    const s = e.parsed.stats;
    lines.push(`| ${e.fileName} | ${e.parsed.meta.namespace || '(none)'} | ${s.resourceCount} | ${s.baseCount} | ${s.patchCount} | ${s.imageCount} | ${s.generatorCount} | ${s.errorCount} | ${s.warningCount} |`);
  }
  lines.push('');
  for (const e of entries) {
    lines.push(`## ${e.fileName}`);
    lines.push('');
    if (!e.parsed.findings.length) {
      lines.push('All static drift, deprecation and security checks passed.');
      lines.push('');
      continue;
    }
    lines.push('| Severity | Category | Rule | Line | Message |');
    lines.push('| --- | --- | --- | ---: | --- |');
    for (const f of e.parsed.findings) {
      lines.push(`| ${f.severity.toUpperCase()} | ${f.category} | \`${f.rule}\` | ${f.line} | ${f.message.replace(/\|/g, '\\|')} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function buildDiffMarkdown(leftName, left, rightName, right) {
  const lines = [
    '# Kustomize Overlay Comparison Report',
    '',
    `Comparing **${leftName}** (baseline) against **${rightName}** (target).`,
    '',
    '## Summary',
    '',
    '| Metric | Baseline | Target | Delta |',
    '| --- | ---: | ---: | ---: |',
    `| Namespace | ${left.meta.namespace || '(none)'} | ${right.meta.namespace || '(none)'} | ${left.meta.namespace === right.meta.namespace ? 'same' : 'changed'} |`,
    `| Resources | ${left.stats.resourceCount} | ${right.stats.resourceCount} | ${right.stats.resourceCount - left.stats.resourceCount} |`,
    `| Bases | ${left.stats.baseCount} | ${right.stats.baseCount} | ${right.stats.baseCount - left.stats.baseCount} |`,
    `| Patches | ${left.stats.patchCount} | ${right.stats.patchCount} | ${right.stats.patchCount - left.stats.patchCount} |`,
    `| Images | ${left.stats.imageCount} | ${right.stats.imageCount} | ${right.stats.imageCount - left.stats.imageCount} |`,
    `| Errors | ${left.stats.errorCount} | ${right.stats.errorCount} | ${right.stats.errorCount - left.stats.errorCount} |`,
    `| Warnings | ${left.stats.warningCount} | ${right.stats.warningCount} | ${right.stats.warningCount - left.stats.warningCount} |`,
    '',
    '## Image Tag Overrides',
    '',
    '| Image | Baseline | Target | Change |',
    '| --- | --- | --- | --- |',
  ];

  const leftImgs = new Map(left.images.map((i) => [i.name, i.effective]));
  const rightImgs = new Map(right.images.map((i) => [i.name, i.effective]));
  const allImgNames = [...new Set([...leftImgs.keys(), ...rightImgs.keys()])].sort();
  if (!allImgNames.length) {
    lines.push('| (none) | - | - | - |');
  } else {
    for (const name of allImgNames) {
      const a = leftImgs.get(name) || '(absent)';
      const b = rightImgs.get(name) || '(absent)';
      const ch = a === b ? 'unchanged' : (a === '(absent)' ? 'ADDED' : (b === '(absent)' ? 'REMOVED' : 'CHANGED'));
      lines.push(`| \`${name}\` | \`${a}\` | \`${b}\` | ${ch} |`);
    }
  }

  lines.push('', '## Findings Diff', '');
  const lKeys = new Set(left.findings.map((f) => `${f.rule}:${f.message}`));
  const rKeys = new Set(right.findings.map((f) => `${f.rule}:${f.message}`));
  let anyDiff = false;
  for (const f of right.findings) {
    if (!lKeys.has(`${f.rule}:${f.message}`)) {
      lines.push(`- **NEW [${f.severity.toUpperCase()}]** \`${f.rule}\` (line ${f.line}): ${f.message}`);
      anyDiff = true;
    }
  }
  for (const f of left.findings) {
    if (!rKeys.has(`${f.rule}:${f.message}`)) {
      lines.push(`- **RESOLVED [${f.severity.toUpperCase()}]** \`${f.rule}\` (line ${f.line}): ${f.message}`);
      anyDiff = true;
    }
  }
  if (!anyDiff) lines.push('No finding differences between the two overlays.');
  lines.push('');
  return lines.join('\n');
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildInventoryCsv(parsed) {
  const header = 'index,line,section,name,status,detail';
  const body = parsed.rows.map((r) => [
    r.index,
    r.line,
    csvCell(r.section),
    csvCell(r.name),
    csvCell(r.status),
    csvCell(r.detail),
  ].join(','));
  return [header, ...body].join('\n') + '\n';
}

function buildReportMarkdown(parsed, fileName) {
  const s = parsed.stats;
  const lines = [
    `# Kustomize Manifest Map: ${fileName}`,
    '',
    `- **apiVersion**: ${parsed.meta.apiVersion || '(not set)'}`,
    `- **kind**: ${parsed.meta.kind || '(not set)'}`,
    `- **namespace**: ${parsed.meta.namespace || '(not set)'}`,
    `- **Entries**: ${s.entryCount} (${s.resourceCount} resources, ${s.baseCount} bases, ${s.patchCount} patches, ${s.imageCount} images, ${s.generatorCount} generators)`,
    `- **Findings**: ${s.errorCount} errors, ${s.warningCount} warnings`,
    '',
    '## Image Tag Overrides',
    '',
    '| Line | Image | New Name | Tag | Digest | Status |',
    '| ---: | --- | --- | --- | --- | --- |',
  ];
  if (!parsed.images.length) {
    lines.push('| - | (none) | - | - | - | - |');
  } else {
    for (const img of parsed.images) {
      lines.push(`| ${img.line} | \`${img.name}\` | \`${img.newName}\` | \`${img.newTag}\` | \`${img.digest}\` | ${img.status.toUpperCase()} |`);
    }
  }
  lines.push('', '## Manifest Entries', '', '| Line | Section | Name | Detail | Status |', '| ---: | --- | --- | --- | --- |');
  for (const r of parsed.rows) {
    lines.push(`| ${r.line} | ${r.section} | \`${r.name}\` | ${r.detail.replace(/\|/g, '\\|')} | ${r.status.toUpperCase()} |`);
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  parseKustomization,
  buildAuditMarkdown,
  buildDiffMarkdown,
  buildInventoryCsv,
  buildReportMarkdown,
};
