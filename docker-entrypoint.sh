#!/bin/sh
set -e

DATA_DIR="${DATA_DIR:-/app/data}"
BACKUP_DIR="${BACKUP_DIR:-$DATA_DIR/backups}"

mkdir -p "$DATA_DIR" "$BACKUP_DIR"
chown -R node:node "$DATA_DIR"

exec gosu node "$@"
