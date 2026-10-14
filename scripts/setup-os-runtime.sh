#!/usr/bin/env bash
set -euo pipefail

# OS-level setup helper: no npm packages are installed. Node.js itself is required.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "$(uname -s)" != Linux* ]] || ! command -v systemctl >/dev/null 2>&1; then
  echo "This installer currently supports Linux with systemd only. No changes made." >&2
  exit 2
fi
if [[ $EUID -ne 0 ]]; then echo "Run with sudo to install a system service. No changes made." >&2; exit 2; fi
if [[ ! -f "$ROOT/src/server.js" || ! -f "$ROOT/package.json" ]]; then echo "Runtime source not found at $ROOT" >&2; exit 2; fi
node_version=""
if command -v node >/dev/null 2>&1; then node_version="$(node -p 'process.versions.node')"; fi
node_supported() {
  [[ -n "$node_version" ]] || return 1
  local major="${node_version%%.*}" minor
  minor="$(printf '%s' "$node_version" | cut -d. -f2)"
  (( major > 22 || (major == 22 && minor >= 5) ))
}
if ! node_supported; then
  echo "Node.js ${node_version:-not installed} is missing/too old; ZombieCoder requires >=22.5.0 (node:sqlite)."
  if command -v apt-get >/dev/null 2>&1; then
    read -r -p 'Try installing/upgrading Node.js from this system’s configured apt repository? [y/N]: ' install_node
    if [[ "$install_node" =~ ^[Yy]$ ]]; then apt-get update && apt-get install -y nodejs; fi
  else
    echo "Automatic package installation is unavailable on this OS. Install Node.js 22.5+ using the official distribution, then rerun." >&2
    exit 2
  fi
  node_version=""
  if command -v node >/dev/null 2>&1; then node_version="$(node -p 'process.versions.node')"; fi
  if ! node_supported; then echo "Node.js still reports ${node_version:-missing}; install Node.js >=22.5.0 from an appropriate trusted source. No service changes made." >&2; exit 2; fi
