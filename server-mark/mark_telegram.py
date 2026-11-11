#!/usr/bin/env python3
"""Mark su Telegram.

Gira sul server Hetzner di Mark. Riceve i messaggi del bot Telegram,
trascrive le note vocali sul server (faster-whisper), passa foto, screenshot e PDF e il testo
alla funzione `mark` su Supabase, la stessa della web-app.

Risponde solo alla chat abbinata con la parola di abbinamento.
Le chiavi stanno in /etc/mark/mark.env (leggibile solo da root e da mark).
"""
import asyncio
import base64
import json
import os
import re
import subprocess
import sys
import uuid
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

SUPABASE_URL = "https://eameewqpwdanexplsbcp.supabase.co"
# Chiave pubblica "anon": è la stessa che sta nella web-app.
SUPABASE_ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhbWVld3Fwd2RhbmV4cGxzYmNwIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NTk0NzcsImV4cCI6MjEwNzEzNTQ3N30.B5wT4uL6MkfGnp4ut8ZEt74-rbq_XChg5EOwWs-mPNs"
)
FN_URL = f"{SUPABASE_URL}/functions/v1/mark"

STATO = os.environ.get("MARK_STATO", "/var/lib/mark")
FILE_CHAT = os.path.join(STATO, "chat_id")
MEMORIA_SECONDI = 15 * 60  # come Siri: la conversazione dura 15 minuti
MAX_MESSAGGI = 12
LIMITE_TELEGRAM = 4000


def log(*parti):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), *parti, flush=True)


# ---------- Telegram ----------

