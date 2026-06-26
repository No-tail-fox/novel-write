# OPC Course Hub Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign `opc-course-hub` into a separated multi-view learning site with a vivid standalone homepage, dedicated content pages, and a ChatGPT-style AI workbench.

**Architecture:** Keep the app as a zero-backend static site. Replace the current all-in-one anchor page with a hash-routed client app that renders one view at a time: home, course library, AI resources, learning route, OPC courses, workbench, WeChat publisher, and admin. Keep content in testable data modules and preserve localStorage for editable course/resource state.

**Tech Stack:** Vanilla HTML/CSS/ES modules, Node built-in test runner, current `serve.mjs` static server.

---

### Task 1: Add Test Coverage For New Site Shape

**Files:**
- Modify: `opc-course-hub/tests/courseHub.test.mjs`
- Modify: `opc-course-hub/assets/app-data.mjs`

**Steps:**
1. Add failing tests for the new navigation contract: route ids must include `home`, `courses`, `resources`, `route`, `local`, `workbench`, `wechat`, and `admin`.
2. Add failing tests for workbench modes: labels must be `文本`, `语音`, `视频`, `图像`, `音乐`, and each mode must expose a prompt placeholder and sample action.
3. Add failing tests for Feishu knowledge content: seed data must include at least 8 Feishu-derived items and include titles from the existing source set such as `Seedance2.0做动漫修仙视频`, `电商主图二创`, and `【S86】小说推文`.
4. Run `node --test opc-course-hub/tests/courseHub.test.mjs` and confirm the new tests fail because the exports do not exist yet.

### Task 2: Expand Data Model

**Files:**
- Modify: `opc-course-hub/assets/app-data.mjs`
- Modify: `opc-course-hub/tests/courseHub.test.mjs`

**Steps:**
1. Add `siteNavItems`, `homeHighlights`, `workbenchModes`, `defaultWorkbenchThreads`, and `feishuKnowledgeItems` exports.
2. Keep existing `defaultCourses`, `defaultResources`, `defaultWechatTemplates`, filtering, route plan, stats, and localStorage helpers compatible.
3. Add Feishu items as curated guide entries only: title, category, scenario, summary, sourceName, tags, and rights note. Do not copy long source text.
4. Re-run the test file and confirm the new data tests pass.

### Task 3: Replace Single-Page Markup With A Routed Shell

**Files:**
- Modify: `opc-course-hub/index.html`
- Modify: `opc-course-hub/assets/app.js`

**Steps:**
1. Simplify `index.html` to a persistent header, `<main id="app">`, and footer.
2. Change top navigation links from section anchors to hash routes like `#/courses` and `#/workbench`.
3. In `app.js`, add route parsing, active nav state, and `hashchange` rendering.
4. Render only the active view into `#app`, so the homepage no longer contains the full course/resource/route/admin content.
5. Preserve direct refresh behavior: empty hash and unknown hash should route to home.

### Task 4: Build The New Views

**Files:**
- Modify: `opc-course-hub/assets/app.js`
- Modify: `opc-course-hub/assets/styles.css`

**Steps:**
1. Home: implement a vivid hero inspired by the accepted concept, using `opc-poster.png` and `mentor-wall-preview.png` only as supporting media, with curated preview links instead of all content.
2. Course library: move the existing course filters and cards into the `courses` view.
3. AI resources: show current resources plus a Feishu knowledge subsection/searchable rail.
4. Learning route: show the current generated route as a dedicated page.
5. OPC courses: show the local course narrative and course-category promotion blocks as a dedicated page.
6. WeChat: keep the current generator as a dedicated page.
7. Admin: keep localStorage-backed forms and export/reset tools as a dedicated page.

### Task 5: Build ChatGPT-Style Workbench

**Files:**
- Modify: `opc-course-hub/assets/app.js`
- Modify: `opc-course-hub/assets/styles.css`

**Steps:**
1. Add a `workbench` view with a left history sidebar, selected thread, message stream, and bottom composer.
2. Seed the left sidebar with pinned/recent threads from `defaultWorkbenchThreads`.
3. Add mode tabs for `文本`, `语音`, `视频`, `图像`, and `音乐`; switching modes updates the composer placeholder and sample actions without leaving the page.
4. Add a local-only send action: user text is appended as a message and the assistant replies with a deterministic demo response based on the active mode and site content. No external API calls.
5. Keep the workbench light-mode, simple, and utility-first; do not add homepage-style hero blocks or dense dashboard cards.

### Task 6: Visual System And Responsive Behavior

**Files:**
- Modify: `opc-course-hub/assets/styles.css`

**Steps:**
1. Replace the current dense section/card styling with a cleaner page system: vivid home hero, restrained content pages, and app-like workbench shell.
2. Keep cards at 8px radius or less, avoid nested cards, avoid decorative orbs, and keep typography stable without viewport-width font scaling.
3. Make mobile navigation wrap cleanly; workbench sidebar collapses above the chat rather than causing horizontal overflow.
4. Ensure text does not overflow buttons, cards, sidebars, or composer controls.

### Task 7: Verify And Iterate

**Files:**
- Test: `opc-course-hub/tests/courseHub.test.mjs`

**Steps:**
1. Run `node --test tests/courseHub.test.mjs` from `opc-course-hub`.
2. Run `node --check assets/app.js` and `node --check assets/app-data.mjs`.
3. Start `node serve.mjs` and load `http://127.0.0.1:4175/`.
4. Browser-check these flows: homepage loads, each top nav item switches view, course filter works, resource search works, WeChat generation works, admin add/export works, workbench mode switching works, and workbench send action appends messages.
5. Capture desktop and mobile screenshots; compare against the generated homepage and workbench concepts for layout, density, palette, and interaction skeleton.

## Assumptions

- The site remains a static app; no backend and no live model API integration in this pass.
- Hash routes are acceptable for “separate pages” because they keep the current static server simple and robust.
- Feishu source content is used as curated metadata and summaries only, not copied wholesale.
- The ChatGPT-like workbench should copy interaction structure, not OpenAI branding or proprietary visual details.
