import io, re, sys, subprocess, json, httpx
from datetime import datetime, timedelta, timezone
from PIL import Image
B = "http://127.0.0.1:8789"; KST = timezone(timedelta(hours=9))
c = httpx.Client(base_url=B, follow_redirects=False, timeout=30, headers={"User-Agent": "Mozilla/5.0 Safari"})
def ok(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: sys.exit(1)
home = c.get("/")
ok(home.status_code == 200 and re.search(r'id="capresult"[\s\S]*id="share-send"[^>]*>카톡 등으로 보내기', home.text) is not None, "생성 결과 화면에 공유 버튼")
def d1(sql):
    subprocess.run(["npx", "wrangler", "d1", "execute", "geuttae-db", "--local", "--command", sql], cwd=__import__("os").path.join(__import__("os").path.dirname(__file__),"..","geuttae"), capture_output=True)
def local(dt): return dt.astimezone(KST).strftime("%Y-%m-%dT%H:%M")
def jpg():
    b = io.BytesIO(); Image.new("RGB", (600, 400), (240, 180, 190)).save(b, "JPEG"); return b.getvalue()
future = datetime.now(KST) + timedelta(days=1)
data = {"sender": "준영", "teaser": "생일 0시에 열어 봐 🎂", "message": "생일 축하해!\n비밀 메시지 본문", "open_at": local(future), "close_after": "86400"}
ok(c.post("/api/create", data={**data, "message": ""}).status_code == 400, "메시지 없음 → 400")
ok(c.post("/api/create", data={**data, "open_at": local(datetime.now(KST) + timedelta(days=400))}).status_code == 400, "1년 넘는 예약 → 400")
ok(c.post("/api/create", data={**data, "close_after": "999"}).status_code == 400, "허용 안 된 종료 옵션 → 400")
ok(c.post("/api/create", data=data, files={"photo": ("a.png", b"\x89PNG\r\n\x1a\nxxxx", "image/png")}).status_code == 415, "JPEG 아닌 첨부 → 415")
r = c.post("/api/create", data=data, files={"photo": ("p.jpg", jpg(), "image/jpeg")}); ok(r.status_code == 200, "예약 메시지 생성"); j = r.json()
cid = re.search(r"/t/([\w-]+)$", j["url"]).group(1); manage = j["manage"].replace(B, "")
lk = c.get(f"/t/{cid}"); ok(lk.status_code == 200 and "countdown" in lk.text and "비밀 메시지 본문" not in lk.text, "공개 전: 카운트다운만, 본문 비노출")
ok(f'{future.strftime("%Y-%m-%d %H:%M")}에 열려요' in lk.text and "🔒 준영님이 보낸 메시지" in lk.text, "카톡 미리보기용 og: 열리는 시각 안내")
ok(c.get(f"/t/{cid}/img").status_code == 404, "공개 전 사진 요청 → 404")
mg = c.get(manage); ok(mg.status_code == 200 and "비밀 메시지 본문" in mg.text, "관리 페이지에서는 본문 확인 가능")
ok(c.get(f"/t/{cid}/manage?key=bad").status_code == 403, "잘못된 키 → 403")
d1(f"UPDATE capsules SET open_at=open_at-2*86400, close_at=close_at-2*86400+3600 WHERE id='{cid}'")
op = c.get(f"/t/{cid}"); ok(op.status_code == 200 and "비밀 메시지 본문" in op.text and "💌" in op.text, "공개 후: 본문 표시")
ok(c.get(f"/t/{cid}/img").headers.get("content-type") == "image/jpeg", "공개 후 사진 제공")
d1(f"UPDATE capsules SET close_at=1 WHERE id='{cid}'")
ok(c.get(f"/t/{cid}").status_code == 410, "종료 후 접속 → 410(즉시 삭제)")
ok(c.get(f"/t/{cid}/img").status_code == 404, "종료 후 사진 → 404")
# 관리자 삭제·직접 삭제·cron
r2 = c.post("/api/create", data=data).json(); id2 = re.search(r"/t/([\w-]+)$", r2["url"]).group(1); key2 = re.search(r"key=([^&]+)", r2["manage"]).group(1)
ok(c.post(f"/t/{id2}/delete", data={"key": key2}).status_code == 200 and c.get(f"/t/{id2}").status_code == 410, "보낸 사람 직접 삭제")
r3 = c.post("/api/create", data=data).json(); id3 = re.search(r"/t/([\w-]+)$", r3["url"]).group(1)
d1(f"UPDATE capsules SET close_at=1 WHERE id='{id3}'"); c.get(f"{B}/__scheduled")
out = subprocess.run(["npx", "wrangler", "d1", "execute", "geuttae-db", "--local", "--command", f"SELECT COUNT(*) AS n FROM capsules WHERE id='{id3}'"], cwd=__import__("os").path.join(__import__("os").path.dirname(__file__),"..","geuttae"), capture_output=True, text=True).stdout
ok('"n": 0' in out, "정리 작업(cron)이 종료된 메시지 삭제")
r4 = c.post("/api/create", data=data).json(); id4 = re.search(r"/t/([\w-]+)$", r4["url"]).group(1)
c.post("/report", data={"target": f"{B}/t/{id4}", "reason": "기타"})
adm = c.get("/admin?token=dev-admin"); rid = re.findall(r'name="id" value="(\d+)"', adm.text)[0]
c.post("/admin/takedown", data={"token": "dev-admin", "id": rid}); ok(c.get(f"/t/{id4}").status_code == 410, "신고 삭제 조치")
r5 = c.post("/api/create", data={**data, "open_at": local(datetime.now(KST) + timedelta(minutes=1))}).json()
print("SOON", r5["url"])
