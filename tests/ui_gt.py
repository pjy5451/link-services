import sys
from PIL import Image
from playwright.sync_api import sync_playwright
import os, httpx
from datetime import datetime, timedelta, timezone
B = "http://127.0.0.1:8789"
os.makedirs("shots", exist_ok=True)
if len(sys.argv) > 1:
    SOON = sys.argv[1]
else:  # 2분 뒤 열리는 메시지를 API로 만들어 자동 열림을 확인
    t = (datetime.now(timezone(timedelta(hours=9))) + timedelta(minutes=2)).strftime("%Y-%m-%dT%H:%M")
    r = httpx.post(B + "/api/create", data={"sender": "테스트", "message": "생일 축하해! 자동 열림", "open_at": t, "close_after": "3600"}, headers={"User-Agent": "Mozilla/5.0 Safari"})
    SOON = r.json()["url"]
Image.new("RGB", (1200, 800), (250, 200, 210)).save("/tmp/cake.jpg", "JPEG")
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
with sync_playwright() as p:
    br = p.chromium.launch(args=["--no-sandbox"])
    pg = br.new_page(viewport={"width": 420, "height": 900}, device_scale_factor=2, user_agent=UA)
    errs = []; pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto(B + "/"); print("default open_at:", pg.input_value("input[name=open_at]"))
    pg.fill("input[name=sender]", "준영"); pg.fill("input[name=teaser]", "생일 0시에 열어 봐 🎂")
    pg.fill("textarea[name=message]", "생일 축하해!\n올해도 건강하자."); pg.set_input_files("input[name=photo]", "/tmp/cake.jpg")
    pg.check("input[name=agree]")
    pg.screenshot(path="shots/gt_1_create.png", full_page=True)
    pg.click("button:has-text('예약 링크 만들기')"); pg.wait_for_selector("#capresult:not(.hidden)", timeout=15000)
    print("result:", pg.inner_text("#capwhen")); pg.screenshot(path="shots/gt_2_result.png", full_page=True)
    v = br.new_page(viewport={"width": 420, "height": 900}, device_scale_factor=2, user_agent=UA)
    v.goto(SOON); v.wait_for_timeout(1500); print("countdown:", v.inner_text("#countdown"))
    v.screenshot(path="shots/gt_3_locked.png", full_page=True)
    v.wait_for_selector(".letter", timeout=200000); v.wait_for_timeout(500)
    print("auto-opened:", "생일 축하해" in v.content())
    v.screenshot(path="shots/gt_4_opened.png", full_page=True)
    print("console errors:", errs); br.close()
