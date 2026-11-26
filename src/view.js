'use strict';
// View model for Kustomize Overlay Viewer: pagination, search/filter, images, generators and findings.

class KustomizeViewModel {
  constructor(parsed, name, fileSize) {
    this.parsed = parsed;
    this.name = name;
    this.fileSize = fileSize;
    this.filter = { text: '', status: '' };
    this.filtered = parsed.rows.slice();
  }

  summary() {
    const p = this.parsed;
    const s = p.stats;
    return {
      name: this.name,
      fileSize: this.fileSize,
      totalLines: p.totalLines,
      namespace: p.meta.namespace || '(none)',
      apiVersion: p.meta.apiVersion || '(none)',
      entryCount: s.entryCount,
      resourceCount: s.resourceCount,
      baseCount: s.baseCount,
      patchCount: s.patchCount,
      imageCount: s.imageCount,
      generatorCount: s.generatorCount,
      securityCount: s.securityCount,
      deprecationCount: s.deprecationCount,
      errorCount: s.errorCount,
      warningCount: s.warningCount,
      images: p.images,
      generators: p.generators,
      findings: p.findings,
    };
  }

  totalCount() {
    return this.parsed.rows.length;
  }

  count() {
    return this.filtered.length;
  }

  setFilter(f) {
    const text = f && typeof f.text === 'string' ? f.text.trim().toLowerCase() : '';
    const status = f && typeof f.status === 'string' ? f.status.trim() : '';
    this.filter = { text, status };
    this.filtered = this.parsed.rows.filter((r) => {
      if (status === 'error' && r.status !== 'error') return false;
      if (status === 'warning' && r.status !== 'warning') return false;
      if (status === 'ok' && r.status !== 'ok') return false;
      if (status === 'image' && r.section !== 'image') return false;
      if (status === 'generator' && r.section !== 'configMapGenerator' && r.section !== 'secretGenerator') return false;
      if (text) {
        const hay = `${r.section} ${r.name} ${r.detail} ${r.line}`.toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return true;
    });
    return this.filtered.length;
  }

  rows(from, limit) {
    const start = Math.max(0, Number(from) || 0);
    const n = Math.max(1, Math.min(500, Number(limit) || 100));
    return this.filtered.slice(start, start + n).map((r) => ({
      index: r.index,
      line: r.line,
      section: r.section,
      name: r.name,
      detail: r.detail,
      errorCount: r.errorCount,
      warningCount: r.warningCount,
      status: r.status,
    }));
  }

  detail(index) {
    const r = this.parsed.rows.find((x) => x.index === index) || this.parsed.rows[0] || null;
    if (!r) return null;
    return {
      index: r.index,
      line: r.line,
      section: r.section,
      name: r.name,
      detail: r.detail,
      status: r.status,
      findings: r.findings,
      meta: r.meta,
      overlayMeta: this.parsed.meta,
    };
  }
}

module.exports = { KustomizeViewModel };
