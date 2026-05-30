# Prompt Template Gallery Design

**Goal:** Change prompt template management from a split list/editor into a gallery-first template library where users open a template to view and edit details.

**Approved Direction:** Use the full page for a display list like the reference screen. Each row shows template name, description, default style/id metadata, and actions. `查看` opens the detail editor. `克隆`, `新增`, import/export, and save remain available.

**Architecture:** Keep the existing `PromptTemplatesPage` state and persistence API. Add a lightweight `templateMode` state that switches between `gallery` and `detail`, so no routing or storage changes are needed. Reuse existing editor fields in the detail state.

**UI Notes:** Preserve the current dark admin theme. Use full-width rows, compact right-aligned actions, visible hover/focus states, and responsive stacking on narrow screens.

