#!/usr/bin/env bash
# Compatibility entry point. Releases now use an uploaded, immutable source
# archive. This script never changes a Git working tree.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  restart)
    docker restart "${MINIDRAMA_PROD_CONTAINER:-local-minidrama}"
    ;;
  rollback)
    exec bash "$SCRIPT_DIR/deploy/release-rollback"
    ;;
  '')
    echo 'Usage: deploy.sh <40-character-commit-sha> | restart | rollback' >&2
    exit 2
    ;;
  *)
    exec bash "$SCRIPT_DIR/deploy/release-deploy" "$1"
    ;;
esac
