#!/bin/sh
# Lote F1 (2026-10-04): cortafuegos del contenedor worker de flipbook-saas.
# El contenedor (bridge br-flipbook, 172.31.250.0/24) SOLO puede hablar con el
# gateway de Contabo 1 por el tunel wg-flipbook (10.253.43.1:8461/8462).
# Nada de internet, nada del propio Contabo 2 (SSH, nginx, AS Video, agentes).
set -e
iptables -N FLIPBOOK-WORKER 2>/dev/null || iptables -F FLIPBOOK-WORKER
iptables -A FLIPBOOK-WORKER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
iptables -A FLIPBOOK-WORKER -d 10.253.43.1/32 -p tcp -m multiport --dports 8461,8462 -j RETURN
iptables -A FLIPBOOK-WORKER -j DROP
iptables -C DOCKER-USER -i br-flipbook -j FLIPBOOK-WORKER 2>/dev/null || iptables -I DOCKER-USER 1 -i br-flipbook -j FLIPBOOK-WORKER
# Trafico del contenedor hacia el propio host (cualquier IP del host, incl. DNS)
iptables -C INPUT -i br-flipbook -j DROP 2>/dev/null || iptables -I INPUT 1 -i br-flipbook -j DROP
