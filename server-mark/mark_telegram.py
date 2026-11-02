#!/usr/bin/env python3
"""Mark su Telegram.

Gira sul server Hetzner di Mark. Riceve i messaggi del bot Telegram,
trascrive le note vocali sul server (faster-whisper) e passa il testo
alla funzione `mark` su Supabase, la stessa della web-app.

Risponde solo alla chat abbinata con la parola di abbinamento.
Le chiavi stanno in /etc/mark/mark.env (leggibile solo da root e da mark).
"""
import json
import os
import re
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

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

def chiedi_a_mark(chiave, messaggi):
    corpo = json.dumps({"action": "chat", "messages": messaggi}).encode()
    req = urllib.request.Request(FN_URL, data=corpo, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {SUPABASE_ANON}",
        "apikey": SUPABASE_ANON,
        "x-mark-key": chiave,
    })
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            dati = json.load(r)
    except urllib.error.HTTPError as e:
        try:
            dati = json.load(e)
        except Exception:
            dati = {}
        if e.code == 401:
            return "La chiave di Mark sul server non è giusta: va corretta in /etc/mark/mark.env."
        return dati.get("error") or f"Mark non ha risposto (errore {e.code}), riprova tra poco."
    except Exception as e:
        log("mark", repr(e))
        return "Non riesco a raggiungere Mark in questo momento, riprova tra poco."
    return dati.get("risposta") or dati.get("error") or "Mark non ha risposto, riprova tra poco."


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

    def storia(self):
        limite = time.time() - MEMORIA_SECONDI
        self.voci = [v for v in self.voci if v[0] >= limite][-MAX_MESSAGGI:]
        while self.voci and self.voci[0][1] != "user":
            self.voci.pop(0)
        return [{"role": r, "content": t} for _, r, t in self.voci]

    def aggiungi(self, ruolo, testo):
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

    def __init__(self, tg, chat_id):
        self.tg, self.chat_id, self.fine = tg, chat_id, threading.Event()

    def __enter__(self):
        threading.Thread(target=self._giro, daemon=True).start()
        return self

    def _giro(self):
        while not self.fine.is_set():
            try:
                self.tg.chiama("sendChatAction", {"chat_id": self.chat_id, "action": "typing"}, timeout=10)
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

    if testo in ("/nuova", "/start"):
        memoria.azzera()
        tg.scrivi(chat_id, "Fatto, ricominciamo da capo.")
        return

    voce = msg.get("voice") or msg.get("audio")
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

    if not testo:
        tg.scrivi(chat_id, "Per ora leggo testo e note vocali.")
        return

    memoria.aggiungi("user", testo)
    attesa = tg.segnaposto(chat_id)
    with StaScrivendo(tg, chat_id):
        risposta = chiedi_a_mark(chiave, memoria.storia())
    memoria.aggiungi("assistant", risposta)
    tg.scrivi(chat_id, in_chiaro(risposta), al_posto_di=attesa)


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
