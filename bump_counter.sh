#!/bin/bash
# 「作って公開した数」カウンターを更新して本番反映する。
#
# 使い方:
#   ./bump_counter.sh          … 現在の数に +1 して push
#   ./bump_counter.sh 15       … 15件に設定して push
#   ./bump_counter.sh --check  … 変更せず、ローカルと本番の数字を表示するだけ
#
# 数え方: 特定のお店・人のために作って公開した1枚＝1件（お試し自動生成は数えない）。

set -euo pipefail

cd "$(dirname "$0")"
FILE="index.html"
PATTERN='これまでに作って公開した数：'

current() {
  grep -o "${PATTERN}[0-9]*件" "$FILE" | grep -o '[0-9]*'
}

live() {
  curl -s https://freehp.jp/ | grep -o "${PATTERN}[0-9]*件" | grep -o '[0-9]*' || echo "取得失敗"
}

if [ "${1:-}" = "--check" ]; then
  echo "ローカル: $(current)件"
  echo "本番    : $(live)件"
  exit 0
fi

# 最新のmainに追従（並行セッションの変更を潰さない）
git fetch origin --quiet
git checkout main --quiet 2>/dev/null || git checkout -B main origin/main --quiet
git pull --ff-only --quiet origin main

CUR=$(current)
if [ -n "${1:-}" ]; then
  NEW="$1"
else
  NEW=$((CUR + 1))
fi

if [ "$CUR" = "$NEW" ]; then
  echo "変更なし（すでに ${CUR}件）"
  exit 0
fi

sed -i '' "s/${PATTERN}${CUR}件/${PATTERN}${NEW}件/" "$FILE"

# 反映されたか確認してからコミット
if [ "$(current)" != "$NEW" ]; then
  echo "エラー: 置換に失敗しました" >&2
  git checkout -- "$FILE"
  exit 1
fi

git add "$FILE"
git commit -q -m "chore: 作って公開した数を${CUR}件→${NEW}件に更新"
git push -q origin main
echo "更新: ${CUR}件 → ${NEW}件（pushしました）"
echo "本番反映は1〜2分かかります。確認: ./bump_counter.sh --check"
