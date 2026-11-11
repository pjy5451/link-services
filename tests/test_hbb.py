import io, re, sys, threading, httpx
from PIL import Image
B = "http://127.0.0.1:8788"
UA = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1"}
KAKAO = {"User-Agent": "facebookexternalhit/1.1; kakaotalk-scrap/1.0; +https://devtalk.kakao.com/"}
c = httpx.Client(base_url=B, follow_redirects=False, timeout=30, headers=UA)
def ok(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: sys.exit(1)
def jpg():
    b = io.BytesIO(); Image.new("RGB", (800, 600), (30, 120, 90)).save(b, "JPEG"); return b.getvalue()
def make(views, pw="", expire=86400):
    r = c.put("/api/upload", content=jpg(), headers={"X-Expire": str(expire), "X-Max-Views": str(views), "X-Password": pw, "X-Wm-Ip": "1", "X-Wm-Text": "%ED%85%8C%EC%8A%A4%ED%8A%B8"})
    ok(r.status_code == 200, f"업로드(views={views}) → 200"); j = r.json()
    return re.search(r"/v/([\w-]+)$", j["url"]).group(1), j["manage"]

ok(c.put("/api/upload", content=b"hello", headers={"X-Expire": "3600", "X-Max-Views": "1"}).status_code == 415, "이미지 아님 → 415")
ok(c.put("/api/upload", content=jpg(), headers={"X-Expire": "12345", "X-Max-Views": "1"}).status_code == 400, "허용 안 된 만료값 → 400")
vid, manage = make(1)
# 카카오톡 미리보기 봇이 먼저 링크를 열어도 소진되지 않아야 함
for _ in range(3):
    r = c.get(f"/v/{vid}", headers=KAKAO)
ok(r.status_code == 200 and "사진이 도착했어요" in r.text and "/i/" not in r.text, "미리보기 봇 GET: 이미지 없는 안내 화면")
ok(c.post(f"/v/{vid}/open", json={}, headers=KAKAO).status_code == 403, "봇의 열람 시도(POST) 차단")
ok("열람: 0" not in c.get(manage.replace(B, "")).text and "0회 / 1회" in c.get(manage.replace(B, "")).text, "봇 접근 후에도 열람 0회")
r = c.post(f"/v/{vid}/open", json={}); ok(r.status_code == 200, "사람의 열람 → 200"); j = r.json()
ok(j["left"] == 0 and any("열람 127.0.0.1" in w for w in j["wm"]) and "테스트" in j["wm"], f"워터마크 문구(IP·시각·추가문구) {j['wm']}")
img = c.get(j["img"]); ok(img.status_code == 200 and img.headers["content-type"] == "image/jpeg" and "no-store" in img.headers["cache-control"], "이미지 토큰으로 1회 제공(no-store)")
ok(c.get(j["img"], headers={**UA}).status_code == 200, "토큰 유효시간 내 재요청 허용(같은 IP)")
ok(c.post(f"/v/{vid}/open", json={}).status_code == 410, "두 번째 열람 → 410")
ok(c.get(f"/v/{vid}").status_code == 410, "링크 재방문 → 사라진 사진(410)")
m = c.get(manage.replace(B, "")); ok("1회 / 1회" in m.text and "127.0.*.*" in m.text, "관리 페이지: 열람 1회·IP 일부만 기록")
# 동시 열람 경쟁: 1회짜리를 10명이 동시에 눌러도 1명만 성공
vid2, _ = make(1)
res = []
def hit():
    res.append(httpx.post(f"{B}/v/{vid2}/open", json={}, headers=UA).status_code)
ts = [threading.Thread(target=hit) for _ in range(10)]; [t.start() for t in ts]; [t.join() for t in ts]
ok(res.count(200) == 1, f"동시 10명 → 성공 1명 ({sorted(res)})")
# 비밀번호
vid3, man3 = make(3, pw="1234")
ok(c.post(f"/v/{vid3}/open", json={"password": "0000"}).status_code == 401, "비밀번호 틀림 → 401")
ok(c.post(f"/v/{vid3}/open", json={"password": "1234"}).status_code == 200, "비밀번호 맞음 → 200")
# 회수
key3 = re.search(r"key=([^&]+)", man3).group(1)
ok(c.post(f"/v/{vid3}/revoke", data={"key": key3}).status_code == 303, "회수 → 303")
ok(c.get(f"/v/{vid3}").status_code == 410, "회수 후 → 410")
ok(c.post(f"/v/{vid3}/revoke", data={"key": "wrong"}).status_code == 403, "잘못된 키로 회수 → 403")
# 신고·관리자 삭제
vid4, _ = make(0)
c.post("/report", data={"target": f"{B}/v/{vid4}", "reason": "기타"})
adm = c.get("/admin?token=dev-admin"); rid = re.findall(r'name="id" value="(\d+)"', adm.text)[0]
c.post("/admin/takedown", data={"token": "dev-admin", "id": rid})
ok(c.get(f"/v/{vid4}").status_code == 410, "신고 삭제 조치 후 → 410")
vid5, _ = make(10, expire=600)
print("EXPIRE_ID", vid5)