class Telegram:
    def __init__(self, token):
        self.base = f"https://api.telegram.org/bot{token}"
        self.file_base = f"https://api.telegram.org/file/bot{token}"

    def chiama(self, metodo, dati=None, timeout=70):
        corpo = json.dumps(dati or {}).encode()
        req = urllib.request.Request(
            f"{self.base}/{metodo}", data=corpo, headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            risposta = json.load(r)
        if not risposta.get("ok"):
            raise RuntimeError(f"Telegram {metodo}: {risposta.get('description')}")
        return risposta["result"]

    def scarica(self, file_id, destinazione):
        info = self.chiama("getFile", {"file_id": file_id})
        with urllib.request.urlopen(f"{self.file_base}/{info['file_path']}", timeout=120) as r:
            with open(destinazione, "wb") as f:
                f.write(r.read())

    def segnaposto(self, chat_id, testo="Ci sto pensando…"):
        """Messaggio visibile mentre Mark lavora; sparisce quando arriva la risposta."""
        try:
            return self.chiama("sendMessage", {"chat_id": chat_id, "text": testo, "disable_notification": True}, timeout=15)["message_id"]
        except Exception as e:
            log("segnaposto", repr(e))
            return None

    def aggiorna(self, chat_id, message_id, testo):
        """Cambia il testo del segnaposto mentre Mark lavora."""
        if not message_id:
            return
        try:
            self.chiama("editMessageText", {"chat_id": chat_id, "message_id": message_id, "text": testo}, timeout=10)
        except Exception as e:
            log("aggiorna", repr(e))

    def manda_voce(self, chat_id, percorso):
        """Manda un file OGG/Opus come nota vocale (multipart)."""
        confine = uuid.uuid4().hex
        with open(percorso, "rb") as f:
            audio = f.read()
        corpo = (
            f"--{confine}\r\nContent-Disposition: form-data; name=\"chat_id\"\r\n\r\n{chat_id}\r\n"
            f"--{confine}\r\nContent-Disposition: form-data; name=\"voice\"; filename=\"mark.ogg\"\r\n"
            f"Content-Type: audio/ogg\r\n\r\n"
        ).encode() + audio + f"\r\n--{confine}--\r\n".encode()
        req = urllib.request.Request(
            f"{self.base}/sendVoice", data=corpo,
            headers={"Content-Type": f"multipart/form-data; boundary={confine}"},
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            risposta = json.load(r)
        if not risposta.get("ok"):
            raise RuntimeError(f"Telegram sendVoice: {risposta.get('description')}")

    def scrivi(self, chat_id, testo, al_posto_di=None, silenzioso=False):
        # Il segnaposto si cancella e la risposta arriva come messaggio nuovo,
        # così la notifica sul telefono mostra la risposta vera.
        if al_posto_di:
            try:
                self.chiama("deleteMessage", {"chat_id": chat_id, "message_id": al_posto_di}, timeout=15)
            except Exception as e:
                log("segnaposto", repr(e))
        pezzi = dividi(testo)
        for pezzo in pezzi:
            self.chiama("sendMessage", {
                "chat_id": chat_id,
                "text": pezzo,
                "link_preview_options": {"is_disabled": True},
                "disable_notification": silenzioso,
            })


def dividi(testo, limite=LIMITE_TELEGRAM):
    """Telegram accetta al massimo 4096 caratteri: si spezza sui paragrafi."""
    testo = testo.strip() or "…"
    pezzi = []
    while len(testo) > limite:
        taglio = testo.rfind("\n\n", 0, limite)
        if taglio < limite // 2:
            taglio = testo.rfind("\n", 0, limite)
        if taglio < limite // 2:
            taglio = testo.rfind(" ", 0, limite)
        if taglio <= 0:
            taglio = limite
        pezzi.append(testo[:taglio].rstrip())
        testo = testo[taglio:].lstrip()
    pezzi.append(testo)
    return pezzi


def in_chiaro(testo):
    """Mark scrive in Markdown: su Telegram lo si rende leggibile come testo semplice."""
    testo = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r"\1: \2", testo)
    testo = re.sub(r"\*\*(.+?)\*\*", r"\1", testo)
    testo = re.sub(r"(?m)^#{1,6}\s*", "", testo)
    testo = re.sub(r"(?m)^\s*[-*]\s+", "• ", testo)
    return testo.strip()


# ---------- Mark (funzione Supabase) ----------

def chiama_funzione(chiave, dati, timeout=180):
    corpo = json.dumps(dati).encode()
    req = urllib.request.Request(FN_URL, data=corpo, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {SUPABASE_ANON}",
        "apikey": SUPABASE_ANON,
        "x-mark-key": chiave,
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def chiedi_a_mark(chiave, messaggi, allegati=None, on_stato=None):
    """Chiede a Mark. Con on_stato riceve i passi mentre lavora ("Leggo la mail…")."""
    richiesta = {"action": "chat", "messages": messaggi, "canale": "Telegram", "progressi": True}
    if allegati:
        richiesta["allegati"] = allegati
    corpo = json.dumps(richiesta).encode()
    for tentativo in range(2):
        req = urllib.request.Request(FN_URL, data=corpo, headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {SUPABASE_ANON}",
            "apikey": SUPABASE_ANON,
            "x-mark-key": chiave,
        })
        try:
            dati = {}
            ultimo_stato = None
            with urllib.request.urlopen(req, timeout=180) as r:
                for riga in r:
                    riga = riga.strip()
                    if not riga:
                        continue
                    pezzo = json.loads(riga)
                    if "stato" in pezzo:
                        if on_stato and pezzo["stato"] != ultimo_stato:
                            ultimo_stato = pezzo["stato"]
                            try:
                                on_stato(pezzo["stato"])
                            except Exception as e:
                                log("stato", repr(e))
                    else:
                        dati = pezzo
            break
        except urllib.error.HTTPError as e:
            try:
                dati = json.load(e)
            except Exception:
                dati = {}
            if e.code == 401:
                return "La chiave di Mark sul server non è giusta: va corretta in /etc/mark/mark.env."
            # 502/503/504: la funzione è caduta o non ha fatto in tempo, si riprova una volta da soli
            if e.code in (502, 503, 504) and tentativo == 0:
                log("mark", f"errore {e.code}, riprovo")
                time.sleep(4)
                continue
            return dati.get("error") or f"Mark non ha risposto (errore {e.code}) anche al secondo tentativo, riprova tra qualche minuto."
        except Exception as e:
            log("mark", repr(e))
            return "Non riesco a raggiungere Mark in questo momento, riprova tra poco."
    return dati.get("risposta") or dati.get("error") or "Mark non ha risposto, riprova tra poco."


# ---------- Voce di Mark (risposte vocali) ----------
# Voce neurale gratuita di Microsoft Edge (edge-tts, servizio non ufficiale): se non risponde, Mark scrive e basta.

VOCE = os.environ.get("MARK_VOCE", "it-IT-DiegoNeural")
FILE_VOCE = os.path.join(STATO, "voce")  # auto | sempre | mai
MAX_CARATTERI_VOCE = 900


def modo_voce(valore=None):
    if valore is None:
        try:
            with open(FILE_VOCE) as f:
                v = f.read().strip()
            return v if v in ("auto", "sempre", "mai") else "auto"
        except FileNotFoundError:
            return "auto"
    os.makedirs(STATO, exist_ok=True)
    with open(FILE_VOCE, "w") as f:
        f.write(valore)
    return valore


def da_leggere(testo):
    """Testo adatto alla voce: niente link, simboli o elenchi lunghi."""
    link = bool(re.search(r"https?://", testo))
    t = re.sub(r"https?://\S+", "", testo)
    t = re.sub(r"(?m)^\s*(?:[-*•]|\d+[.)])\s+", "", t)
    t = re.sub(r"[*_#`>•|]", " ", t)
    t = re.sub(r"[^\w\s.,;:!?'’()€%°àèéìòùÀÈÉÌÒÙ-]", " ", t)
    righe = [r.strip() for r in t.split("\n") if r.strip()]
    t = " ".join(r if r[-1] in ".:;!?," else r + "." for r in righe)
    t = re.sub(r"\s{2,}", " ", t).replace(" .", ".").strip()
    if len(t) > MAX_CARATTERI_VOCE:
        taglio = t.rfind(".", 0, MAX_CARATTERI_VOCE)
        t = t[: taglio + 1 if taglio > 200 else MAX_CARATTERI_VOCE] + " Il resto è nel messaggio."
    if link:
        t += " Il link è nel messaggio."
    return t


def sintetizza(testo, cartella):
    """Crea mark.ogg (Opus) dal testo. Ritorna il percorso o None."""
    import edge_tts
    mp3 = os.path.join(cartella, "mark.mp3")
    ogg = os.path.join(cartella, "mark.ogg")
    asyncio.run(edge_tts.Communicate(testo, VOCE, rate="-5%").save(mp3))
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", mp3, "-c:a", "libopus", "-b:a", "32k", ogg], check=True, timeout=60)
    return ogg


def rispondi_a_voce(tg, chat_id, testo):
    parlato = da_leggere(testo)
    if len(parlato) < 2:
        return
    try:
        with tempfile.TemporaryDirectory() as cartella:
            tg.manda_voce(chat_id, sintetizza(parlato, cartella))
    except Exception as e:
        log("voce", repr(e))


# ---------- Foto, screenshot e PDF ----------

TIPI_FILE = {"image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"}
MAX_BYTE_FILE = 8 * 1024 * 1024
MAX_BYTE_IMMAGINE = 5 * 1000 * 1000  # limite di Claude per un'immagine


def allegato_del_messaggio(msg):
    """(file_id, tipo, nome) della foto o del documento nel messaggio, oppure None."""
    foto = msg.get("photo")
    if foto:
        grande = max(foto, key=lambda f: f.get("file_size") or f.get("width", 0) * f.get("height", 0))
        return grande["file_id"], "image/jpeg", "foto", grande.get("file_size") or 0
    doc = msg.get("document")
    if doc:
        return doc["file_id"], (doc.get("mime_type") or "").lower(), doc.get("file_name") or "documento", doc.get("file_size") or 0
    return None


# ---------- Note vocali ----------

_modello = None
_lock_modello = threading.Lock()


def _carica_modello():
    global _modello
    if _modello is None:
        from faster_whisper import WhisperModel
        nome = os.environ.get("WHISPER_MODELLO", "small")
        _modello = WhisperModel(nome, device="cpu", compute_type="int8")
    return _modello


def trascrivi(percorso, lingua="it"):
    """Trascrive un file audio. Ritorna (testo, lingua). lingua=None la riconosce da sola."""
    with _lock_modello:
        segmenti, info = _carica_modello().transcribe(percorso, language=lingua, vad_filter=True, beam_size=1)
        testo = " ".join(s.text.strip() for s in segmenti).strip()
        return testo, (lingua or info.language)


# ---------- Conversazione ----------

class Memoria:
    """Ultimi messaggi degli ultimi 15 minuti, come per Siri."""

    def __init__(self):
        self.voci = []  # (istante, ruolo, testo)
        self.lock = threading.Lock()

    def storia(self):
        with self.lock:
            return self._storia()

    def _storia(self):
        limite = time.time() - MEMORIA_SECONDI
        self.voci = [v for v in self.voci if v[0] >= limite][-MAX_MESSAGGI:]
        storia = []
        for _, ruolo, testo in self.voci:
            if storia and storia[-1]["role"] == ruolo:
                storia[-1]["content"] += "\n\n" + testo  # avvisi di fila diventano un messaggio
            else:
                storia.append({"role": ruolo, "content": testo})
        # La conversazione deve iniziare da Alessio: se inizia da un avviso lo si dice
        if storia and storia[0]["role"] != "user":
            storia.insert(0, {"role": "user", "content": "(Mark mi ha mandato questi avvisi automatici)"})
        return storia

    def aggiungi(self, ruolo, testo):
        with self.lock:
            self.voci.append((time.time(), ruolo, testo))

    def azzera(self):
        self.voci = []


def chat_abbinata():
    try:
        with open(FILE_CHAT) as f:
            return int(f.read().strip())
    except (FileNotFoundError, ValueError):
        return None


def abbina(chat_id):
    os.makedirs(STATO, exist_ok=True)
    with open(FILE_CHAT, "w") as f:
        f.write(str(chat_id))
    os.chmod(FILE_CHAT, 0o600)


class StaScrivendo:
    """Mostra "sta scrivendo…" finché Mark lavora."""

    def __init__(self, tg, chat_id, azione="typing"):
        self.tg, self.chat_id, self.fine = tg, chat_id, threading.Event()
        self.azione = azione

    def __enter__(self):
        threading.Thread(target=self._giro, daemon=True).start()
        return self

    def _giro(self):
        while not self.fine.is_set():
            try:
                self.tg.chiama("sendChatAction", {"chat_id": self.chat_id, "action": self.azione}, timeout=10)
            except Exception:
                pass
            self.fine.wait(4.5)

    def __exit__(self, *_):
        self.fine.set()


def gestisci(tg, chiave, codice, memoria, msg):
    chat = msg.get("chat", {})
    chat_id = chat.get("id")
    mittente = (msg.get("from") or {}).get("id")
    if chat.get("type") != "private" or chat_id != mittente:
        return
    testo = (msg.get("text") or "").strip()
    abbinata = chat_abbinata()

    if abbinata is None:
        parola = re.sub(r"^/start\s*", "", testo).strip()
        if codice and parola and parola.lower() == codice.lower():
            abbina(chat_id)
            log("abbinata la chat", chat_id)
            tg.scrivi(chat_id, "Ciao Alessio, sono Mark. Da ora rispondo solo a te, qui. "
                               "Scrivimi o mandami una nota vocale. Con /nuova ricominciamo da capo.")
        return
    if chat_id != abbinata:
        return  # chiunque altro viene ignorato

    if testo in ("/avvisi_off", "/avvisi_on"):
        avvisi_attivi(testo == "/avvisi_on")
        tg.scrivi(chat_id, "Avvisi riattivati." if testo == "/avvisi_on"
                  else "Avvisi in pausa. Li riattivi con /avvisi_on.")
        return

    if testo in ("/voce_sempre", "/voce_auto", "/voce_mai"):
        modo = modo_voce(testo.removeprefix("/voce_"))
        tg.scrivi(chat_id, {
            "sempre": "Da ora ti rispondo sempre anche a voce.",
            "auto": "Ti rispondo a voce quando mi mandi una nota vocale.",
            "mai": "Niente più risposte a voce, solo testo.",
        }[modo])
        return

    if testo in ("/nuova", "/start"):
        memoria.azzera()
        tg.scrivi(chat_id, "Fatto, ricominciamo da capo.")
        return

    voce = msg.get("voice") or msg.get("audio")
    ha_parlato = bool(voce)
    if voce and not testo:
        ascolto = tg.segnaposto(chat_id, "Sto ascoltando la nota vocale…")
        with StaScrivendo(tg, chat_id), tempfile.TemporaryDirectory() as cartella:
            percorso = os.path.join(cartella, "nota.ogg")
            try:
                tg.scarica(voce["file_id"], percorso)
                testo, _ = trascrivi(percorso)
            except Exception as e:
                log("trascrizione", repr(e))
                tg.scrivi(chat_id, "Non sono riuscito a trascrivere la nota vocale, riprova o scrivimi.", al_posto_di=ascolto)
                return
        if not testo:
            tg.scrivi(chat_id, "Non ho sentito niente nella nota vocale, riprova.", al_posto_di=ascolto)
            return
        tg.scrivi(chat_id, f"Ho capito: «{testo}»", al_posto_di=ascolto)

    allegati = []
    file = allegato_del_messaggio(msg)
    if file:
        file_id, tipo, nome, peso = file
        if tipo not in TIPI_FILE:
            tg.scrivi(chat_id, "Leggo testo, note vocali, foto, screenshot e PDF. Questo tipo di file ancora no.")
            return
        if tipo != "application/pdf":
            limite = MAX_BYTE_IMMAGINE
        else:
            limite = MAX_BYTE_FILE
        if peso > limite:
            tg.scrivi(chat_id, "Il file è troppo grande. Mandami uno screenshot della parte che conta, oppure la foto normale invece del file.")
            return
        with tempfile.TemporaryDirectory() as cartella:
            percorso = os.path.join(cartella, "allegato")
            try:
                tg.scarica(file_id, percorso)
                with open(percorso, "rb") as f:
                    dati = f.read()
            except Exception as e:
                log("allegato", repr(e))
                tg.scrivi(chat_id, "Non sono riuscito a scaricare il file, riprova.")
                return
        if len(dati) > limite:
            tg.scrivi(chat_id, "Il file è troppo grande. Mandami uno screenshot della parte che conta, oppure la foto normale invece del file.")
            return
        allegati.append({"tipo": tipo, "dati": base64.b64encode(dati).decode()})
        didascalia = (msg.get("caption") or "").strip()
        testo = f"[Ti ho mandato {'un PDF' if tipo == 'application/pdf' else 'una foto o uno screenshot'}: {nome}] " + (
            didascalia or "Guardalo e dimmi cosa c'è e cosa devo fare."
        )

    if not testo:
        tg.scrivi(chat_id, "Leggo testo, note vocali, foto, screenshot e PDF. Questo messaggio non lo so leggere.")
        return

    memoria.aggiungi("user", testo)
    attesa = tg.segnaposto(chat_id)
    with StaScrivendo(tg, chat_id):
        risposta = chiedi_a_mark(
            chiave, memoria.storia(), allegati,
            on_stato=lambda t: tg.aggiorna(chat_id, attesa, t),
        )
    memoria.aggiungi("assistant", risposta)
    tg.scrivi(chat_id, in_chiaro(risposta), al_posto_di=attesa)
    modo = modo_voce()
    if modo == "sempre" or (modo == "auto" and ha_parlato):
        with StaScrivendo(tg, chat_id, "record_voice"):
            rispondi_a_voce(tg, chat_id, risposta)


# ---------- Avvisi da evento ----------

ROMA = ZoneInfo("Europe/Rome")
FILE_PAUSA = os.path.join(STATO, "avvisi_off")
OGNI_SECONDI = 10 * 60
ORA_INIZIO, ORA_FINE = 7, 22  # di notte niente avvisi: arrivano al mattino


def avvisi_attivi(valore=None):
    if valore is None:
        return not os.path.exists(FILE_PAUSA)
    os.makedirs(STATO, exist_ok=True)
    if valore:
        if os.path.exists(FILE_PAUSA):
            os.remove(FILE_PAUSA)
    else:
        open(FILE_PAUSA, "w").close()
    return valore


def giro_sentinella(tg, chiave, memoria):
    chat_id = chat_abbinata()
    if chat_id is None or not avvisi_attivi():
        return
    if not ORA_INIZIO <= datetime.now(ROMA).hour < ORA_FINE:
        return
    esito = chiama_funzione(chiave, {"action": "sentinella"}, timeout=120)
    if esito.get("problemi"):
        log("sentinella", esito["problemi"])
    for avviso in esito.get("avvisi") or []:
        testo = f"🔔 {avviso}"
        memoria.aggiungi("assistant", testo)
        tg.scrivi(chat_id, in_chiaro(testo))


def sentinella(tg, chiave, memoria):
    time.sleep(30)
    while True:
        try:
            giro_sentinella(tg, chiave, memoria)
        except Exception as e:
            log("sentinella", repr(e))
        time.sleep(OGNI_SECONDI)

# ---------- Biblioteca: Mark studia video e pagine ----------
# La chat mette i link in coda (tabella mark_biblioteca); qui si leggono sottotitoli o parlato
# e il testo va alla funzione, che scrive la scheda e torna l'avviso per Telegram.
# YouTube blocca spesso i server nei datacenter: in quel caso si passa da Apify (APIFY_TOKEN in mark.env).

OGNI_SECONDI_BIBLIOTECA = 60
MAX_SECONDI_AUDIO = 30 * 60  # oltre, si trascrivono i primi 30 minuti
PEZZO_SECONDI = 300  # pezzi da 5 minuti: tra un pezzo e l'altro passano le note vocali
YT_DLP = os.path.join(os.path.dirname(sys.executable), "yt-dlp")
RE_YOUTUBE = re.compile(r"^https?://(www\.|m\.)?(youtube\.com/(watch|shorts/|live/)|youtu\.be/)", re.I)
RE_INSTAGRAM = re.compile(r"^https?://(www\.)?instagram\.com/(reels?|p|tv)/", re.I)


def scarica_url(url, destinazione, timeout=120, limite=300 * 1024 * 1024):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r, open(destinazione, "wb") as f:
        letti = 0
        while True:
            pezzo = r.read(1 << 20)
            if not pezzo:
                break
            letti += len(pezzo)
            if letti > limite:
                raise RuntimeError("file troppo grande")
            f.write(pezzo)


def apify(attore, dati, timeout=180):
    token = os.environ.get("APIFY_TOKEN", "").strip()
    if not token:
        raise RuntimeError("manca la chiave Apify sul server (APIFY_TOKEN)")
    req = urllib.request.Request(
        f"https://api.apify.com/v2/acts/{attore}/run-sync-get-dataset-items?timeout={timeout - 20}&maxTotalChargeUsd=0.2",
        data=json.dumps(dati).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token.strip().strip(chr(34)).strip(chr(39))}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        # Il motivo vero sta nel corpo della risposta di Apify: senza, un 400 non si capisce
        try:
            motivo = json.load(e).get("error", {}).get("message", "")
        except Exception:
            motivo = ""
        log("apify", attore, e.code, motivo[:300])
        raise RuntimeError(f"Apify {e.code}: {motivo[:150] or e.reason}") from None


def trascrivi_lungo(audio, cartella):
    """Trascrive fino a 30 minuti a pezzi da 5. Ritorna (testo, tagliato)."""
    pezzi = os.path.join(cartella, "pezzi")
    os.makedirs(pezzi, exist_ok=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", audio, "-t", str(MAX_SECONDI_AUDIO), "-vn", "-ac", "1", "-ar", "16000",
                    "-f", "segment", "-segment_time", str(PEZZO_SECONDI), os.path.join(pezzi, "p%03d.wav")], check=True, timeout=900)
    durata = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audio],
                            capture_output=True, text=True, timeout=60).stdout.strip()
    testi, lingua = [], None
    for nome in sorted(os.listdir(pezzi)):
        t, lingua = trascrivi(os.path.join(pezzi, nome), lingua)
        if t:
            testi.append(t)
    try:
        tagliato = float(durata) > MAX_SECONDI_AUDIO + 5
    except ValueError:
        tagliato = False
    return " ".join(testi).strip(), tagliato


