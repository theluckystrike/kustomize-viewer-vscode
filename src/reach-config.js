'use strict';
module.exports = {
  prefix: 'zovoKustomize',
  triesKey: 'zovoKustomize.proTrial',
  slot: '#protools',
  tools: [
    { id: 'auditOverlay', title: 'Audit Kustomize overlay drift and security', command: 'zovoKustomize.auditOverlay' },
    { id: 'diffOverlays', title: 'Compare two Kustomize overlays', command: 'zovoKustomize.diffOverlays' },
    { id: 'exportManifestMap', title: 'Export Kustomize resource and image map', command: 'zovoKustomize.exportManifestMap' },
  ],
};
