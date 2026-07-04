#!/usr/bin/env bash
# export_all_mirrors.sh — 원격 Supabase(Delphi, 정본)에서 모든 평면 미러(src/data/*.json, gitignore)를 재생성.
# 데모/배포 환경에서 이 스크립트 한 번이면 /api/* (orbat/blue/ontology/copilot/rag/doctrine/emitter) 가 데이터를 갖는다.
# 사전: cd web-ui && npx supabase link --project-ref jahosulejxmqjyjkvhno
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"   # web-ui/supabase/seed
cd "$SCRIPT_DIR/../.."                         # web-ui/

echo "=== launch-cases.json (RAG용) ==="
python3 supabase/seed/build_launch_seed.py --no-apply

for s in export_ontology_mirror export_orbat_mirror export_doctrine_mirror \
         export_friendly_mirror export_friendly_formations_mirror export_emitter_mirror; do
  echo "=== $s ==="
  python3 "supabase/seed/$s.py"
done

echo ""
echo "✅ 모든 미러 재생성 완료:"
ls -1 src/data/*.json 2>/dev/null | grep -E "ontology|orbat|doctrine|friendly|launch-cases|emitter" || true
