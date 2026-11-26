'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  parseKustomization,
  buildAuditMarkdown,
  buildDiffMarkdown,
  buildInventoryCsv,
  buildReportMarkdown,
} = require('../src/kustomize');
const { KustomizeViewModel } = require('../src/view');
const { editorHtml, csp } = require('../src/html');

test('parses sample kustomization.yaml with bases, resources, patches, images, generators and findings', () => {
  const buf = fs.readFileSync(path.join(__dirname, '..', 'samples', 'kustomization.yaml'));
  const parsed = parseKustomization(buf, 'kustomization.yaml');
  assert.equal(parsed.stats.baseCount, 2);
  assert.equal(parsed.stats.resourceCount, 3);
  assert.equal(parsed.stats.patchCount, 2);
  assert.equal(parsed.stats.imageCount, 3);
  assert.equal(parsed.stats.generatorCount, 2);
  const rules = new Set(parsed.findings.map((f) => f.rule));
  assert.ok(rules.has('deprecated-bases'));
  assert.ok(rules.has('unpinned-image'));
  assert.ok(rules.has('missing-namespace'));
  assert.ok(rules.has('hardcoded-secret'));
});

test('passes clean hardened kustomization overlay with zero findings', () => {
  const cleanYaml = [
    'apiVersion: kustomize.config.k8s.io/v1beta1',
    'kind: Kustomization',
    'namespace: prod-payments',
    'resources:',
    '  - ../../base/api',
    '  - ingress.yaml',
    'images:',
    '  - name: ghcr.io/acme/api',
    '    newTag: 1.4.2',
    '    digest: sha256:0123456789abcdef',
    'configMapGenerator:',
    '  - name: app-env',
    '    literals:',
    '      - LOG_LEVEL=warn',
  ].join('\n');
  const parsed = parseKustomization(cleanYaml, 'kustomization.yaml');
  assert.equal(parsed.findings.length, 0);
  assert.equal(parsed.meta.namespace, 'prod-payments');
});

test('KustomizeViewModel filters by images, errors and search text', () => {
  const buf = fs.readFileSync(path.join(__dirname, '..', 'samples', 'kustomization.yaml'));
  const parsed = parseKustomization(buf, 'kustomization.yaml');
  const vm = new KustomizeViewModel(parsed, 'kustomization.yaml', buf.length);
  assert.equal(vm.totalCount(), parsed.stats.entryCount);
  assert.equal(vm.setFilter({ text: '', status: 'image' }), 3);
  assert.equal(vm.setFilter({ text: '', status: 'generator' }), 2);
  assert.ok(vm.setFilter({ text: '', status: 'error' }) >= 2);
  assert.equal(vm.setFilter({ text: 'postgres', status: '' }), 1);
  const det = vm.detail(1);
  assert.ok(det && det.section);
});

test('Pro report builders output audit, diff, CSV and manifest map Markdown', () => {
  const buf = fs.readFileSync(path.join(__dirname, '..', 'samples', 'kustomization.yaml'));
  const left = parseKustomization(buf, 'kustomization.yaml');
  const right = parseKustomization('apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nnamespace: prod\nresources:\n  - ../../base/api\nimages:\n  - name: ghcr.io/acme/api-server\n    newTag: 2.0.0\n', 'kustomization.prod.yaml');
  const audit = buildAuditMarkdown([{ fileName: 'kustomization.yaml', parsed: left }]);
  assert.match(audit, /Kustomize Overlay Drift & Security Audit/);
  assert.match(audit, /hardcoded-secret/);
  const diff = buildDiffMarkdown('staging', left, 'prod', right);
  assert.match(diff, /Kustomize Overlay Comparison Report/);
  assert.match(diff, /RESOLVED/);
  const csv = buildInventoryCsv(left);
  assert.match(csv, /^index,line,section,name,status,detail/);
  const rep = buildReportMarkdown(left, 'kustomization.yaml');
  assert.match(rep, /Image Tag Overrides/);
});

test('editorHtml enforces strict CSP with nonce and no unsafe-inline', () => {
  const html = editorHtml({ cspSource: 'vscode-webview://test', script: 'v.js', styleUri: 'v.css', title: 'kustomization.yaml', nonce: 'kust123' });
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'nonce-kust123'/);
  assert.doesNotMatch(csp('vscode-webview://test', 'kust123'), /unsafe-inline/);
});
