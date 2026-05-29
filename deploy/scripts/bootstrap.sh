#!/usr/bin/env bash
# bootstrap.sh — Restauracion completa servidor consolidado Cetrix
# Uso: bash deploy/scripts/bootstrap.sh
# Requisitos: Ubuntu 22.04 LTS, sudo, SSH key para GitHub
set -euo pipefail

SERVER_USER="${SERVER_USER:-ubuntu}"
BASE_DIR="/opt/cetrix"
GITHUB_USER="jreyessalvador"
GREEN="\033[0;32m"; YELLOW="\033[1;33m"; RED="\033[0;31m"; NC="\033[0m"
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; exit 1; }
step() { echo -e "\n${YELLOW}==== $1 ====${NC}"; }

step "1/8 Sistema base"
sudo apt-get update -qq && sudo apt-get upgrade -y -qq
sudo apt-get install -y -qq curl wget git vim htop
sudo apt-get install -y -qq nginx certbot python3-certbot-nginx ufw
ok "Paquetes instalados"

step "2/8 Docker"
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sudo bash
    sudo usermod -aG docker "$SERVER_USER"
    ok "Docker instalado"
else
    ok "Docker: $(docker --version)"
fi
sudo systemctl enable docker && sudo systemctl start docker

step "3/8 Directorios"
sudo mkdir -p "$BASE_DIR" && sudo chown "$SERVER_USER:$SERVER_USER" "$BASE_DIR"
for d in flipbook-saas nexus-helpdesk nexus-cmms ecotienda odoo18; do
    mkdir -p "$BASE_DIR/$d"
done
mkdir -p /opt/backups/{flipbook,helpdesk,cmms,ecotienda,odoo18}
ok "Directorios creados en $BASE_DIR"

step "4/8 Clonar repositorios"
clone_or_pull() {
    local repo=$1 dir=$2 branch="${3:-main}"
    if [ -d "$dir/.git" ]; then
        git -C "$dir" pull origin "$branch" && ok "Actualizado: $repo"
    else
        git clone "git@github.com:${GITHUB_USER}/${repo}.git" "$dir" && ok "Clonado: $repo"
    fi
}

clone_or_pull "flipbook-saas"       "$BASE_DIR/flipbook-saas"
clone_or_pull "nexus-helpdesk"      "$BASE_DIR/nexus-helpdesk"
clone_or_pull "nexus-cmms"          "$BASE_DIR/nexus-cmms"
clone_or_pull "ecotienda"           "$BASE_DIR/ecotienda"
clone_or_pull "odoo18-cetrix-spain" "$BASE_DIR/odoo18"

step "5/8 Variables de entorno"
setup_env() {
    local dir=$1
    [ -f "$dir/.env.prod" ] && ok ".env.prod OK: $dir" && return
    [ -f "$dir/.env.prod.example" ] && cp "$dir/.env.prod.example" "$dir/.env.prod"
    [ -f "$dir/.env.example" ] && cp "$dir/.env.example" "$dir/.env.prod"
    warn "PENDIENTE editar: $dir/.env.prod"
}

for d in flipbook-saas nexus-helpdesk nexus-cmms ecotienda odoo18; do
    setup_env "$BASE_DIR/$d"
done

warn "Edita los .env.prod antes de continuar"
read -rp "Listo? (s/N): " c && [[ "$c" =~ ^[sS]$ ]] || err "Edita primero"

step "6/8 Levantando stacks Docker Compose"
start_stack() {
    local dir=$1 name=$2
    cd "$dir"
    local cf="docker-compose.prod.yml"
    [ ! -f "$cf" ] && cf="docker-compose.yml"
    docker compose -f "$cf" up -d && ok "$name levantado"
}

start_stack "$BASE_DIR/flipbook-saas"  "Flipbook SaaS"
start_stack "$BASE_DIR/nexus-helpdesk" "Nexus Helpdesk"
start_stack "$BASE_DIR/nexus-cmms"     "Nexus CMMS"
start_stack "$BASE_DIR/ecotienda"      "EcoTienda"
start_stack "$BASE_DIR/odoo18"         "Odoo 18"

echo "Esperando healthchecks (20s)..."
sleep 20

step "7/8 Restaurando bases de datos"
restore_db() {
    local cf=$1 svc=$2 user=$3 db=$4 seed=$5
    [ ! -f "$seed" ] && warn "Sin seed: $seed" && return
    docker compose -f "$cf" exec -T "$svc" psql -U "$user" -d "$db" < "$seed"
    ok "BD restaurada: $db"
}

restore_db "$BASE_DIR/flipbook-saas/docker-compose.prod.yml"\
    postgres flipbook flipbook\
    "$BASE_DIR/flipbook-saas/deploy/scripts/seed.sql"

restore_db "$BASE_DIR/nexus-helpdesk/docker-compose.prod.yml"\
    postgres nexus nexus_helpdesk\
    "$BASE_DIR/nexus-helpdesk/scripts/seed_production.sql"

step "8/8 Nginx + SSL"
[ -f "$BASE_DIR/flipbook-saas/deploy/nginx/conf.d/flipbook.conf" ] && \
    sudo cp "$BASE_DIR/flipbook-saas/deploy/nginx/conf.d/flipbook.conf" /etc/nginx/conf.d/
[ -f "$BASE_DIR/nexus-helpdesk/nginx.conf" ] && \
    sudo cp "$BASE_DIR/nexus-helpdesk/nginx.conf" /etc/nginx/conf.d/nexus-helpdesk.conf
sudo nginx -t && sudo systemctl reload nginx && ok "Nginx OK"

sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable && ok "Firewall OK"

(crontab -l 2>/dev/null; echo "0 2 * * * bash /opt/cetrix/flipbook-saas/deploy/scripts/backup.sh >> /var/log/backup-flipbook.log 2>&1") | crontab -
ok "Cron backups configurado"

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Bootstrap completado${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "Contenedores activos:"
docker ps --format "  {{.Names}}\t{{.Status}}"
echo ""
warn "Pendiente SSL — ejecutar certbot para cada dominio"
warn "Pendiente DNS — apuntar dominios a este servidor"
warn "Pendiente Stripe/SMTP — verificar webhooks en produccion"
echo ""
ok "Servidor listo"
