#!/usr/bin/env bash
#
# Pull the current ai.bordercore.com Let's Encrypt cert from the ec2 host
# (where certbot renews it) and install it into this checkout's webapp/ssl/,
# restarting the backend only when the cert has actually changed.
#
# certbot renews the cert on ec2 but cannot reach the home host that serves
# the dashboard on :5010, so the renewed cert has to be pulled in. Run this on
# the host that serves the dashboard (wumpus2018); on any other checkout it
# just stages the cert files (no service to restart). Safe to re-run: it
# no-ops when the local cert already matches ec2.
#
#   scripts/renew-ai-cert.sh          # install if changed, else do nothing
#   scripts/renew-ai-cert.sh --force  # reinstall + restart even if unchanged

set -euo pipefail

REMOTE=${CERT_REMOTE:-ec2}                             # ssh alias for the cert host
LIVE=/etc/letsencrypt/live/ai.bordercore.com           # certbot lineage on the remote
# Both the Flask backend (:5010) and the Vite frontend (:5180) read this cert
# and load it at startup, so both must be restarted for a renewal to take hold.
SERVICES=${CERT_SERVICES:-"bordercoreai-backend.service bordercoreai-frontend.service"}
VERIFY_PORTS=${CERT_VERIFY_PORTS:-"5010 5180"}

# Cert dir is resolved relative to this script so the same file works on every
# checkout regardless of username or clone path.
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEST=$(cd "$SCRIPT_DIR/.." && pwd)/webapp/ssl

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Fetching cert from ${REMOTE}:${LIVE} ..."
ssh -o BatchMode=yes "$REMOTE" "sudo cat $LIVE/fullchain.pem" > "$TMP/crt"
ssh -o BatchMode=yes "$REMOTE" "sudo cat $LIVE/privkey.pem"  > "$TMP/key"

# Sanity: the fetched cert must parse.
if ! openssl x509 -in "$TMP/crt" -noout >/dev/null 2>&1; then
    echo "ERROR: fetched cert did not parse — aborting (local cert untouched)." >&2
    exit 1
fi

new=$(openssl x509 -in "$TMP/crt" -noout -fingerprint -sha256)
cur=$(openssl x509 -in "$DEST/server.crt" -noout -fingerprint -sha256 2>/dev/null || true)

if [ "$new" = "$cur" ] && [ "$FORCE" -eq 0 ]; then
    exp=$(openssl x509 -in "$DEST/server.crt" -noout -enddate | cut -d= -f2)
    echo "Cert unchanged (expires ${exp}). Nothing to do."
    exit 0
fi

# Safety: never install a cert whose private key doesn't match it.
cph=$(openssl x509 -in "$TMP/crt" -noout -pubkey | openssl pkey -pubin -outform der 2>/dev/null | openssl dgst -sha256)
kph=$(openssl pkey -in "$TMP/key" -pubout -outform der 2>/dev/null | openssl dgst -sha256)
if [ -z "$cph" ] || [ "$cph" != "$kph" ]; then
    echo "ERROR: private key does not match cert — aborting (local cert untouched)." >&2
    exit 1
fi

ts=$(date +%F-%H%M%S)
mkdir -p "$DEST/old"
cp -a "$DEST/server.crt" "$DEST/old/server.crt.$ts" 2>/dev/null || true
cp -a "$DEST/server.key" "$DEST/old/server.key.$ts" 2>/dev/null || true

install -m 644 "$TMP/crt" "$DEST/server.crt"
install -m 600 "$TMP/key" "$DEST/server.key"
echo "Installed new cert (backup of previous in $DEST/old/, suffix $ts)."

# Restart every dashboard service that exists on this host. On the authoritative
# checkout none exist, so the cert is simply staged for the next sync.
restarted=0
for svc in $SERVICES; do
    if systemctl --user cat "$svc" >/dev/null 2>&1; then
        echo "Restarting $svc ..."
        systemctl --user restart "$svc"
        restarted=1
    fi
done

if [ "$restarted" -eq 0 ]; then
    echo "No dashboard services on this host — cert staged only (no restart)."
    exit 0
fi

# Confirm each port now serves the new cert on the wire.
rc=0
for port in $VERIFY_PORTS; do
    for _ in $(seq 1 20); do
        ss -tln 2>/dev/null | grep -q ":$port" && break
        sleep 1
    done
    served=$(echo | openssl s_client -connect 127.0.0.1:"$port" -servername ai.bordercore.com 2>/dev/null \
             | openssl x509 -noout -fingerprint -sha256 2>/dev/null || true)
    if [ "$served" = "$new" ]; then
        echo "OK: :$port now serving the new cert."
    else
        echo "WARNING: :$port is not serving the new cert. Check: systemctl --user status $SERVICES" >&2
        rc=1
    fi
done

exp=$(openssl x509 -in "$DEST/server.crt" -noout -enddate | cut -d= -f2)
[ "$rc" -eq 0 ] && echo "All dashboard ports serving cert valid until ${exp}."
exit "$rc"
