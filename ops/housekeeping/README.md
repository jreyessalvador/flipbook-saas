# Mantenimiento periódico (housekeeping) — aprobado por Carlos 04-oct-2026

Copia de referencia de lo instalado. Detalle: RECETA-DESARROLLO.md §26.

| Servidor | Script | Temporizador | Log |
|---|---|---|---|
| Contabo 1 | `/usr/local/sbin/flipbook-housekeeping.sh` | `flipbook-housekeeping.timer` (domingo 04:20) | `/var/log/flipbook-housekeeping.log` |
| Contabo 2 | `/usr/local/sbin/flipbook-worker-housekeeping.sh` | `flipbook-worker-housekeeping.timer` (domingo 04:40) | `/var/log/flipbook-worker-housekeeping.log` |

Ambos aceptan `--dry-run` (muestra qué borraría sin borrar). Logs rotados mensualmente (6 meses).
Ejecutar a mano: `sudo systemctl start flipbook-housekeeping.service` · ver próxima ejecución: `systemctl list-timers 'flipbook*'`.
