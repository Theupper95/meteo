// TopoJSON: le geometrie condivise (archi) diventano coordinate e GeoJSON.
// Usato per le zone di allerta e per la mappa del radar.

export function decodeArcs(topo) {
  const tr = topo.transform;
  if (!tr) return topo.arcs;
  const [sx, sy] = tr.scale;
  const [tx, ty] = tr.translate;
  return topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map((p) => {
      x += p[0];
      y += p[1];
      return [x * sx + tx, y * sy + ty];
    });
  });
}

// Una sequenza di archi (indici, negativi = percorsi al contrario) diventa una linea continua.
export function joinArcs(idxs, arcs) {
  const pts = [];
  for (const i of idxs) {
    const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
    for (let k = pts.length ? 1 : 0; k < a.length; k++) pts.push(a[k]);
  }
  return pts;
}

export function topoFeatures(topo, name, arcs = decodeArcs(topo)) {
  const obj = topo.objects[name];
  if (!obj) return { type: 'FeatureCollection', features: [] };
  const geom = (g) => {
    switch (g.type) {
      case 'Polygon': return { type: 'Polygon', coordinates: g.arcs.map((r) => joinArcs(r, arcs)) };
      case 'MultiPolygon': return { type: 'MultiPolygon', coordinates: g.arcs.map((p) => p.map((r) => joinArcs(r, arcs))) };
      case 'LineString': return { type: 'LineString', coordinates: joinArcs(g.arcs, arcs) };
      case 'MultiLineString': return { type: 'MultiLineString', coordinates: g.arcs.map((l) => joinArcs(l, arcs)) };
      default: return null;
    }
  };
  const list = obj.type === 'GeometryCollection' ? obj.geometries : [obj];
  return {
    type: 'FeatureCollection',
    features: list.map((g) => ({ type: 'Feature', properties: g.properties || {}, geometry: geom(g) })).filter((f) => f.geometry),
  };
}
