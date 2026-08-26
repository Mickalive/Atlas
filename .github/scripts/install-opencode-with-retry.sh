#!/usr/bin/env bash
set -euo pipefail

URL="${OPENCODE_INSTALL_URL:-https://opencode.ai/install}"
MAX_ATTEMPTS="${OPENCODE_INSTALL_MAX_ATTEMPTS:-4}"
RETRY_DELAY="${OPENCODE_INSTALL_RETRY_DELAY_SECONDS:-30}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

for ((attempt=1; attempt<=MAX_ATTEMPTS; attempt++)); do
  echo "ATLAS_OPENCODE_INSTALL_ATTEMPT=$attempt/$MAX_ATTEMPTS"
  rm -f "$TMP"

  set +e
  curl --connect-timeout 20 --max-time 120 --retry 2 --retry-all-errors --retry-delay 5 -fsSL "$URL" -o "$TMP"
  curl_rc=$?
  set -e

  if [[ "$curl_rc" -eq 0 && -s "$TMP" ]]; then
    set +e
    bash "$TMP"
    install_rc=$?
    set -e

    if [[ "$install_rc" -eq 0 ]]; then
      if [[ -x "$HOME/.opencode/bin/opencode" ]]; then
        echo "$HOME/.opencode/bin" >> "$GITHUB_PATH"
        echo 'ATLAS_OPENCODE_INSTALL_OK'
        exit 0
      fi
      if command -v opencode >/dev/null 2>&1; then
        echo 'ATLAS_OPENCODE_INSTALL_OK'
        exit 0
      fi
      echo '::warning::OpenCode installer exited zero but no executable was found.'
    else
      echo "::warning::OpenCode installer script failed rc=$install_rc."
    fi
  else
    echo "::warning::OpenCode installer download failed rc=$curl_rc."
  fi

  if (( attempt < MAX_ATTEMPTS )); then
    sleep "$RETRY_DELAY"
  fi
done

echo 'ATLAS_TRANSIENT_OX_INSTALL_EXHAUSTED' >&2
exit 75
