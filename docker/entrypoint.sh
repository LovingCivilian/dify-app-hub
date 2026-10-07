#!/bin/sh
set -e

echo "Running database migrations..."
if [ -f /app/.env ]; then
  node --experimental-strip-types --env-file /app/.env db/migrate.ts
else
  node --experimental-strip-types db/migrate.ts
fi

exec "$@"
