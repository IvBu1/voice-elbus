#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Ivan Buntic
# SPDX-License-Identifier: MIT

set -euo pipefail

# run this script with the directory containing compose.yaml and .env as its argument
# with no argument, use the current working directory
cd -- "${1:-.}"
sudo -v

# resolve .env through Compose, rather than executing its contents as shell code
# print only the validated limit, not the rest of the deployment configuration
limits=$(
    sudo docker compose config --format json |
        python3 -c '
import json
import sys

config = json.load(sys.stdin)
try:
    limit = int(config["services"]["voice-elbus"]["environment"]["MAX_ATTACHMENT_MB"])
except (KeyError, ValueError, TypeError):
    sys.exit("Set MAX_ATTACHMENT_MB to a positive integer in the service environment.")
if limit <= 0:
    sys.exit("MAX_ATTACHMENT_MB must be a positive integer.")

# Nginx limits the entire request, so allow 1 decimal MB for multipart overhead.
print(limit, (limit + 1) * 1_000_000)
'
)
read -r limit_mb request_limit_bytes <<< "$limits"

snippet=/etc/nginx/snippets/voice-elab-upload-limit.conf
backup_dir=$(mktemp -d)
trap 'rm -rf -- "$backup_dir"' EXIT

had_previous=false
if sudo test -f "$snippet"; then
    sudo cat "$snippet" > "$backup_dir/previous"
    had_previous=true
fi

restore_snippet() {
    if "$had_previous"; then
        sudo install -m 644 "$backup_dir/previous" "$snippet"
    else
        sudo rm -f -- "$snippet"
    fi
}

sudo install -d -m 755 /etc/nginx/snippets
printf 'client_max_body_size %s;\n' "$request_limit_bytes" > "$backup_dir/new"
sudo install -m 644 "$backup_dir/new" "$snippet"

if ! sudo nginx -t; then
    restore_snippet
    echo "Nginx validation failed; previous snippet restored." >&2
    exit 1
fi

# an existing snippet has no effect unless the active configuration includes it
if ! sudo nginx -T > "$backup_dir/nginx-config" 2> "$backup_dir/nginx-check"; then
    restore_snippet
    cat "$backup_dir/nginx-check" >&2
    exit 1
fi
if ! grep -Fq "# configuration file $snippet:" "$backup_dir/nginx-config"; then
    restore_snippet
    echo "Add include $snippet; to the HTTPS server block before running this script." >&2
    exit 1
fi

if ! sudo systemctl reload nginx; then
    restore_snippet
    echo "Nginx reload failed; previous snippet restored. Inspect Nginx before retrying." >&2
    exit 1
fi

printf 'Applied %s MB attachment limit; Nginx permits %s bytes per request.\n' \
    "$limit_mb" "$request_limit_bytes"

