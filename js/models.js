// Catalogo dei modelli meteo usati dall'app (identificativi dell'API Open-Meteo).
// "days" è l'orizzonte di previsione, "res" la risoluzione della griglia.

export const MODELS = [
  {
    id: 'ecmwf_ifs', short: 'ECMWF', name: 'ECMWF IFS',
    org: 'Centro europeo ECMWF', res: '9 km', days: 15, kind: 'fisico', on: true,
    note: 'Il modello globale di riferimento in Europa.',
  },
  {
    id: 'ecmwf_aifs025_single', short: 'AIFS', name: 'ECMWF AIFS',
    org: 'Centro europeo ECMWF', res: '28 km', days: 15, kind: 'AI', on: true,
    note: "Modello a intelligenza artificiale, addestrato su 40 anni di dati.",
  },
  {
    id: 'dwd_icon_seamless', short: 'ICON', name: 'DWD ICON',
    org: 'Servizio meteo tedesco DWD', res: '2–11 km', days: 7, kind: 'fisico', on: true,
    note: 'Unisce ICON globale, ICON-EU e ICON-D2.',
  },
  {
    id: 'italia_meteo_arpae_icon_2i', short: 'ICON-2I', name: 'ItaliaMeteo ICON-2I',
    org: 'Agenzia ItaliaMeteo e ARPAE', res: '2 km', days: 3, kind: 'fisico', on: true,
    note: "Alta risoluzione sull'Italia, assimila radar e stazioni.",
  },
  {
    id: 'meteofrance_seamless', short: 'Météo-France', name: 'Météo-France ARPEGE/AROME',
    org: 'Météo-France', res: '1,5–25 km', days: 4, kind: 'fisico', on: true,
    note: 'Forte sulle Alpi occidentali e sul Tirreno.',
  },
  {
    id: 'ncep_gfs_seamless', short: 'GFS', name: 'NOAA GFS',
    org: 'Servizio meteo USA (NOAA)', res: '13 km', days: 16, kind: 'fisico', on: true,
    note: 'Il modello globale americano.',
  },
  {
    id: 'ukmo_seamless', short: 'UKMO', name: 'UK Met Office',
    org: 'Met Office britannico', res: '10 km', days: 7, kind: 'fisico', on: true,
    note: 'Modello globale del servizio meteo britannico.',
  },
  {
    id: 'meteoswiss_icon_seamless', short: 'ICON-CH', name: 'MeteoSvizzera ICON-CH',
    org: 'MeteoSvizzera', res: '1–2 km', days: 5, kind: 'fisico', on: false,
    note: 'Solo Alpi e Nord Italia: utile in montagna.',
  },
  {
    id: 'cmc_gem_seamless', short: 'GEM', name: 'GEM Canada',
    org: 'Servizio meteo canadese', res: '15 km', days: 10, kind: 'fisico', on: false,
    note: 'Un parere in più per i giorni lontani.',
  },
  {
    id: 'ncep_aigfs025', short: 'AIGFS', name: 'NOAA AIGFS',
    org: 'Servizio meteo USA (NOAA)', res: '25 km', days: 16, kind: 'AI', on: false,
    note: 'Modello a intelligenza artificiale della NOAA.',
  },
];

export const MODEL_BY_ID = Object.fromEntries(MODELS.map((m) => [m.id, m]));
export const DEFAULT_MODELS = MODELS.filter((m) => m.on).map((m) => m.id);
export const shortName = (id) => MODEL_BY_ID[id]?.short || id;
