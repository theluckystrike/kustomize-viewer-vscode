/* global acquireVsCodeApi */
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');

  let state = {
    name: '',
    summary: null,
    pageSize: 100,
    page: 0,
    total: 0,
    rows: [],
    selected: null,
    tab: 'entries',
    req: 0,
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function post(msg) {
    state.req += 1;
    vscode.postMessage({ ...msg, req: state.req });
  }

  function fmtSize(n) {
    if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
  }

  function renderShell() {
    const s = state.summary;
    const errChip = s.errorCount > 0 ? `<span class="chip bad"><b>Errors:</b> ${s.errorCount}</span>` : '<span class="chip"><b>Errors:</b> 0</span>';
    const warnChip = s.warningCount > 0 ? `<span class="chip warn"><b>Warnings:</b> ${s.warningCount}</span>` : '';

    app.innerHTML = `
      <div class="top">
        <div class="title">
          <span class="name">${esc(state.name)}</span>
          <span class="kind">${s.totalLines} lines · ${fmtSize(s.fileSize)} · 100% offline (no cluster calls)</span>
        </div>
        <div class="summary">
          <span class="chip"><b>Namespace:</b> ${esc(s.namespace)}</span>
          <span class="chip"><b>Resources:</b> ${s.resourceCount}</span>
          <span class="chip"><b>Bases:</b> ${s.baseCount}</span>
          <span class="chip"><b>Patches:</b> ${s.patchCount}</span>
          <span class="chip"><b>Images:</b> ${s.imageCount}</span>
          <span class="chip"><b>Generators:</b> ${s.generatorCount}</span>
          ${errChip}${warnChip}
        </div>
        <div class="toolbar">
          <input id="q" type="search" placeholder="Filter by section, resource, image or path..." />
          <select id="statusFilter">
            <option value="">All entries</option>
            <option value="image">Image overrides</option>
            <option value="generator">Generators</option>
            <option value="error">Errors</option>
            <option value="warning">Warnings</option>
            <option value="ok">Clean</option>
          </select>
          <button id="filterBtn" type="button">Filter</button>
          <span class="sep"></span>
          <div id="protools"></div>
        </div>
        <div class="tabs">
          <button class="tab on" data-tab="entries" type="button">Overlay Tree (${s.entryCount})</button>
          <button class="tab" data-tab="images" type="button">Images (${s.imageCount})</button>
          <button class="tab" data-tab="generators" type="button">Generators (${s.generatorCount})</button>
          <button class="tab" data-tab="findings" type="button">Findings (${s.errorCount + s.warningCount})</button>
        </div>
        <div id="hint" class="hint"></div>
      </div>
      <div class="main">
        <div id="leftPane" class="tablewrap"></div>
        <div id="detail" class="detail"><p class="muted">Select an entry to inspect its overlay context and static findings.</p></div>
      </div>
      <div class="pager">
        <button id="prev" type="button">Prev</button>
        <span id="pageInfo"></span>
        <button id="next" type="button">Next</button>
      </div>
    `;

    const q = document.getElementById('q');
    const stSel = document.getElementById('statusFilter');
    const runFilter = () => {
      state.page = 0;
      post({ type: 'filter', filter: { text: q.value, status: stSel.value } });
    };
    document.getElementById('filterBtn').addEventListener('click', runFilter);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') runFilter(); });
    stSel.addEventListener('change', runFilter);

    document.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((b) => b.classList.remove('on'));
        btn.classList.add('on');
        state.tab = btn.dataset.tab;
        renderPane();
      });
    });

    document.getElementById('prev').addEventListener('click', () => {
      if (state.page > 0) { state.page -= 1; loadPage(); }
    });
    document.getElementById('next').addEventListener('click', () => {
      if ((state.page + 1) * state.pageSize < state.total) { state.page += 1; loadPage(); }
    });
  }

  function loadPage() {
    post({ type: 'page', from: state.page * state.pageSize, n: state.pageSize });
  }

  function renderPane() {
    const left = document.getElementById('leftPane');
    const pager = document.querySelector('.pager');
    const s = state.summary;

    if (state.tab === 'images') {
      pager.style.display = 'none';
      const rows = (s.images || []).map((img) => `<tr>
        <td class="num">${img.line}</td>
        <td><strong><code>${esc(img.name)}</code></strong></td>
        <td><code>${esc(img.newName)}</code></td>
        <td><code>${esc(img.newTag)}</code></td>
        <td><code>${esc(img.digest)}</code></td>
        <td class="${img.status === 'error' ? 'bad' : 'ok'}">${esc(img.status.toUpperCase())}</td>
      </tr>`).join('');
      left.innerHTML = `<table id="grid">
        <thead><tr><th class="num">Line</th><th>Image</th><th>New Name</th><th>New Tag</th><th>Digest</th><th>Status</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="muted">No image tag overrides declared.</td></tr>'}</tbody>
      </table>`;
      return;
    }

    if (state.tab === 'generators') {
      pager.style.display = 'none';
      const rows = (s.generators || []).map((g) => `<tr>
        <td class="num">${g.line}</td>
        <td><strong>${esc(g.kind)}</strong></td>
        <td><code>${esc(g.name)}</code></td>
        <td>${esc(g.behavior)}</td>
        <td class="num">${g.literals}</td>
        <td class="num">${g.files}</td>
        <td class="num">${g.envs}</td>
        <td class="${g.status === 'error' ? 'bad' : 'ok'}">${esc(g.status.toUpperCase())}</td>
      </tr>`).join('');
      left.innerHTML = `<table id="grid">
        <thead><tr><th class="num">Line</th><th>Kind</th><th>Name</th><th>Behavior</th><th class="num">Literals</th><th class="num">Files</th><th class="num">Envs</th><th>Status</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="muted">No ConfigMap or Secret generators declared.</td></tr>'}</tbody>
      </table>`;
      return;
    }

    if (state.tab === 'findings') {
      pager.style.display = 'none';
      const fRows = (s.findings || []).map((f) => `<tr>
        <td class="${f.severity === 'error' ? 'bad' : ''}">${esc(f.severity.toUpperCase())}</td>
        <td>${esc(f.category)}</td>
        <td><code>${esc(f.rule)}</code></td>
        <td class="num">${f.line}</td>
        <td><code>${esc(f.section)}</code></td>
        <td>${esc(f.message)}</td>
      </tr>`).join('');
      left.innerHTML = fRows
        ? `<table id="grid"><thead><tr><th>Severity</th><th>Category</th><th>Rule</th><th class="num">Line</th><th>Section</th><th>Finding</th></tr></thead><tbody>${fRows}</tbody></table>`
        : '<p class="muted" style="padding:12px;">All static Kustomize drift and security checks passed.</p>';
      return;
    }

    pager.style.display = 'flex';
    const body = state.rows.map((r) => {
      const sel = state.selected === r.index ? ' class="sel"' : '';
      const eBadge = r.errorCount ? `<span class="badge-mismatch">ERR (${r.errorCount})</span>` : '';
      const wBadge = r.warningCount ? `<span class="badge-muted">WARN (${r.warningCount})</span>` : '';
      const statusCls = r.status === 'error' ? 'bad' : (r.status === 'ok' ? 'ok' : '');
      return `<tr data-idx="${r.index}"${sel}>
        <td class="num">${r.line}</td>
        <td><code>${esc(r.section)}</code></td>
        <td><strong><code>${esc(r.name)}</code></strong>${eBadge}${wBadge}</td>
        <td><code>${esc(r.detail)}</code></td>
        <td class="${statusCls}">${esc(r.status.toUpperCase())}</td>
      </tr>`;
    }).join('');
    left.innerHTML = `<table id="grid">
      <thead><tr><th class="num">Line</th><th>Section</th><th>Name / Target</th><th>Details</th><th>Status</th></tr></thead>
      <tbody>${body || '<tr><td colspan="5" class="muted">No matching entries.</td></tr>'}</tbody>
    </table>`;

    left.querySelectorAll('tbody tr[data-idx]').forEach((tr) => {
      tr.addEventListener('click', () => {
        const idx = Number(tr.dataset.idx);
        state.selected = idx;
        left.querySelectorAll('tbody tr').forEach((row) => row.classList.toggle('sel', Number(row.dataset.idx) === idx));
        post({ type: 'detail', index: idx });
      });
    });

    const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
    document.getElementById('pageInfo').textContent = `Page ${state.page + 1} of ${pages} (${state.total} entries)`;
    document.getElementById('prev').disabled = state.page <= 0;
    document.getElementById('next').disabled = (state.page + 1) * state.pageSize >= state.total;
  }

  function renderDetail(d) {
    const el = document.getElementById('detail');
    if (!d) {
      el.innerHTML = '<p class="muted">No entry selected.</p>';
      return;
    }
    const pairs = [
      ['Line', d.line],
      ['Section', d.section],
      ['Name', d.name],
      ['Detail', d.detail || '(none)'],
      ['Status', d.status.toUpperCase()],
    ];
    const rows = pairs.map(([k, v]) => `<tr><td><strong>${esc(k)}</strong></td><td><code>${esc(v)}</code></td></tr>`).join('');
    const fItems = (d.findings || []).map((f) => `<li class="${f.severity === 'error' ? 'bad' : ''}"><strong>[${esc(f.severity.toUpperCase())}] ${esc(f.rule)}:</strong> ${esc(f.message)}</li>`).join('');
    const om = d.overlayMeta || {};
    const omRows = [
      ['apiVersion', om.apiVersion || '(not set)'],
      ['kind', om.kind || '(not set)'],
      ['namespace', om.namespace || '(not set)'],
      ['namePrefix', om.namePrefix || '(none)'],
      ['nameSuffix', om.nameSuffix || '(none)'],
    ].map(([k, v]) => `<tr><td><strong>${esc(k)}</strong></td><td><code>${esc(v)}</code></td></tr>`).join('');

    el.innerHTML = `
      <div class="dhead"><strong>Line ${d.line}: ${esc(d.section)}</strong><span class="muted">${esc(d.name)}</span></div>
      <table class="splits"><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>
      ${fItems ? `<div class="attr-head"><strong>Findings (${d.findings.length})</strong></div><ul class="findings-list">${fItems}</ul>` : ''}
      <div class="attr-head"><strong>Overlay Metadata</strong></div>
      <table class="splits"><thead><tr><th>Property</th><th>Value</th></tr></thead><tbody>${omRows}</tbody></table>
    `;
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || typeof m !== 'object') return;
    switch (m.type) {
      case 'init':
        if (m.error) {
          app.innerHTML = `<div class="error"><strong>Could not open ${esc(m.name)}</strong><p>${esc(m.error)}</p></div>`;
          return;
        }
        state.name = m.name;
        state.summary = m.summary;
        state.pageSize = m.pageSize || 100;
        state.page = 0;
        renderShell();
        loadPage();
        return;
      case 'pageResult':
        state.total = m.total;
        state.rows = m.rows || [];
        renderPane();
        if (state.rows.length && state.selected == null) {
          state.selected = state.rows[0].index;
          post({ type: 'detail', index: state.selected });
        }
        return;
      case 'filterResult':
        state.total = m.count;
        document.getElementById('hint').textContent = m.count < m.total ? `Showing ${m.count} of ${m.total} entries.` : '';
        loadPage();
        return;
      case 'detailResult':
        renderDetail(m.detail);
        return;
      case 'zovoAlso': {
        const anchor = m.anchor && document.getElementById(m.anchor);
        if (anchor && m.html) {
          const old = document.querySelector('.zovo-also');
          if (old) old.remove();
          anchor.insertAdjacentHTML('afterend', m.html);
        }
        return;
      }
      case 'hint':
        if (document.getElementById('hint')) document.getElementById('hint').textContent = m.text || '';
        return;
      default:
    }
  });

  post({ type: 'ready' });
})();
