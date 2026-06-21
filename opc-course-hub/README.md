# OPC Course Hub

OPC社区AI课程与资源宣传网站。首版是零后端静态应用，用浏览器本地存储维护课程和资源，适合先做内容验证、宣传演示和公众号素材整理。

## Run

```powershell
cd D:\opc\opc-course-hub
node serve.mjs
```

Open:

```text
http://127.0.0.1:4175/opc-course-hub/
```

The server root is `D:\opc`, so the page can also load existing assets in `D:\opc\outputs`.

## Verify

```powershell
cd D:\opc\opc-course-hub
node --test tests/courseHub.test.mjs
node --check assets/app.js
```

## Content Rules

- Courses and resources are guide-only: title, summary, audience, learning goal, official link, and recommendation reason.
- Do not upload or copy paid course videos, courseware, transcripts, or third-party site content.
- AI monetization content must describe capability paths and examples, not promise income.
- Recheck price, availability, official links, and copyright status before public promotion.

## Maintenance

- Use the page's "后台管理" section to add courses or resources during content review.
- Click "导出JSON" to copy the locally edited data.
- If the site is later connected to a backend, use the exported `courses` and `resources` arrays as seed data.