def testo_vtt(percorso):
    """Sottotitoli VTT in testo semplice, senza le righe ripetute dei sottotitoli automatici."""
    righe, ultima = [], None
    with open(percorso, encoding="utf-8", errors="replace") as f:
        for riga in f:
            riga = riga.strip()
            if not riga or riga == "WEBVTT" or "-->" in riga or riga.isdigit() or riga.startswith(("Kind:", "Language:", "NOTE")):
                continue
            riga = re.sub(r"<[^>]+>", "", riga).strip()
            if riga and riga != ultima:
                righe.append(riga)
                ultima = riga
    return " ".join(righe)


def testo_generico(voce):
    """Il testo di una trascrizione in un risultato Apify di forma non nota: stringa o elenco di pezzi con text."""
    for chiave in ("transcript_text", "transcriptText", "text", "transcript", "captions", "subtitles", "data"):
        v = voce.get(chiave) if isinstance(voce, dict) else None
        if isinstance(v, str) and len(v) > 50:
            return v
        if isinstance(v, list) and v:
            return " ".join(str(x.get("text", "")) if isinstance(x, dict) else str(x) for x in v)
    return ""


def studia_youtube(url, cartella):
    esito = {"tipo": "youtube"}
    try:
        with urllib.request.urlopen(f"https://www.youtube.com/oembed?format=json&url={urllib.parse.quote(url, safe='')}", timeout=20) as r:
            o = json.load(r)
        esito.update(titolo=o.get("title", ""), autore=o.get("author_name", ""))
    except Exception as e:
        log("biblioteca oembed", repr(e))
    problema = ""
    try:
        r = subprocess.run([YT_DLP, "--skip-download", "--write-info-json", "--write-subs", "--write-auto-subs",
                            "--sub-langs", "it,it-orig,en,en-orig", "--sub-format", "vtt", "--no-playlist",
                            "-o", os.path.join(cartella, "v.%(ext)s"), url], capture_output=True, text=True, timeout=180)
        if r.returncode != 0:
            problema = (r.stderr.strip().splitlines() or ["errore"])[-1][:200]
        info_json = os.path.join(cartella, "v.info.json")
        if os.path.exists(info_json):
            with open(info_json) as f:
                info = json.load(f)
            d = str(info.get("upload_date") or "")
            esito.update(
                titolo=info.get("title") or esito.get("titolo", ""),
                autore=info.get("uploader") or info.get("channel") or esito.get("autore", ""),
                pubblicato=f"{d[6:8]}/{d[4:6]}/{d[:4]}" if len(d) == 8 else "",
                durata=info.get("duration") or 0,
                didascalia=(info.get("description") or "")[:3000],
            )
        for lingua in ("it", "it-orig", "en", "en-orig"):
            vtt = os.path.join(cartella, f"v.{lingua}.vtt")
            if os.path.exists(vtt):
                testo = testo_vtt(vtt)
                if len(testo) > 200:
                    esito.update(trascrizione=testo, fonte_testo=f"sottotitoli YouTube ({lingua})")
                    return esito
        # Niente sottotitoli: si scarica l'audio e lo si trascrive qui
        if not problema and esito.get("durata"):
            r = subprocess.run([YT_DLP, "-f", "bestaudio/best", "--no-playlist", "-o", os.path.join(cartella, "audio.%(ext)s"), url],
                               capture_output=True, text=True, timeout=900)
            audio = next((os.path.join(cartella, n) for n in os.listdir(cartella) if n.startswith("audio.")), None)
            if r.returncode == 0 and audio:
                testo, tagliato = trascrivi_lungo(audio, cartella)
                if testo:
                    esito.update(trascrizione=testo, fonte_testo="trascrizione dell'audio sul server" + (" (primi 30 minuti)" if tagliato else ""))
                    return esito
            else:
                problema = (r.stderr.strip().splitlines() or ["errore"])[-1][:200]
    except Exception as e:
        problema = repr(e)[:200]
    # YouTube ha bloccato il server: si chiedono i sottotitoli ad Apify
    log("biblioteca youtube", problema or "senza sottotitoli", "provo Apify")
    # Link nella forma classica: alcuni servizi non accettano youtu.be o i parametri di condivisione
    m = re.search(r"(?:youtu\.be/|v=|shorts/|live/)([A-Za-z0-9_-]{11})", url)
    classico = f"https://www.youtube.com/watch?v={m.group(1)}" if m else url
    errori = []
    for attore, dati_attore, leggi in (
        ("pintostudio~youtube-transcript-scraper", {"videoUrl": classico},
         lambda d: " ".join(str(x.get("text", "")).replace("\n", " ") for x in ((d[0].get("data") if d else None) or []))),
        ("starvibe~youtube-video-transcript", {"youtube_url": classico, "include_transcript_text": True},
         lambda d: testo_generico(d[0] if d else {})),
    ):
        try:
            testo = leggi(apify(attore, dati_attore)).strip()
            if testo:
                esito.update(trascrizione=testo, fonte_testo=f"sottotitoli YouTube via Apify ({attore.split('~')[0]})")
                return esito
            errori.append(f"{attore.split('~')[0]}: nessun sottotitolo")
        except Exception as e:
            errori.append(f"{attore.split('~')[0]}: {str(e)[:100]}")
    problema = "YouTube blocca il server e Apify non ha dato i sottotitoli (" + "; ".join(errori) + ")"
    esito["errore"] = problema
    return esito


