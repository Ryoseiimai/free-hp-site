#!/usr/bin/env bash
# GA4測定IDが決まったら実行するプレースホルダ置換スクリプト。
# 使い方: ./tools/apply-ga4.sh G-XXXXXXXXXX
#
# 対象: __GA4_ID__ プレースホルダを含む全HTML/JSファイル
# macOSのBSD sed（sed -i ''）に対応。

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "使い方: $0 <GA4測定ID> (例: G-ABCD123456)" >&2
  exit 1
fi

GA4_ID="$1"

if [[ ! "$GA4_ID" =~ ^G-[A-Z0-9]+$ ]]; then
  echo "エラー: GA4測定IDの形式が不正です（G-で始まる英数字を指定してください）: $GA4_ID" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

TARGET_FILES=$(grep -rl "__GA4_ID__" --include="*.html" --include="*.js" . 2>/dev/null || true)

if [ -z "$TARGET_FILES" ]; then
  echo "対象ファイルが見つかりませんでした（__GA4_ID__ を含むファイルなし）"
  exit 0
fi

TOTAL_COUNT=0
echo "GA4測定ID: $GA4_ID を適用します"
echo "---"

while IFS= read -r file; do
  count=$(grep -o "__GA4_ID__" "$file" | wc -l | tr -d ' ')
  sed -i '' "s/__GA4_ID__/${GA4_ID}/g" "$file"
  echo "  $file : ${count}箇所を置換"
  TOTAL_COUNT=$((TOTAL_COUNT + count))
done <<< "$TARGET_FILES"

echo "---"
echo "合計置換件数: ${TOTAL_COUNT}"
