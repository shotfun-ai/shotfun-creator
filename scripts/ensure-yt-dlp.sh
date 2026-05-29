#!/usr/bin/env bash
set -euo pipefail

if command -v yt-dlp >/dev/null 2>&1; then
  yt-dlp --version
  exit 0
fi

if command -v python3 >/dev/null 2>&1; then
  python3 -m pip install --user --upgrade yt-dlp
else
  echo "python3 is required to install yt-dlp." >&2
  exit 1
fi

if ! command -v yt-dlp >/dev/null 2>&1; then
  USER_BASE="$(python3 -m site --user-base)"
  USER_BIN="${USER_BASE}/bin"
  if [ -x "${USER_BIN}/yt-dlp" ]; then
    "${USER_BIN}/yt-dlp" --version
    exit 0
  fi
  echo "yt-dlp was installed, but ${USER_BIN} is not on PATH." >&2
  echo "Add it to PATH, for example: export PATH=\"${USER_BIN}:$PATH\"" >&2
  exit 1
fi

yt-dlp --version