def jpeg(sorgente, destinazione):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", sorgente, "-vf", "scale='min(1080,iw)':-2", "-q:v", "4", destinazione],
                   check=True, timeout=60)
    with open(destinazione, "rb") as f:
        return base64.b64encode(f.read()).decode()


def studia_instagram(url, cartella):
    esito = {"tipo": "instagram"}
    dati = apify("apify~instagram-post-scraper", {"username": [url], "resultsLimit": 1})
    if not dati or dati[0].get("error"):
        esito["errore"] = "Instagram non ha dato il post (privato o rimosso?)"
        return esito
    p = dati[0]
    ts = str(p.get("timestamp") or "")
    esito.update(
        autore="@" + str(p.get("ownerUsername") or "?"),
        titolo=(p.get("caption") or "").split("\n")[0][:150],
        pubblicato=f"{ts[8:10]}/{ts[5:7]}/{ts[:4]}" if len(ts) >= 10 else "",
        durata=p.get("videoDuration") or 0,
        didascalia=(p.get("caption") or "")[:5000],
    )
    if p.get("videoUrl"):
        video = os.path.join(cartella, "reel.mp4")
        scarica_url(p["videoUrl"], video)
        testo, tagliato = trascrivi_lungo(video, cartella)
        esito.update(trascrizione=testo, fonte_testo="trascrizione dell'audio del reel sul server" + (" (primi 30 minuti)" if tagliato else ""))
        # Un fotogramma ogni ~10 secondi (massimo 6) per le scritte a schermo
        try:
            durata = float(p.get("videoDuration") or 0) or 30
            passo = max(durata / 6, 3)
            immagini = []
            for k in range(6):
                fotogramma = os.path.join(cartella, f"f{k}.jpg")
                subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", str(k * passo + 1), "-i", video, "-frames:v", "1",
                                "-vf", "scale=540:-2", "-q:v", "5", fotogramma], timeout=60)
                if os.path.exists(fotogramma) and os.path.getsize(fotogramma) > 0:
                    with open(fotogramma, "rb") as f:
                        immagini.append(base64.b64encode(f.read()).decode())
            esito["immagini"] = immagini
        except Exception as e:
            log("biblioteca fotogrammi", repr(e))
    else:
        indirizzi = [c.get("displayUrl") for c in (p.get("childPosts") or []) if c.get("displayUrl")] or [p.get("displayUrl")]
        immagini = []
        for k, u in enumerate([u for u in indirizzi if u][:8]):
            try:
                grezza = os.path.join(cartella, f"s{k}")
                scarica_url(u, grezza, limite=20 * 1024 * 1024)
                immagini.append(jpeg(grezza, os.path.join(cartella, f"s{k}.jpg")))
            except Exception as e:
                log("biblioteca slide", repr(e))
        esito["immagini"] = immagini
        esito["fonte_testo"] = "didascalia e immagini del post"
    return esito


