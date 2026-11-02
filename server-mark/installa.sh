#!/bin/bash
# Prepara il server di Mark su Telegram. Lo lancia il Cloud config di Hetzner
# con il commit da usare: bash installa.sh <commit>
# Le chiavi sono già in /etc/mark/mark.env (scritto dal Cloud config).
set -euo pipefail
COMMIT="${1:?manca il commit}"
BASE="https://raw.githubusercontent.com/venturalessio/menu-famiglia/${COMMIT}/server-mark"
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get -y upgrade
apt-get -y install python3-venv unattended-upgrades ufw curl

# Aggiornamenti di sicurezza automatici, riavvio alle 4:30 se serve
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat > /etc/apt/apt.conf.d/52mark-riavvio <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
EOF

# Niente accesso SSH con password; nessuna connessione in entrata
cat > /etc/ssh/sshd_config.d/90-mark.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
systemctl restart ssh || true
ufw default deny incoming
ufw default allow outgoing
ufw --force enable

# Utente senza privilegi e chiavi leggibili solo da root e da mark
id mark >/dev/null 2>&1 || useradd --system --home-dir /var/lib/mark --create-home --shell /usr/sbin/nologin mark
grep -q '^HF_HOME=' /etc/mark/mark.env || echo 'HF_HOME=/var/lib/mark/hf' >> /etc/mark/mark.env
sed -i 's/\r$//' /etc/mark/mark.env
chown root:mark /etc/mark/mark.env
chmod 0640 /etc/mark/mark.env

# Il bot e le sue librerie
mkdir -p /opt/mark
curl -fsSL "${BASE}/mark_telegram.py" -o /opt/mark/mark_telegram.py
chmod 0755 /opt/mark/mark_telegram.py
python3 -m venv /opt/mark/venv
/opt/mark/venv/bin/pip install --no-cache-dir faster-whisper==1.2.1 "av<16"
sudo -u mark env HF_HOME=/var/lib/mark/hf /opt/mark/venv/bin/python -c \
  "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8')"

cat > /etc/systemd/system/mark-telegram.service <<'EOF'
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
EOF
systemctl daemon-reload
systemctl enable mark-telegram
systemctl restart mark-telegram

# Per aggiornare in futuro: aggiorna-mark <tag o commit>
cat > /usr/local/bin/aggiorna-mark <<'FINE'
#!/bin/bash
set -euo pipefail
V="${1:?scrivi la versione, es. mark-v3}"
curl -fsSL "https://raw.githubusercontent.com/venturalessio/menu-famiglia/${V}/server-mark/installa.sh" -o /root/installa.sh
if bash /root/installa.sh "$V" > /var/log/mark-installa.log 2>&1; then
  echo "Mark aggiornato a $V"
else
  echo "Errore: vedi /var/log/mark-installa.log"
  exit 1
fi
FINE
chmod 0755 /usr/local/bin/aggiorna-mark
echo "Mark su Telegram installato."