fi
read_dotenv_value() {
  local key="$1" line value
  [[ -f "$ROOT/.env" ]] || return 0
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$ROOT/.env" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 0
  value="${line#*=}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if { [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; } || { [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; }; then value="${value:1:${#value}-2}"; fi
  printf '%s' "$value"
}
resolve_config_path() {
  local value="$1" fallback="$2"
  value="${value:-$fallback}"
  if [[ "$value" = /* ]]; then realpath -m -- "$value"; else realpath -m -- "$ROOT/$value"; fi
}
systemd_escape_path() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/ /\\x20/g'; }
port_default="${PORT:-$(read_dotenv_value PORT)}"
port_default="${port_default:-3000}"
read -r -p "Runtime HTTP port [$port_default]: " runtime_port
runtime_port="${runtime_port:-$port_default}"
[[ "$runtime_port" =~ ^[0-9]+$ ]] && (( runtime_port >= 1 && runtime_port <= 65535 )) || { echo "Invalid port; no changes made." >&2; exit 2; }
echo "Node.js $node_version validated; runtime HTTP port is $runtime_port."

runtime_data_dir="$(resolve_config_path "$(read_dotenv_value DATA_DIR)" './data')"
runtime_log_dir="$(resolve_config_path "$(read_dotenv_value LOG_DIR)" './logs')"
runtime_sqlite_path="$(resolve_config_path "$(read_dotenv_value SQLITE_PATH)" './data/runtime.sqlite')"
runtime_sqlite_dir="$(dirname "$runtime_sqlite_path")"
for writable_path in "$runtime_data_dir" "$runtime_log_dir" "$runtime_sqlite_dir"; do
  case "$writable_path" in "$ROOT"/*) ;; *) echo "Configured runtime write path is outside the project root: $writable_path" >&2; echo "For systemd confinement, keep DATA_DIR, LOG_DIR and SQLITE_PATH under $ROOT, or edit the service unit manually." >&2; exit 2 ;; esac
done

cat <<'MENU'
ZombieCoder OS Runtime Setup
1) Chat-only: bind runtime to loopback; no reverse proxy setup
2) Prepare HTTPS reverse proxy with Nginx (tool execution remains disabled)
0) Cancel
MENU
read -r -p 'Choose [0/1/2]: ' choice
case "$choice" in
  0) echo "Cancelled; no changes made."; exit 0 ;;
  1) mode=chat-only; proxy_configured=false ;;
  2) mode=chat-only
     if [[ "$(read_dotenv_value LOCAL_AUTH_BYPASS)" == 'true' ]]; then echo 'LOCAL_AUTH_BYPASS=true is not allowed with the Nginx/public-proxy option. Disable it and configure ADMIN_TOKEN.' >&2; exit 2; fi
     proxy_configured=true
     if ! command -v nginx >/dev/null 2>&1; then
       if command -v apt-get >/dev/null 2>&1; then
         read -r -p 'Nginx is missing. Install OS package nginx now? [y/N]: ' install_nginx
         if [[ "$install_nginx" =~ ^[Yy]$ ]]; then apt-get update && apt-get install -y nginx; else echo "Nginx not installed; no proxy config written."; exit 2; fi
       else echo "Install Nginx using your OS package manager, then rerun. No changes made." >&2; exit 2; fi
     fi
     read -r -p 'Public DNS hostname already pointing here: ' domain
     [[ "$domain" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "Invalid hostname; no changes made." >&2; exit 2; }
     read -r -p 'Existing trusted TLS certificate full path: ' cert
     read -r -p 'Existing TLS private key full path: ' key
     [[ -r "$cert" && -r "$key" && "$cert" != *$'\n'* && "$key" != *$'\n'* && "$cert" != *\;* && "$key" != *\;* ]] || { echo "Readable certificate and key are required; no changes made." >&2; exit 2; }
     openssl x509 -in "$cert" -noout -checkhost "$domain" >/dev/null || { echo "Certificate hostname verification failed; no changes made." >&2; exit 2; }
     mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
     cat > "/etc/nginx/sites-available/zombiecoder.conf" <<NGINX
server {
  listen 443 ssl;
  server_name $domain;
  ssl_certificate $cert;
  ssl_certificate_key $key;
  ssl_protocols TLSv1.2 TLSv1.3;
  client_max_body_size 4m;
  location / {
    proxy_pass http://127.0.0.1:${runtime_port};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_buffering off;
    proxy_read_timeout 3600s;
  }
}
NGINX
     ln -sfn /etc/nginx/sites-available/zombiecoder.conf /etc/nginx/sites-enabled/zombiecoder.conf
     nginx -t
     systemctl reload nginx || systemctl restart nginx
     ;;
  *) echo "Invalid choice; no changes made." >&2; exit 2 ;;
esac

user_name="${SUDO_USER:-root}"
user_home="$(getent passwd "$user_name" | cut -d: -f6)"
[[ -n "$user_home" ]] || user_home=/root
service_file=/etc/systemd/system/zombiecoder-runtime.service
mkdir -p "$runtime_data_dir" "$runtime_log_dir" "$runtime_sqlite_dir"
chown -R "$user_name" "$runtime_data_dir" "$runtime_log_dir" "$runtime_sqlite_dir"
cat > "$service_file" <<UNIT
[Unit]
Description=ZombieCoder Runtime
After=network.target

[Service]
Type=simple
User=$user_name
WorkingDirectory=$(systemd_escape_path "$ROOT")
Environment=HOST=127.0.0.1
Environment=PORT=$runtime_port
Environment=ZOMBIECODER_EXECUTION_MODE=$mode
ExecStart=$(systemd_escape_path "$(command -v node)") $(systemd_escape_path "$ROOT/start.js")
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$(systemd_escape_path "$runtime_data_dir") $(systemd_escape_path "$runtime_log_dir") $(systemd_escape_path "$runtime_sqlite_dir")

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now zombiecoder-runtime.service
systemctl --no-pager --full status zombiecoder-runtime.service || true
cat <<EOF2

Installed service: zombiecoder-runtime.service
Configured mode: $mode (safe default; tool execution stays disabled)
Proxy configured: ${proxy_configured:-false}
Verification report command:
  cd "$ROOT" && ZC_VERIFY_URL=http://127.0.0.1:$runtime_port node scripts/verify-deployment.mjs
EOF2
echo "Tool execution remains disabled. After TLS, authentication, chat, streaming, and a dedicated harmless tool-call test pass, edit $service_file: change ZOMBIECODER_EXECUTION_MODE=chat-only to tools-enabled; then run systemctl daemon-reload && systemctl restart zombiecoder-runtime."
