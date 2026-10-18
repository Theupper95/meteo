# Isobara

App meteo per uso personale, da installare sul telefono Android. Mette insieme più modelli
meteorologici, misura quanto ha sbagliato ognuno nel luogo scelto durante l'ultimo mese, corregge
gli errori sistematici e dà più peso ai modelli più affidabili. Con un tocco passa la previsione a
Claude, che la spiega in parole semplici.

## Installarla sul telefono

1. Apri il link dell'app con **Chrome** su Android.
2. Tocca il menu **⋮** e poi **Installa app** (o **Aggiungi a schermata Home**).
3. L'icona compare tra le app: si apre a schermo intero, come un'app normale.

Gli aggiornamenti arrivano da soli: basta riaprire l'app con la connessione attiva.

## Come funziona il metodo

1. **Più modelli.** ECMWF IFS e AIFS (Centro europeo), ICON (Germania), ICON-2I (ItaliaMeteo),
   ARPEGE/AROME (Météo-France), GFS (USA), UK Met Office. Altri si attivano dal pannello *Luoghi*.
2. **Verifica.** Per gli ultimi 35 giorni l'app recupera cosa avevano previsto i modelli 1 e 4
   giorni prima (Previous Runs API) e lo confronta con la realtà: l'analisi ECMWF ogni 6 ore per
   temperatura e vento, la rianalisi ERA5 per la pioggia.
3. **Correzione.** L'errore medio di ogni modello viene tolto separatamente per le 4 fasce orarie
   (00, 06, 12, 18 UTC), con prudenza quando i dati sono pochi. Il vento è corretto con un fattore.
4. **Consenso pesato.** Peso proporzionale a 1/errore², avvicinato ai pesi uguali quando i campioni
   sono pochi e con un tetto del 40% per non dipendere da un solo modello.
5. **Fiducia.** Scende quando i modelli si dividono sulla pioggia o sulle temperature e quando il
   giorno è lontano.
6. **Prova onesta.** Nel pannello *Come funziona* il metodo viene allenato sulla prima metà del periodo e
   messo alla prova sulla seconda, confrontandolo con la media semplice e con il miglior modello.

Limite da tenere presente: la "verità" è l'analisi ECMWF, non una stazione meteo vera. I modelli
ECMWF (IFS e AIFS) partono quindi un po' avvantaggiati. Un passo successivo possibile è usare le
stazioni della rete ItaliaMeteo (MeteoHub) come riferimento.

## Il cielo

Lo sfondo è il cielo di quel luogo in quel momento: i colori dipendono dall'altezza del sole
(calcolata dalle coordinate e dall'ora), e si mescolano con nuvole, pioggia, neve o nebbia della
previsione. Toccando un'ora nella striscia, il cielo passa a quello di quell'ora.

## Claude

Il pulsante *Chiedi a Claude* prepara un messaggio con la previsione, l'accordo tra i modelli e l'affidabilità
di ognuno. **Apri in Claude** apre l'app Claude (o claude.ai) con il messaggio già scritto;
**Condividi** usa il menu di Android; **Copia** lo mette negli appunti.

## Dati e licenze

- Dati meteo: [Open-Meteo.com](https://open-meteo.com/), CC BY 4.0, gratuito per uso non commerciale
  (fino a 10.000 richieste al giorno). Modelli di ECMWF, DWD, ItaliaMeteo-ARPAE, Météo-France,
  NOAA, Met Office, MeteoSvizzera, ECCC.
- Clima 1991–2020 e verifica della pioggia: rianalisi ERA5 di Copernicus (via Open-Meteo).
- Nomi dei luoghi dal GPS: © OpenStreetMap (Nominatim).
- Carattere: Urbanist, SIL Open Font License 1.1 (vedi `fonts/OFL.txt`).

## Struttura

- `index.html`, `css/app.css`: interfaccia
- `js/engine.js`: il metodo (verifica, correzione, pesi, consenso, fiducia), solo funzioni pure
- `js/api.js`: richieste a Open-Meteo
- `js/text.js`: testi in italiano e messaggio per Claude
- `js/sky.js`: il cielo animato, calcolato dall'altezza del sole e dalla previsione
- `js/chart.js`, `js/icons.js`: striscia delle ore e icone
- `sw.js`, `manifest.webmanifest`: installazione e funzionamento offline
