"""Measure actual production HTML against the pinned template's real footer."""
import asyncio
import json
import sys
from pathlib import Path
from playwright.async_api import async_playwright


async def main():
    work = Path(sys.argv[1]).resolve()
    cases = json.loads((work / "manifest.json").read_text(encoding="utf-8"))
    rows, external_requests, errors = [], [], []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1080, "height": 1920})

        async def route(request):
            if request.request.url.startswith(("file:", "data:", "blob:")):
                await request.continue_()
            else:
                external_requests.append(request.request.url)
                await request.abort()

        await page.route("**/*", route)
        page.on("pageerror", lambda error: errors.append(str(error)))
        await page.goto((work / "original.html").as_uri())
        await page.evaluate("document.fonts.ready")
        footer_bottom = await page.locator(".footer").evaluate("e => e.getBoundingClientRect().bottom")
        assert abs(footer_bottom - 1436.5) < 1, footer_bottom
        await page.screenshot(path=str(work / "original-overlay.png"))
        for case in cases:
            await page.goto(Path(case["file"]).as_uri())
            await page.wait_for_function("window.__ready === true")
            await page.evaluate("window.__tl.seek(.5)")
            result = await page.locator("#caption").evaluate("""el => {
                const box = el.getBoundingClientRect(), range = document.createRange();
                range.selectNodeContents(el);
                const ink = range.getBoundingClientRect(), style = getComputedStyle(el);
                const rect = value => ({top:value.top,bottom:value.bottom,left:value.left,right:value.right,height:value.height});
                return {box:rect(box),ink:rect(ink),text:el.textContent,font:style.font,
                    stroke:parseFloat(style.webkitTextStrokeWidth)||0,padding:style.padding};
            }""")
            assert result["text"] == case["text"], case["name"] + " changed text"
            box, ink, stroke = result["box"], result["ink"], result["stroke"]
            safe = (box["top"] >= footer_bottom and ink["top"] - stroke >= footer_bottom
                    and box["bottom"] <= 1920 * .95 and ink["bottom"] + stroke <= 1920 * .95
                    and ink["left"] - stroke >= 0 and ink["right"] + stroke <= 1080)
            if case.get("rejected"):
                assert not safe, case["name"] + " should fit at the minimum instead of being rejected"
            else:
                assert safe, json.dumps({"name": case["name"], "measurement": result}, ensure_ascii=False)
            rows.append({"name": case["name"], "fontSize": case["caption"]["fontSize"],
                         "rejected": bool(case.get("rejected")), "safeAtMeasuredSize": safe,
                         "textPreserved": True, **result})
            if case["name"] in {"W150", "W100", "cjk", "mixed", "multiline", "styled"}:
                await page.screenshot(path=str(work / (case["name"] + ".png")))
        await browser.close()
    assert not errors, errors
    assert not external_requests, external_requests
    report = {"status": "passed", "renderer": "buildShortVideoComposition production HTML",
              "footerBottom": footer_bottom, "safeBottom": 1920 * .95,
              "accepted": sum(not row["rejected"] for row in rows),
              "explicitlyRejected": sum(row["rejected"] for row in rows),
              "paidRequests": 0, "externalRequests": external_requests, "pageErrors": errors,
              "fontCoverage": "Configured families resolved to locally installed fonts or their production fallbacks",
              "rows": rows}
    (work / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "rows"}, ensure_ascii=False))


asyncio.run(main())