def giro_biblioteca(tg, chiave, memoria):
    risposta = chiama_funzione(chiave, {"action": "biblioteca_prossimo"}, timeout=60)
    for url in risposta.get("persi") or []:
        log("biblioteca persa", url)
    lavoro = risposta.get("lavoro")
    if not lavoro:
        return False
    url = lavoro["url"]
    log("biblioteca studio", url)
    with tempfile.TemporaryDirectory() as cartella:
        try:
            if RE_YOUTUBE.match(url):
                esito = studia_youtube(url, cartella)
            elif RE_INSTAGRAM.match(url):
                esito = studia_instagram(url, cartella)
            else:
                esito = {"tipo": "pagina"}  # la pagina la legge la funzione
        except Exception as e:
            log("biblioteca", repr(e))
            esito = {"tipo": "youtube" if RE_YOUTUBE.match(url) else "instagram" if RE_INSTAGRAM.match(url) else "pagina",
                     "errore": str(e)[:200] or "errore sul server"}
    esito.update(action="biblioteca_salva", id=lavoro["id"])
    fatto = chiama_funzione(chiave, esito, timeout=300)
    avviso = fatto.get("avviso")
    chat_id = chat_abbinata()
    if avviso and chat_id:
        notte = not ORA_INIZIO <= datetime.now(ROMA).hour < ORA_FINE
        memoria.aggiungi("assistant", avviso)
        tg.scrivi(chat_id, in_chiaro(avviso), silenzioso=notte)
    return True


