# 링크 서비스 3종 — Cloudflare Workers 버전

서로 완전히 독립된 Cloudflare 프로젝트 3개입니다. 폴더 하나가 서비스 하나이고, 각자 따로 배포·운영합니다.

| 폴더 | 서비스(가칭) | 하는 일 | 구성 |
|---|---|---|---|
| `bangdojang/` | 방도장 | 입주·퇴실 집 상태 기록. 사진의 서버 수신 시각·원본 SHA-256 고정, 집주인 “확인했습니다” 기록, 방별 입주/퇴실 비교, 인쇄용 리포트 | Worker + D1 + R2 + Cron(매일) |
| `hanbeonbom/` | 한번봄 | 보고 나면 사라지는 사진. 열람 횟수·시간·비밀번호, 열람자 IP·시각 워터마크, 카톡 미리보기에 조회수가 소진되지 않음, 열람 기록·회수 | Worker + D1 + R2 + Cron(10분) |
| `geuttae/` | 그때열기 | 정한 시각에 열리는 링크. 공개 전 카운트다운(본문·사진은 서버가 내보내지 않음), 종료 시각에 삭제 | Worker + D1 + R2 + Cron(15분) |

공통: 가입 없음 · 관리 링크(비밀 키) 방식 · 신고하기/관리자 삭제 조치 · 이용약관 초안 · 보안 헤더(CSP 등) · 모바일 우선 화면.

---

## 배포하기 (서비스마다 한 번씩)

아래는 `bangdojang` 기준입니다. 다른 서비스는 폴더 이름과 DB·버킷 이름만 바꿔서 똑같이 하면 됩니다.

| 서비스 | D1 이름 | R2 버킷 이름 |
|---|---|---|
| bangdojang | `bangdojang-db` | `bangdojang-files` |
| hanbeonbom | `hanbeonbom-db` | `hanbeonbom-files` |
| geuttae | `geuttae-db` | `geuttae-files` |

```bash
# 0) 준비: Node.js 18 이상, Cloudflare 계정.
#    R2는 대시보드에서 한 번 활성화해야 합니다(무료 사용량이 있지만 결제수단 등록이 필요).
cd bangdojang
npm install
npx wrangler login

# 1) DB 만들기 → 출력된 database_id를 wrangler.toml의 database_id에 붙여 넣기
npx wrangler d1 create bangdojang-db

# 2) 사진 저장소 만들기
npx wrangler r2 bucket create bangdojang-files

# 3) 테이블 만들기(원격 DB) — migrations/ 폴더의 SQL을 순서대로 적용
npm run db:remote

# 4) 비밀값 등록 (각각 입력 프롬프트가 뜸)
npx wrangler secret put IP_SALT       # 아무 긴 무작위 문자열
npx wrangler secret put ADMIN_TOKEN   # 신고 관리 페이지(/admin?token=…)용 비밀번호

# 5) 배포 → https://bangdojang.<내-서브도메인>.workers.dev 로 열림
npm run deploy
```

커스텀 도메인은 대시보드 → Workers & Pages → 해당 Worker → Settings → Domains & Routes에서 연결합니다.

### 로컬에서 실행해 보기

```bash
cd bangdojang
npm install
cp .dev.vars.example .dev.vars   # 로컬용 비밀값
npm run db:local                 # 로컬 DB에 테이블 생성
npm run dev                      # http://localhost:8787
```

정리 작업(Cron)은 `npx wrangler dev --test-scheduled`로 띄운 뒤 `http://localhost:8787/__scheduled`를 열면 바로 실행해 볼 수 있습니다.

### 테스트

```bash
pip install -r tests/requirements.txt
scripts/test.sh geuttae          # 타입 검사 + 로컬 DB 초기화 + API 테스트
scripts/test.sh geuttae --ui     # + 브라우저 UI 테스트(Playwright 필요)
```

### GitHub에 올린 뒤 자동 배포 (Workers Builds)

한 저장소에 세 폴더를 두고, Worker 3개에 같은 저장소를 각각 연결합니다.

| 설정 (Worker → Settings → Builds) | 값 |
|---|---|
| Root directory | `geuttae` / `hanbeonbom` / `bangdojang` |
| Build watch paths (include) | `geuttae/*` 처럼 자기 폴더만 |
| Deploy command | `npm run release` (원격 DB 마이그레이션 → 배포) |
| Production branch | `main` (다른 브랜치 빌드는 끔 — 미리보기 빌드도 운영 DB를 같이 씀) |
| API token | **D1 Edit 권한을 넣은 사용자 지정 토큰** (기본 자동 생성 토큰에는 D1 권한이 없어 마이그레이션이 실패함) |

