#!/bin/sh
set -eu

PUBLIC_PORT="${PORT:-8080}"
BACKEND_PORT="${BACKEND_PORT:-8081}"

case "$PUBLIC_PORT:$BACKEND_PORT" in
    *[!0-9:]*|:*|*:) echo "PORT and BACKEND_PORT must be numeric" >&2; exit 1 ;;
esac

export PUBLIC_PORT BACKEND_PORT
envsubst '${PUBLIC_PORT} ${BACKEND_PORT}' \
    < /etc/nginx/nginx.conf.template \
    > /tmp/nginx.conf

PORT="$BACKEND_PORT" java -jar /app/codereview-server.jar &
java_pid=$!
nginx -c /tmp/nginx.conf -g 'daemon off;' &
nginx_pid=$!

shutdown() {
    kill -TERM "$nginx_pid" "$java_pid" 2>/dev/null || true
    wait "$nginx_pid" "$java_pid" 2>/dev/null || true
}

trap 'shutdown; exit 0' INT TERM

while kill -0 "$java_pid" 2>/dev/null && kill -0 "$nginx_pid" 2>/dev/null; do
    sleep 1
done

echo "Backend or proxy exited unexpectedly; stopping the container" >&2
shutdown
exit 1
