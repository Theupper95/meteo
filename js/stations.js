// Stazioni meteo italiane con osservazioni orarie (bollettini METAR degli aeroporti e
// dell'Aeronautica Militare), dall'archivio dell'Iowa Environmental Mesonet.
// [codice, nome, latitudine, longitudine, quota in metri]

export const STATIONS = [
  ['LIBA', 'Amendola', 41.5381, 15.7139, 60],
  ['LIBC', 'Crotone', 38.9967, 17.0792, 161],
  ['LIBD', 'Bari Palese', 41.1381, 16.765, 44],
  ['LIBF', 'Foggia', 41.4329, 15.535, 80],
  ['LIBG', 'Grottaglie', 40.5172, 17.3997, 69],
  ['LIBH', 'Marina di Ginosa', 40.4244, 16.8867, 12],
  ['LIBN', 'Lecce Galatina', 40.2383, 18.1389, 61],
  ['LIBP', 'Pescara', 42.4372, 14.1872, 11],
  ['LIBQ', 'Monte Scuro', 39.3306, 16.3964, 1720],
  ['LIBR', 'Brindisi', 40.6577, 17.9514, 10],
  ['LIBV', 'Gioia del Colle', 40.7661, 16.9353, 350],
  ['LIBY', 'Santa Maria di Leuca', 39.8114, 18.3422, 112],
  ['LICA', 'Lamezia Terme', 38.9083, 16.2417, 15],
  ['LICB', 'Comiso', 36.9333, 14.6, 293],
  ['LICC', 'Catania Fontanarossa', 37.4667, 15.0639, 17],
  ['LICD', 'Lampedusa', 35.4981, 12.6183, 20],
  ['LICF', 'Messina', 38.2, 15.55, 51],
  ['LICG', 'Pantelleria', 36.8139, 11.9711, 191],
  ['LICJ', 'Palermo Punta Raisi', 38.1819, 13.0994, 34],
  ['LICL', 'Gela', 37.0764, 14.225, 33],
  ['LICR', 'Reggio Calabria', 38.0719, 15.6536, 21],
  ['LICT', 'Trapani Birgi', 37.9142, 12.4914, 7],
  ['LICZ', 'Sigonella', 37.4056, 14.9186, 22],
  ['LIEA', 'Alghero', 40.6311, 8.2886, 23],
  ['LIEC', 'Capo Carbonara', 39.1039, 9.5135, 118],
  ['LIED', 'Decimomannu', 39.3461, 8.9675, 28],
  ['LIEE', 'Cagliari Elmas', 39.2434, 9.0603, 4],
  ['LIEO', 'Olbia', 40.8986, 9.5178, 13],
  ['LIMA', 'Torino Aeritalia', 45.0864, 7.6034, 287],
  ['LIMC', 'Milano Malpensa', 45.63, 8.7231, 211],
  ['LIME', 'Bergamo Orio al Serio', 45.6689, 9.7003, 237],
  ['LIMF', 'Torino Caselle', 45.2025, 7.6494, 287],
  ['LIMG', 'Albenga', 44.0458, 8.1256, 49],
  ['LIMH', 'Plateau Rosa', 45.9352, 7.7072, 3488],
  ['LIMJ', 'Genova', 44.4133, 8.8375, 3],
  ['LIMK', 'Torino Bric della Croce', 45.0333, 7.7317, 710],
  ['LIML', 'Milano Linate', 45.4614, 9.2626, 103],
  ['LIMN', 'Cameri', 45.5296, 8.6692, 169],
  ['LIMP', 'Parma', 44.8245, 10.2964, 50],
  ['LIMS', 'Piacenza', 44.9092, 9.7278, 138],
  ['LIMU', 'Capo Mele', 43.9572, 8.1697, 221],
  ['LIMV', 'Passo dei Giovi', 44.5522, 8.9375, 475],
  ['LIMW', 'Aosta', 45.7385, 7.3687, 545],
  ['LIMY', 'Monte Malanotte', 44.25, 7.8, 1742],
  ['LIMZ', 'Cuneo Levaldigi', 44.547, 7.6232, 380],
  ['LIPA', 'Aviano', 46.0286, 12.6033, 126],
  ['LIPB', 'Bolzano', 46.4603, 11.3264, 241],
  ['LIPC', 'Cervia', 44.2289, 12.2919, 10],
  ['LIPE', 'Bologna', 44.5308, 11.2969, 42],
  ['LIPF', 'Ferrara', 44.8156, 11.6125, 10],
  ['LIPH', 'Treviso Sant\'Angelo', 45.6484, 12.1944, 23],
  ['LIPI', 'Rivolto', 45.9756, 13.0492, 53],
  ['LIPK', 'Forlì', 44.1956, 12.0697, 32],
  ['LIPL', 'Ghedi', 45.4206, 10.2814, 92],
  ['LIPO', 'Brescia Montichiari', 45.4289, 10.3306, 109],
  ['LIPQ', 'Trieste Ronchi dei Legionari', 45.8275, 13.4722, 12],
  ['LIPR', 'Rimini', 44.0244, 12.6128, 13],
  ['LIPS', 'Treviso Istrana', 45.6839, 12.1067, 41],
  ['LIPU', 'Padova', 45.3958, 11.8479, 14],
  ['LIPX', 'Verona Villafranca', 45.3875, 10.8723, 68],
  ['LIPY', 'Ancona Falconara', 43.6167, 13.3603, 10],
  ['LIPZ', 'Venezia Tessera', 45.5053, 12.3519, 6],
  ['LIQC', 'Capri', 40.5582, 14.2023, 269],
  ['LIQN', 'Rieti', 42.4267, 12.85, 389],
  ['LIQO', 'Monte Argentario', 42.3869, 11.1697, 632],
  ['LIQW', 'Sarzana', 44.0872, 9.985, 10],
  ['LIRA', 'Roma Ciampino', 41.8078, 12.5846, 101],
  ['LIRE', 'Pratica di Mare', 41.6545, 12.4452, 12],
  ['LIRF', 'Roma Fiumicino', 41.8003, 12.2389, 3],
  ['LIRG', 'Guidonia', 41.9967, 12.7344, 89],
  ['LIRH', 'Frosinone', 41.645, 13.2994, 181],
  ['LIRI', 'Salerno Pontecagnano', 40.6204, 14.9113, 40],
  ['LIRK', 'Monte Terminillo', 42.4667, 12.9833, 1875],
  ['LIRL', 'Latina', 41.5458, 12.9097, 26],
  ['LIRM', 'Grazzanise', 41.0606, 14.0789, 10],
  ['LIRN', 'Napoli Capodichino', 40.8848, 14.2917, 72],
  ['LIRP', 'Pisa', 43.6825, 10.3956, 2],
  ['LIRQ', 'Firenze Peretola', 43.8086, 11.2028, 38],
  ['LIRS', 'Grosseto', 42.7481, 11.0589, 7],
  ['LIRT', 'Trevico', 41.0467, 15.2328, 1093],
  ['LIRU', 'Roma Urbe', 41.9533, 12.4999, 24],
  ['LIRV', 'Viterbo', 42.4383, 12.055, 300],
  ['LIRX', 'Monte Calamita', 42.73, 10.38, 297],
  ['LIRZ', 'Perugia', 43.0972, 12.5103, 205],
  ['LIVC', 'Monte Cimone', 44.1936, 10.7, 2173],
  ['LIVD', 'Dobbiaco', 46.73, 12.22, 1226],
  ['LIVE', 'Passo Resia', 46.8333, 10.5, 1800],
  ['LIVF', 'Frontone', 43.5169, 12.7278, 574],
  ['LIVM', 'Punta Marina', 44.4414, 12.2961, 6],
  ['LIVP', 'Paganella', 46.1434, 11.0376, 2129],
  ['LIVR', 'Passo Rolle', 46.2978, 11.7867, 2006],
  ['LIVT', 'Trieste', 45.6767, 13.7538, 20],
].map(([id, name, lat, lon, elev]) => ({ id, name, lat, lon, elev }));

// Distanza in km tra due punti {lat, lon}.
export function distanceKm(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// La stazione più vicina che rappresenta davvero il luogo: entro 25 km e con meno di
// 200 m di dislivello (senza quota nota si accetta solo una stazione entro 12 km).
export function pickStation(place, { maxKm = 25, maxDz = 200 } = {}) {
  let best = null;
  for (const s of STATIONS) {
    const km = distanceKm(place, s);
    const known = typeof place.elevation === 'number';
    if (km > (known ? maxKm : 12)) continue;
    if (known && Math.abs(place.elevation - s.elev) > maxDz) continue;
    if (!best || km < best.km) best = { ...s, km };
  }
  return best;
}