def biblioteca(tg, chiave, memoria):
    time.sleep(45)
    while True:
        altro = False
        try:
            altro = giro_biblioteca(tg, chiave, memoria)
        except Exception as e:
            log("biblioteca", repr(e))
        time.sleep(5 if altro else OGNI_SECONDI_BIBLIOTECA)


def main():
    token = os.environ.get("TELEGRAM_TOKEN", "").strip()
    chiave = os.environ.get("MARK_ACCESS_KEY", "").strip()
    codice = os.environ.get("CODICE_ABBINAMENTO", "").strip()
    if not token or not chiave:
        log("Mancano TELEGRAM_TOKEN o MARK_ACCESS_KEY in /etc/mark/mark.env")
        sys.exit(1)
    tg = Telegram(token)
    memoria = Memoria()
    offset = None
    threading.Thread(target=sentinella, args=(tg, chiave, memoria), daemon=True).start()
    threading.Thread(target=biblioteca, args=(tg, chiave, memoria), daemon=True).start()
    log("Mark su Telegram è partito", "(chat abbinata)" if chat_abbinata() else "(in attesa di abbinamento)")
    while True:
        try:
            aggiornamenti = tg.chiama("getUpdates", {
                "timeout": 50, "offset": offset, "allowed_updates": ["message"],
            })
        except Exception as e:
            log("getUpdates", repr(e))
            time.sleep(5)
            continue
        for u in aggiornamenti:
            offset = u["update_id"] + 1
            msg = u.get("message")
            # I messaggi più vecchi di 10 minuti (servizio spento) non si eseguono
            if not msg or msg.get("date", 0) < time.time() - 600:
                continue
            try:
                gestisci(tg, chiave, codice, memoria, msg)
            except Exception as e:
                log("messaggio", repr(e))


if __name__ == "__main__":
    main()
