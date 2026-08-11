#!/bin/bash
# 「作って公開した数」カウンターを更新して本番反映する。
#
# 使い方:
#   ./bump_counter.sh          … 現在の数に +1 して push
#   ./bump_counter.sh 15       … 15件に設定して push
#   ./bump_counter.sh --check  … 変更せず、ローカルと本番の数字を表示するだけ
#
# 数え方: 特定のお店・人のために作って公開した1枚＝1件（お試し自動生成は数えない）。
#
# 数字を盛らない運用ルール:
#   - 数字を更新するときは、必ず「時点」の日付も同時に書き換える（実行日を自動挿入）。
#   - 「実際に開いて確認できた数」だけを入れる（生成ジョブの件数を鵜呑みにしない）。
#
# ⚠️ 重要: このスクリプトが自動で書き換えるのは index.html だけです。
#   件数は以下のファイルにもベタ書きされているため、index.html 以外は
#   このスクリプトを実行した後、必ず手で直してください（自動更新の対象外）。
#     - works.html（count-sub / 時点表記 / 内訳テーブルの範囲行）
#     - ryoseiworks.html（count-num-sub / 時点表記）
#     - hikaku.html（「◯件（YYYY年M月D日時点）の記録」）
#     - guide-biyou.html / guide-inshoku.html / guide-kaigyou.html /
#       guide-kouri.html / guide-kyoshitsu.html / guide-seitai.html /
#       guide-shuuri.html（「これまでにX件のホームページを作って公開してきました（時点）。」）

set -euo pipefail

cd "$(dirname "$0")"
FILE="index.html"
PATTERN='作った数：'
TODAY="$(date +"%Y年%-m月%-d日")"

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

# 「作った数：NNN件・YYYY年M月D日時点」の形（件数と時点をまとめて置換）にも、
# まだ時点表記が付いていない旧「作った数：NNN件」の形にも両対応する。
if grep -q "${PATTERN}${CUR}件・[0-9]*年[0-9]*月[0-9]*日時点" "$FILE"; then
  sed -i '' "s/${PATTERN}${CUR}件・[0-9]*年[0-9]*月[0-9]*日時点/${PATTERN}${NEW}件・${TODAY}時点/" "$FILE"
else
  sed -i '' "s/${PATTERN}${CUR}件/${PATTERN}${NEW}件・${TODAY}時点/" "$FILE"
fi

# 反映されたか確認してからコミット
if [ "$(current)" != "$NEW" ]; then
  echo "エラー: 置換に失敗しました" >&2
  git checkout -- "$FILE"
  exit 1
fi

git add "$FILE"
git commit -q -m "chore: 作って公開した数を${CUR}件→${NEW}件に更新（${TODAY}時点）"
git push -q origin main
echo "更新: ${CUR}件 → ${NEW}件（${TODAY}時点・pushしました）"
echo "本番反映は1〜2分かかります。確認: ./bump_counter.sh --check"
echo ""
echo "⚠️ index.html 以外（works.html / ryoseiworks.html / hikaku.html / guide-*.html）は"
echo "   このスクリプトでは更新されません。手で直してください。"
