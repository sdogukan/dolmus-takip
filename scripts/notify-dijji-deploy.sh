#!/usr/bin/env bash
# Dijji'ye "deploy oldu" haberi — `.github/workflows/deploy.yml` çağırır.
#
# Kullanım: notify-dijji-deploy.sh <önceki-yayın-commit'i|boş> <yeni-yayın-commit'i> <success|failure>
# Ortam: DIJJI_DEPLOY_KEY (gizli, "<projectId>.<secret>"), DIJJI_DEPLOY_URL.
#
# Dijji stage'i merge commit'ini BİREBİR eşleştirir (ata kontrolü yok). Bir yayın birden
# çok merge içerebilir (CI eş zamanlı push'larda eskisini iptal eder), bu yüzden önceki
# yayından yenisine kadar main'in birinci-ebeveyn zincirindeki HER commit ayrı bildirilir.
# Dijji'nin tanımadığı commit'ler için yanıt yine 200'dür (etkisiz).
set -euo pipefail

PREV="${1:-}"
TO="${2:?yeni yayın commit gerekli}"
STATE="${3:?success ya da failure}"
[[ "$STATE" == "success" || "$STATE" == "failure" ]] || { echo "durum success|failure olmalı" >&2; exit 2; }
: "${DIJJI_DEPLOY_KEY:?DIJJI_DEPLOY_KEY yok}"
: "${DIJJI_DEPLOY_URL:?DIJJI_DEPLOY_URL yok}"

if [[ -n "$PREV" ]] && git merge-base --is-ancestor "$PREV" "$TO" 2>/dev/null; then
  SHAS="$(git rev-list --first-parent --reverse "$PREV..$TO")"
else
  SHAS="$TO"
fi
[[ -n "$SHAS" ]] || SHAS="$TO"

fail=0
while read -r sha; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -X POST "$DIJJI_DEPLOY_URL" \
    -H "X-Api-Key: $DIJJI_DEPLOY_KEY" -H "Content-Type: application/json" \
    -d "{\"sha\":\"$sha\",\"state\":\"$STATE\"}")" || code="curl-hata"
  echo "dijji ${sha:0:7} state=$STATE -> $code"
  [[ "$code" == "200" ]] || fail=1
done <<<"$SHAS"
exit "$fail"
