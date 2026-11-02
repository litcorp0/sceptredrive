#!/usr/bin/env bash
#
# Flatten a downloaded release artifact, checksum it, and give every asset a name GitHub
# will not rewrite, so it is ready to publish.
#
#   scripts/release-assets.sh [downloaded-dir] [asset-dir]
#
# `actions/upload-artifact` keeps the Squirrel layout (`squirrel.windows/x64/...`), so the
# downloaded tree is nested. A GitHub release asset list must be flat files: both
# `sha256sum` and `gh release upload` fail when handed a directory, which is how the
# publish job used to break at release time.
#
# Names matter as much as bytes. GitHub rewrites asset filenames containing spaces or other
# non-alphanumeric characters: `Sceptre Drive POS-0.1.0 Setup.exe` is published as
# `Sceptre.Drive.POS-0.1.0.Setup.exe`. `SHA256SUMS.txt` and the install notes are written
# before the upload, so a rewritten name leaves both pointing at a file nobody can find.
# Normalising here keeps the published name identical to the name we wrote down.
#
# This lives in a script rather than inline YAML because the `Release` workflow only runs
# on a tag, where the workflow file is frozen at the tagged commit. The dev-push
# `Desktop (Windows build)` workflow runs this same script against its installer, so a
# broken publish path fails on a normal push instead of when a version number is on the line.
#
# Exit status:
#   0  every asset flattened, named and checksummed
#   1  the download was empty, or two assets would collide on one name

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

# Replace every run of characters GitHub would touch with a single hyphen. The result only
# contains characters GitHub keeps as-is.
normalize_name() {
  printf '%s' "$1" | sed -E 's/[^A-Za-z0-9._-]+/-/g; s/^[-.]+//; s/[-.]+$//'
}

# Plan the names first: two files can collide either because they already share a basename
# or because normalisation makes them equal. Writing either one would silently drop the
# other, so refuse the run instead of publishing a partial set.
declare -A planned=()
while IFS= read -r -d '' file; do
  base=$(basename "$file")
  name=$(normalize_name "$base")
  if [ -z "$name" ]; then
    echo "::error::No usable asset name can be derived from '$base'."
    exit 1
  fi
  if [ -n "${planned[$name]:-}" ]; then
    echo "::error::'$base' and '${planned[$name]}' would both publish as '$name'."
    exit 1
  fi
  planned[$name]=$base
done < <(find "$src" -type f -print0)

mkdir -p "$dest"
while IFS= read -r -d '' file; do
  base=$(basename "$file")
  name=$(normalize_name "$base")
  if [ "$name" != "$base" ]; then
    echo "Renamed for publishing: $base -> $name"
  fi
  cp -- "$file" "$dest/$name"
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