비밀값(`IP_SALT`, `ADMIN_TOKEN`)은 처음 한 번 `wrangler secret put`으로 넣으면 이후 배포에도 유지됩니다.

### 자동 개발

`AGENTS.md`(에이전트 규칙)와 `BACKLOG.md`(우선순위 작업 목록)를 에이전트가 읽고, 위에서부터 한 항목씩 PR을 만듭니다. PR마다 `.github/workflows/ci.yml`이 세 서비스 테스트를 돌리고, 통과한 PR만 머지되게 GitHub 브랜치 보호 규칙을 겁니다.

### 신고 관리

각 서비스의 `/admin?token=<ADMIN_TOKEN>`에서 신고 목록을 보고 **삭제 조치**(해당 링크와 파일 즉시 삭제) 또는 **기각**을 할 수 있습니다.

---

## 설계 메모

**무료 플랜 기준으로 설계했습니다.** Workers 무료 플랜은 요청당 CPU 시간이 매우 짧아서, 무거운 일은 브라우저와 R2에 맡겼습니다.

- **이미지 정리(EXIF·GPS 제거, 회전 보정, 리사이즈)**: 업로드 전에 브라우저 캔버스에서 다시 인코딩합니다.
- **방도장 원본 지문**: 브라우저가 SHA-256을 계산해 보내면, R2가 저장 순간 실제 바이트와 대조해 다르면 저장을 거부합니다(`put(…, { sha256 })`). 서버 CPU를 쓰지 않으면서 위변조를 막습니다.
- **방도장 확인 기록**: 확인 당시의 사진 ID 목록과 묶음 지문을 함께 저장합니다. 이미 확인받은 사진은 삭제할 수 없고, 확인 뒤에 추가한 사진에는 “마지막 확인 이후 추가” 표시가 붙습니다.
- **한번봄 미리보기 대응**: 링크를 여는 것(GET)으로는 조회수가 줄지 않습니다. ‘사진 보기’ 버튼(POST)을 눌러야 차감되고, 미리보기 봇의 POST는 차단합니다. 차감은 조건부 UPDATE 한 번으로 처리해서, 1회짜리를 여러 명이 동시에 눌러도 한 명만 성공합니다.
- **비밀번호**: PBKDF2(1만 회). 무료 CPU 한도 때문에 반복 횟수를 낮게 잡았습니다. 유료 플랜이라면 올리세요.

## 알려진 한계 (공개 전 확인 필요)

1. **한번봄 워터마크는 브라우저에서 그립니다.** 원본 이미지가 기기로 전송된 뒤 캔버스에 워터마크와 함께 그려지는 구조라, 개발자 도구를 쓸 줄 아는 사람은 워터마크 없는 원본을 꺼낼 수 있습니다. 서버에서 워터마크를 박으려면 유료 Workers와 WASM 이미지 라이브러리가 필요합니다. 화면 캡처는 어떤 방식으로도 완전히 막을 수 없습니다.
2. **방도장은 공증이 아닙니다.** 시각·지문 기록은 참고 자료일 뿐, 법적 효력을 보장한다고 홍보하면 안 됩니다.
3. **속도 제한**: 코드 안에는 별도 속도 제한이 없습니다(단, 한번봄 비밀번호는 10회 틀리면 잠김). 대시보드 → Security → WAF → Rate limiting rules에서 업로드 경로(`/api/upload`, `/api/create`, `/r/*/orig`)에 IP당 제한 규칙을 걸어 두세요. 무료 플랜에서도 1개 규칙을 만들 수 있습니다.
4. **이용약관은 초안**입니다. 공개 전에 법률 검토를 받고, 익명 업로드 서비스의 신고 대응 체계(불법촬영물 즉시 삭제 등)를 운영 절차로 확정하세요.
5. **서비스 이름은 가칭**입니다. 상표를 확인한 뒤 확정하세요.

## 테스트

`tests/` 폴더의 스크립트로 로컬 `wrangler dev` 서버를 대상으로 전체 흐름을 검증했습니다(Python + httpx, 브라우저 테스트는 Playwright).

- `test_bang.py`: 방도장 24개 항목 — 지문 불일치 거부, 원본 바이트 보존, 확인된 사진 삭제 차단, 퇴실 비교, 신고 삭제
- `test_hbb.py`: 한번봄 24개 항목 — 카톡 봇 접근 후에도 0회 유지, 동시 10명 중 1명만 열람, 비밀번호, 회수
- `test_gt.py`: 그때열기 17개 항목 — 공개 전 본문 비노출, 공개 후 표시, 종료 즉시 삭제, Cron 정리
- `ui_*.py`: 실제 크롬에서 업로드·확인·열람·카운트다운 자동 열림 확인
