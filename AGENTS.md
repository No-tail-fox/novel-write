# Project Scope

- This directory is the StoryDream project root. Keep StoryDream source, plans, QA evidence, and release work within this project.
- The previous mixed workspace was `I:\opc`; do not create new StoryDream files there.
- `.local-archive/` contains local migration evidence and development/release archives. It is excluded from Git and may contain private test configuration; do not publish it.
- Keep unrelated document projects and machine maintenance tasks outside this repository.

# Encoding Rules

- Keep all source, config, and documentation files in UTF-8.
- On Windows PowerShell, read Chinese text with `-Encoding UTF8` unless the file is known to be ASCII.
- Prefer PowerShell 7 (`pwsh`) for day-to-day work on Windows.
- If Windows PowerShell 5.1 is unavoidable, switch the session to UTF-8 before reading or writing Chinese text.
- Do not write Chinese content with `Set-Content`, `Out-File`, or stdin pipes unless the encoding is explicit.
- For Chinese Git commit messages, prefer `git commit -m` or `git commit -F <utf8-file>`.
- After editing Chinese content, re-read it with UTF-8 to verify the text is still correct.
