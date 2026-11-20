"""Risposte a un messaggio preciso su Telegram: Mark deve sapere a cosa si riferisce Alessio.

Si lancia con: python3 -m unittest tests/test_mark_telegram_risposte.py
"""
import importlib.util
import os
import pathlib
import tempfile
import unittest

QUI = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("mark_telegram", QUI.parent / "server-mark" / "mark_telegram.py")
mt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mt)

AVVISO = ("🔔 Mail con segnali di truffa alle 06:48: finge di essere PayPal, ma le risposte vanno a un altro dominio. "
          "Non cliccare niente. Apri la mail qui: https://mail.google.com/mail/u/0/#all/19a. Scrivimi «controlla» e la verifico io.")


class Risposte(unittest.TestCase):
    def setUp(self):
        self.cartella = tempfile.TemporaryDirectory()
        self.archivio = mt.Archivio(os.path.join(self.cartella.name, "avvisi.json"))

    def tearDown(self):
        self.cartella.cleanup()

    def test_senza_risposta_niente_contesto(self):
        self.assertEqual(mt.contesto_risposta({"text": "Controlla"}, self.archivio), "")

    def test_risposta_a_un_avviso_vecchio(self):
        self.archivio.segna([501], AVVISO, ["mail 98765 | 20/11 06:48 | PayPal <service@x.com> | Ricevuta di pagamento | ⚠ SEGNALI DI TRUFFA: Reply-To diverso"])
        msg = {"text": "Controlla", "reply_to_message": {
            "message_id": 501, "from": {"id": 1, "is_bot": True}, "date": 1795154760, "text": AVVISO}}
        c = mt.contesto_risposta(msg, self.archivio)
        self.assertIn("[Sto rispondendo a un tuo messaggio (di Mark) delle 07:06 del 20/11", c)
        self.assertIn("finge di essere PayPal", c)
        self.assertIn("mail 98765 |", c)

    def test_link_nascosti_e_citazione_parziale(self):
        msg = {"text": "questo", "quote": {"text": "finge di essere PayPal"}, "reply_to_message": {
            "message_id": 7, "from": {"is_bot": True}, "text": "Apri la mail",
            "entities": [{"type": "text_link", "offset": 0, "length": 4, "url": "https://mail.google.com/x"}]}}
        c = mt.contesto_risposta(msg, self.archivio)
        self.assertIn("Link nel messaggio: https://mail.google.com/x", c)
        self.assertIn("[In particolare questa parte: «finge di essere PayPal»]", c)

    def test_risposta_a_un_suo_messaggio_e_a_una_nota_vocale(self):
        c = mt.contesto_risposta({"text": "ok", "reply_to_message": {"from": {"is_bot": False}, "text": "compra il latte"}})
        self.assertIn("un mio messaggio precedente", c)
        c = mt.contesto_risposta({"text": "ripeti", "reply_to_message": {"from": {"is_bot": True}, "voice": {"file_id": "x"}}})
        self.assertIn("(una nota vocale)", c)

    def test_archivio_tiene_gli_ultimi(self):
        for i in range(mt.MAX_ARCHIVIO + 20):
            self.archivio.segna([i], f"avviso {i}")
        self.assertIsNone(self.archivio.trova(0))
        self.assertEqual(self.archivio.trova(mt.MAX_ARCHIVIO + 19)["testo"], f"avviso {mt.MAX_ARCHIVIO + 19}")


class Gestisci(unittest.TestCase):
    """Il testo che arriva alla funzione contiene il messaggio citato."""

    def test_la_funzione_riceve_il_citato(self):
        mandati = {}

        class TG:
            def scrivi(self, *a, **k): return [1]
            def segnaposto(self, *a, **k): return 9
            def aggiorna(self, *a, **k): pass
            def manda_schede(self, *a, **k): pass
            def chiama(self, *a, **k): return {}

        mt.chat_abbinata = lambda: 42
        mt.modo_voce = lambda *a: "mai"
        mt.chiedi_a_mark = lambda chiave, storia, allegati, **k: mandati.setdefault("storia", storia) and "fatto"
        memoria = mt.Memoria()
        msg = {"chat": {"id": 42, "type": "private"}, "from": {"id": 42}, "text": "Controlla",
               "reply_to_message": {"message_id": 3, "from": {"is_bot": True}, "text": AVVISO}}
        mt.gestisci(TG(), "k", "", memoria, msg, None)
        ultimo = mandati["storia"][-1]["content"]
        self.assertTrue(ultimo.startswith("[Sto rispondendo a un tuo messaggio (di Mark)"))
        self.assertTrue(ultimo.endswith("Controlla"))


if __name__ == "__main__":
    unittest.main()
