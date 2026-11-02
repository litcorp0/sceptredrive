#!/usr/bin/env bash
#
# Flatten a downloaded release artifact and checksum it, so it is ready to publish.
#
#   scripts/release-assets.sh [downloaded-dir] [asset-dir]
#
# `actions/upload-artifact` keeps the Squirrel layout (`squirrel.windows/x64/...`), so the
# downloaded tree is nested. A GitHub release asset list must be flat files: both
# `sha256sum` and `gh release upload` fail when handed a directory, which is how the
# publish job used to break at release time.
#
# This lives in a script rather than inline YAML because the `Release` workflow only runs
# on a tag, where the workflow file is frozen at the tagged commit. The dev-push
# `Desktop (Windows build)` workflow runs this same script against its installer, so a
# broken publish path fails on a normal push instead of when a version number is on the line.
#
# Exit status:
#   0  every asset flattened and checksummed
#   1  the download was empty, or two assets share a basename and would overwrite

set -euo pipefail

src=${1:-release-assets}
dest=${2:-dist}

if [ ! -d "$src" ]; then
  echo "::error::No downloaded artifacts at '$src'."
  exit 1
fi

files=$(find "$src" -type f)
if [ -z "$files" ]; then
  echo "::error::No artifacts were downloaded from '$src'."
  exit 1
fi

# A flat asset directory cannot hold two files with the same name. Refuse the run rather
# than publish whichever one the copy happened to land last.
duplicates=$(find "$src" -type f -printf '%f\n' | sort | uniq -d)
if [ -n "$duplicates" ]; then
  echo "::error::Duplicate asset names in the downloaded artifacts: $duplicates"
  exit 1
fi

mkdir -p "$dest"
while IFS= read -r -d '' file; do
  cp -- "$file" "$dest/$(basename "$file")"
done < <(find "$src" -type f -print0)

# Never hash the checksum file into itself: the redirect below creates it before the
# hashing starts.
(
  cd "$dest"
  find . -maxdepth 1 -type f ! -name SHA256SUMS.txt -printf '%f\0' \
    | sort -z \
    | xargs -0 sha256sum > SHA256SUMS.txt
)

count=$(find "$dest" -maxdepth 1 -type f ! -name SHA256SUMS.txt | wc -l)
echo "Flattened $count asset(s) into $dest:"
ls -la "$dest"
echo "SHA256SUMS.txt:"
cat "$dest/SHA256SUMS.txt"
