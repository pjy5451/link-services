import io, re
from PIL import Image
from playwright.sync_api import sync_playwright
import os; os.makedirs("shots", exist_ok=True)
B = "http://127.0.0.1:8787"
def jpeg(path, color, date):
    im = Image.new("RGB", (1600, 1200), color); ex = Image.Exif(); ex[0x8769] = {0x9003: date}
    im.save(path, "JPEG", exif=ex.tobytes())
jpeg("/tmp/living.jpg", (180, 170, 150), "2026:11:11 09:30:12")
jpeg("/tmp/kitchen.jpg", (120, 140, 160), "2026:11:11 09:31:40")
with sync_playwright() as p:
    br = p.chromium.launch(args=["--no-sandbox"])
    pg = br.new_page(viewport={"width": 420, "height": 900}, device_scale_factor=2)
    errs = []; pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto(B + "/"); pg.screenshot(path="shots/bang_1_home.png", full_page=True)
    pg.fill("input[name=title]", "흑석동 ○○빌라 301호 입주 기록"); pg.fill("textarea[name=note]", "2026.11 ~ 2028.11 전세")
    pg.click("button:has-text('기록 만들기')"); pg.wait_for_load_state("networkidle")
    manage = pg.url
    form = pg.locator("form.uploader[data-stage=in]")
    form.locator("input[name=room]").fill("거실")
    form.locator("input[type=file]").set_input_files(["/tmp/living.jpg", "/tmp/kitchen.jpg"])
    form.locator("button").click()
    pg.wait_for_url(re.compile(r".*#stage-in"), timeout=20000); pg.wait_for_load_state("networkidle")
    html = pg.content()
    print("uploaded imgs:", html.count("/img/"), "| EXIF shown:", "2026:11:11 09:30:12" in html, "| console errors:", errs)
    pg.screenshot(path="shots/bang_2_manage.png", full_page=True)
    share = pg.locator(".linkbox input").first.input_value()
    pg2 = br.new_page(viewport={"width": 420, "height": 900}, device_scale_factor=2)
    pg2.goto(share); pg2.fill("input[name=name]", "김집주"); pg2.check("input[name=agree]"); pg2.click("button:has-text('확인했습니다')")
    pg2.wait_for_load_state("networkidle"); pg2.screenshot(path="shots/bang_3_share_acked.png", full_page=True)
    print("ack shown:", "김집주" in pg2.content())
    br.close()
