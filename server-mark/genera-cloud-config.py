#!/usr/bin/env python3
"""Genera cloud-config.yaml (da incollare su Hetzner) con dentro mark_telegram.py."""
import pathlib

qui = pathlib.Path(__file__).parent
bot = (qui / "mark_telegram.py").read_text()
rientro = lambda testo, n: "".join((" " * n + r) if r.strip() else r for r in testo.splitlines(True))

modello = """#cloud-config
# Mark su Telegram. Cambia SOLO le tre parole in MAIUSCOLO qui sotto,
# lasciando "=" e senza spazi. Il resto non va toccato.
write_files:
  - path: /etc/mark/mark.env
    permissions: "0600"
    content: |
      TELEGRAM_TOKEN=INCOLLA_IL_TOKEN_DI_BOTFATHER
      MARK_ACCESS_KEY=INCOLLA_LA_CHIAVE_DI_MARK
      CODICE_ABBINAMENTO=SCEGLI_UNA_PAROLA
      HF_HOME=/var/lib/mark/hf
  - path: /etc/systemd/system/mark-telegram.service
    content: |
      [Unit]
      Description=Mark su Telegram
      After=network-online.target
      Wants=network-online.target
      [Service]
      User=mark
      EnvironmentFile=/etc/mark/mark.env
      ExecStart=/opt/mark/venv/bin/python /opt/mark/mark_telegram.py
      Restart=always
      RestartSec=10
      NoNewPrivileges=true
      ProtectSystem=strict
      ProtectHome=true
      PrivateTmp=true
      ReadWritePaths=/var/lib/mark
      [Install]
      WantedBy=multi-user.target
  - path: /etc/apt/apt.conf.d/20auto-upgrades
    content: |
      APT::Periodic::Update-Package-Lists "1";
      APT::Periodic::Unattended-Upgrade "1";
  - path: /etc/apt/apt.conf.d/52mark-riavvio
    content: |
      Unattended-Upgrade::Automatic-Reboot "true";
      Unattended-Upgrade::Automatic-Reboot-Time "04:30";
  - path: /etc/ssh/sshd_config.d/90-mark.conf
    content: |
      PasswordAuthentication no
      KbdInteractiveAuthentication no
  - path: /opt/mark/mark_telegram.py
    permissions: "0755"
    content: |
__BOT__
package_update: true
package_upgrade: true
packages:
  - python3-venv
  - unattended-upgrades
  - ufw
runcmd:
  - useradd --system --home-dir /var/lib/mark --create-home --shell /usr/sbin/nologin mark
  - chown root:mark /etc/mark/mark.env
  - chmod 0640 /etc/mark/mark.env
  - ufw default deny incoming
  - ufw default allow outgoing
  - ufw --force enable
  - python3 -m venv /opt/mark/venv
  - /opt/mark/venv/bin/pip install --no-cache-dir faster-whisper==1.2.1 "av<16"
  - sudo -u mark env HF_HOME=/var/lib/mark/hf /opt/mark/venv/bin/python -c "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8')"
  - systemctl daemon-reload
  - systemctl enable --now mark-telegram
  - systemctl restart ssh
"""
uscita = modello.replace("__BOT__\n", rientro(bot, 6))
(qui / "cloud-config.yaml").write_text(uscita)
print(f"cloud-config.yaml: {len(uscita.encode())} byte (limite Hetzner 32 KiB)")
