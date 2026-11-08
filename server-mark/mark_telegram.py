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

    def scrivi(self, chat_id, testo, al_posto_di=None):
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


def trascrivi(percorso):
    global _modello
    with _lock_modello:
        if _modello is None:
            from faster_whisper import WhisperModel
            nome = os.environ.get("WHISPER_MODELLO", "small")
            _modello = WhisperModel(nome, device="cpu", compute_type="int8")
        segmenti, _ = _modello.transcribe(percorso, language="it", vad_filter=True, beam_size=1)
        return " ".join(s.text.strip() for s in segmenti).strip()


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
                testo = trascrivi(percorso)
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
