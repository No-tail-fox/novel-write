# Encoding Rules

- Keep all source, config, and documentation files in UTF-8.
- On Windows PowerShell, read Chinese text with `-Encoding UTF8` unless the file is known to be ASCII.
- Prefer PowerShell 7 (`pwsh`) for day-to-day work on Windows.
- If Windows PowerShell 5.1 is unavoidable, switch the session to UTF-8 before reading or writing Chinese text.
- Do not write Chinese content with `Set-Content`, `Out-File`, or stdin pipes unless the encoding is explicit.
- For Chinese Git commit messages, prefer `git commit -m` or `git commit -F <utf8-file>`.
- After editing Chinese content, re-read it with UTF-8 to verify the text is still correct.
