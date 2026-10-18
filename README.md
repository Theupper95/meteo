# Isobara

App meteo per uso personale, per il telefono Android. Mette insieme più modelli meteorologici,
misura quanto ha sbagliato ognuno nel luogo scelto durante l'ultimo mese confrontandolo con una
stazione meteo vera, corregge gli errori sistematici e dà più peso ai modelli più affidabili.
Con un tocco passa la previsione a Claude, che la spiega in parole semplici.

## Installarla sul telefono

**App Android (APK).** Apri dal telefono questo link:
[isobara.apk](https://github.com/Theupper95/meteo/releases/latest/download/isobara.apk).
Al termine del download tocca il file; la prima volta Android chiede di consentire
l'installazione di app dal browser (Impostazioni, *Installa app sconosciute*): consentila e conferma.
Le versioni nuove si installano sopra la precedente senza perdere luoghi e diario; quando ne esce una
l'app lo segnala in alto.

**Oppure dal sito.** Apri <https://theupper95.github.io/meteo/> con Chrome, menu **⋮**,
**Installa app**. Gli aggiornamenti arrivano da soli.

La chiave che firma l'APK è nel repository (`android/isobara.keystore`) ed è pubblica di proposito:
serve solo a far installare ogni versione sopra la precedente. Per questo l'APK va scaricato solo dalla
pagina Releases di questo repository.

## Cosa mostra

- **Adesso e prossime 48 ore**: temperatura, cielo, pioggia e una fascia che mostra quanto i modelli
  sono incerti. Il cielo sullo sfondo è quello del luogo in quel momento.
- **Prossime due ore**: la pioggia ogni 15 minuti e il **radar** delle ultime due ore (RainViewer).
- **Sette giorni** con il consenso dei modelli e la fiducia di ogni giorno, poi la **tendenza fino a
  15 giorni**: solo intervalli, dalle 51 simulazioni dell'ensemble ECMWF, perché oltre la settimana un
  numero secco sarebbe una finta precisione.
- **Oggi all'aperto**: qualità dell'aria (indice europeo), pollini (anche dell'olivo), raggi UV,
  mare sulla costa (onde e temperatura dell'acqua) e zero termico con la quota della neve.
- **Allerte ufficiali** della Protezione Civile per la zona di allerta del luogo, oggi e domani,
  separate dalla previsione e riportate così come sono.
- **Diario delle previsioni**: ogni giorno l'app salva la previsione per domani e poi la confronta
  con quanto misurato davvero.

## Come funziona il metodo

1. **Più modelli.** ECMWF IFS e AIFS (Centro europeo), ICON (Germania), ICON-2I (ItaliaMeteo),
   ARPEGE/AROME (Météo-France), GFS (USA), UK Met Office. Altri si attivano dal pannello *Luoghi*.
2. **Verifica.** Per gli ultimi 35 giorni l'app recupera cosa avevano previsto i modelli 1 e 4 giorni
   prima (Previous Runs API) e lo confronta con la realtà:
   - se entro 25 km c'è una **stazione meteo** con misure orarie (bollettini METAR) a meno di 200 m
     di dislivello, la verità sono le sue misure, e la verifica si fa nel punto della stazione;
   - altrimenti l'analisi ECMWF ogni 6 ore. Per la pioggia si usa la rianalisi ERA5.
3. **Correzione.** L'errore medio di ogni modello viene tolto separatamente per fascia oraria (ogni
   3 ore con la stazione, ogni 6 con l'analisi), con prudenza quando i dati sono pochi. Il vento è
   corretto con un fattore.
4. **Consenso pesato.** Peso proporzionale a 1/errore², avvicinato ai pesi uguali quando i dati sono
   pochi (contando i giorni, non le singole ore, che si somigliano) e con un tetto del 40%.
5. **Fiducia.** Scende quando i modelli si dividono sulla pioggia o sulle temperature e quando il
   giorno è lontano.
6. **Prova onesta.** Nel pannello *Come funziona* il metodo viene allenato sulla prima metà del
   periodo e messo alla prova sulla seconda, confrontandolo con la media semplice e con il miglior
   modello.

## Claude

Il pulsante *Chiedi a Claude* prepara un messaggio con la previsione, l'accordo tra i modelli,
l'affidabilità di ognuno, le allerte, aria e mare, la tendenza e il diario. **Apri in Claude** apre
l'app Claude (o claude.ai) con il messaggio già scritto; **Condividi** usa il menu di Android;
**Copia** lo mette negli appunti.

## Dati e licenze

- Previsioni: [Open-Meteo.com](https://open-meteo.com/), CC BY 4.0, gratuito per uso non commerciale.
  Modelli di ECMWF, DWD, ItaliaMeteo-ARPAE, Météo-France, NOAA, Met Office, MeteoSvizzera, ECCC.
  Qualità dell'aria e pollini: Copernicus CAMS. Mare: modelli d'onda via Open-Meteo.
- Clima 1991–2020 e verifica della pioggia: rianalisi ERA5 di Copernicus (via Open-Meteo).
- Stazioni meteo: bollettini METAR dall'archivio dell'[Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/).
- Allerte: [bollettino di criticità](https://github.com/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica)
  del Dipartimento della Protezione Civile, CC BY 4.0.
- Radar: [RainViewer](https://www.rainviewer.com/). Mappa © OpenStreetMap. Libreria
  della mappa: Leaflet (BSD-2, `vendor/LEAFLET-LICENSE`).
- Nomi dei luoghi dal GPS: © OpenStreetMap (Nominatim). Carattere: Urbanist, SIL OFL 1.1.

## Struttura

- `index.html`, `css/app.css`: interfaccia
- `js/engine.js`: il metodo (verifica, correzione, pesi, consenso, fiducia, tendenza, diario), solo funzioni pure
- `js/extras.js`: prossime due ore, aria e pollini, mare
- `js/alerts.js`: bollettino della Protezione Civile e zona di allerta del luogo
- `js/stations.js`: le stazioni meteo italiane con misure orarie
- `js/radar.js`: il radar sulla mappa
- `js/api.js`: richieste ai servizi di dati
- `js/text.js`: testi in italiano e messaggio per Claude
- `js/sky.js`, `js/chart.js`, `js/icons.js`: cielo animato, striscia delle ore, icone
- `sw.js`, `manifest.webmanifest`: installazione e funzionamento offline del sito
- `android/`: l'app Android (una WebView con i file del sito dentro l'APK)
- `.github/workflows/android.yml`: costruisce l'APK e lo pubblica tra le Release
