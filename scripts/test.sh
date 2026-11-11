#!/usr/bin/env bash
# 사용법: scripts/test.sh <geuttae|hanbeonbom|bangdojang> [--ui]
# 로컬 DB를 초기화하고 wrangler dev를 띄운 뒤 API 테스트(및 선택적으로 UI 테스트)를 돌립니다.
set -euo pipefail
SVC="${1:?서비스 이름을 넣어 주세요: geuttae | hanbeonbom | bangdojang}"
UI="${2:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
case "$SVC" in
  geuttae)    PORT=8789; DB=geuttae-db;    API=test_gt.py;   UIT=ui_gt.py ;;
  hanbeonbom) PORT=8788; DB=hanbeonbom-db; API=test_hbb.py;  UIT=ui_hbb.py ;;
  bangdojang) PORT=8787; DB=bangdojang-db; API=test_bang.py; UIT=ui_bang.py ;;
  *) echo "알 수 없는 서비스: $SVC"; exit 2 ;;
esac
cd "$ROOT/$SVC"
[ -d node_modules ] || npm install --no-audit --no-fund
[ -f .dev.vars ] || cp .dev.vars.example .dev.vars
echo "== typecheck"; npx tsc --noEmit
rm -rf .wrangler/state
echo "== D1 migrations (local)"; CI=1 npx wrangler d1 migrations apply "$DB" --local >/dev/null
if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then echo "포트 $PORT 가 이미 사용 중입니다. 이전 wrangler dev를 종료해 주세요."; exit 1; fi
LOG="$(mktemp)"
setsid npx wrangler dev --port "$PORT" --ip 127.0.0.1 --test-scheduled >"$LOG" 2>&1 &
PID=$!
# wrangler가 띄운 workerd까지 프로세스 그룹째 종료
trap 'kill -- -$PID 2>/dev/null || true; sleep 1; kill -9 -- -$PID 2>/dev/null || true' EXIT
for i in $(seq 1 60); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/" && break
  sleep 1
  if ! kill -0 $PID 2>/dev/null; then cat "$LOG"; echo "wrangler dev 실행 실패"; exit 1; fi
done
echo "== API tests ($API)"; python3 "$ROOT/tests/$API"
if [ "$UI" = "--ui" ]; then
  echo "== UI tests ($UIT)"
  python3 "$ROOT/tests/$UIT"
fi
echo "ALL PASS: $SVC"
