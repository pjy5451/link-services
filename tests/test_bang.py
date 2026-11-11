import hashlib, io, re, sys, httpx
from PIL import Image
B = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8787"
c = httpx.Client(base_url=B, follow_redirects=False, timeout=30)

def jpeg(color, exif_date=None):
    im = Image.new("RGB", (1200, 900), color); bio = io.BytesIO()
    if exif_date:
        ex = Image.Exif(); ex[0x8769] = {0x9003: exif_date}
        im.save(bio, "JPEG", exif=ex.tobytes())
    else: im.save(bio, "JPEG")
    return bio.getvalue()

def ok(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: sys.exit(1)

r = c.post("/new", data={"title": "테스트빌라 301호 입주", "note": "2년 계약", "years": "2"})
ok(r.status_code == 303, "기록 생성 → 303")
loc = r.headers["location"]; rid = re.search(r"/r/([\w-]+)/manage", loc).group(1); key = re.search(r"key=([^&]+)", loc).group(1)
ok(c.get(loc).status_code == 200, "관리 페이지 200")
ok(c.get(f"/r/{rid}/manage?key=wrong").status_code == 403, "잘못된 키 → 403")

def up(stage, room, data, sha=None):
    sha = sha or hashlib.sha256(data).hexdigest()
    return c.put(f"/r/{rid}/orig?key={key}", content=data, headers={"X-Stage": stage, "X-Room": httpx.QueryParams({"a": room})["a"].encode("utf-8").decode("latin-1") if False else __import__("urllib.parse").parse.quote(room), "X-Sha256": sha, "X-Taken-At": "2026%3A11%3A11%2010%3A00%3A00", "X-Name": "a.jpg"})

img1 = jpeg((200, 50, 50), "2026:11:11 10:00:00")
r = up("in", "거실", img1); ok(r.status_code == 200 and "pid" in r.json(), "원본 업로드(정상 지문) → pid")
pid1 = r.json()["pid"]
r = up("in", "거실", img1, sha="0"*64); ok(r.status_code == 422, f"지문 불일치 → 422 (R2 검증) got {r.status_code}")
r = c.put(f"/r/{rid}/orig?key={key}", content=b"not an image at all", headers={"X-Stage": "in", "X-Sha256": hashlib.sha256(b'not an image at all').hexdigest()})
ok(r.status_code == 415, "이미지 아님 → 415")
r = c.put(f"/r/{rid}/disp/{pid1}?key={key}", content=jpeg((10, 10, 10)), headers={"Content-Type": "image/jpeg"})
ok(r.status_code == 200, "화면용 사본 업로드")
share = c.get(f"/r/{rid}"); ok(share.status_code == 200 and "거실" in share.text and "확인했습니다" in share.text, "공유 페이지에 사진·확인 버튼")
ok(c.get(f"/r/{rid}/img/{pid1}").headers.get("content-type") == "image/jpeg", "화면용 이미지 제공")
o = c.get(f"/r/{rid}/orig/{pid1}?key={key}"); ok(o.status_code == 200 and o.content == img1, "원본 다운로드 = 업로드 원본(바이트 동일)")
ok(c.get(f"/r/{rid}/orig/{pid1}").status_code == 403, "키 없이 원본 → 403")
r = c.post(f"/r/{rid}/ack", data={"stage": "in", "name": "김집주", "role": "임대인(집주인)", "agree": "1"})
ok(r.status_code == 303, "집주인 확인 → 303")
ok("김집주" in c.get(f"/r/{rid}").text, "확인 기록 표시")
r = c.post(f"/r/{rid}/del/{pid1}", data={"key": key}); ok(r.status_code == 409, "확인된 사진 삭제 차단 → 409")
r = up("in", "거실", jpeg((1, 2, 3))); pid_after = r.json()["pid"]
ok("마지막 확인 이후 추가" in c.get(f"/r/{rid}").text, "확인 이후 추가 사진 표시")
r = c.post(f"/r/{rid}/del/{pid_after}", data={"key": key}); ok(r.status_code == 303, "확인 이후 추가 사진은 삭제 가능")
r = up("out", "거실", jpeg((90, 90, 200))); ok(r.status_code == 200, "퇴실 사진 업로드")
ok("방별 비교" in c.get(f"/r/{rid}").text, "방별 비교 화면")
rep = c.get(f"/r/{rid}/report"); ok(rep.status_code == 200 and hashlib.sha256(img1).hexdigest() in rep.text, "리포트에 원본 SHA-256 전체 표시")
ok(rep.headers.get("content-security-policy", "").startswith("default-src"), "보안 헤더(CSP)")
# 신고 → 관리자 삭제 조치
c.post("/report", data={"target": f"{B}/r/{rid}", "reason": "기타", "detail": "test"})
ok(c.get("/admin?token=wrong").status_code == 403, "관리자 토큰 틀림 → 403")
adm = c.get("/admin?token=dev-admin"); ok(adm.status_code == 200 and rid in adm.text, "관리자 신고 목록")
rep_id = re.findall(r'name="id" value="(\d+)"', adm.text)[0]
r = c.post("/admin/takedown", data={"token": "dev-admin", "id": rep_id}); ok(r.status_code == 303, "삭제 조치")
ok(c.get(f"/r/{rid}").status_code == 404, "삭제 조치 후 기록 404")
# 만료 정리(cron)
r = c.post("/new", data={"title": "만료 테스트", "years": "1"}); rid2 = re.search(r"/r/([\w-]+)/manage", r.headers["location"]).group(1)
print("RID2", rid2)
