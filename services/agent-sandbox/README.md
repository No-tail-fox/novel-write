# Windows agent sandbox: controlled runtime gate

**Production Python execution is unavailable.** Unknown commands and payload requests return exit 126 with `ready:false`; there is no unsandboxed fallback or arbitrary executable option. The controlled Python fixture attempts real execution of a private staged copy of the bundled interpreter, but startup fails on the implementation host. Do not expose `run_python` as available.

## Reproduce

From the repository root in PowerShell 7:

```powershell
./scripts/build-agent-sandbox.ps1 -Test
# Native preflight passes, arbitrary payload request is refused.
./scripts/build-agent-sandbox.ps1 -PythonTest
# Expected current result: controlled Python gate fails, script throws.
./services/agent-sandbox/bin/sandbox_launcher.exe --python-self-test ./services/agent-sandbox/fixtures
# Direct gate exits 126; diagnostics on stderr.
```

Build uses authorized MSVC, static CRT, `/W4 /WX`, and no installs/paid APIs. `-Compiler` and `-WindowsSdk` are supported. Environment changes in the build script are restored.

## Native launch boundary

Each run creates a unique temporary AppContainer profile and private fixture. Protected ACLs are applied only to newly created directories/copied files. No existing project, user-asset, ancestor, or Windows ACL is modified. Profile deletion checks HRESULT on normal cleanup and emits errors from exception cleanup. The observed Python failure path explicitly checks tree removal and profile deletion before returning its error.

Child launch uses LPAC `PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT`, zero capabilities, no inherited handles, and a minimal environment containing LOCALAPPDATA, SystemRoot, TEMP, TMP, USERPROFILE, WINDIR. Creation is suspended, then assignment to a private job and verification of membership, AppContainer token, exact SID and zero capabilities precede resume. Job limits are 64 MiB per process/aggregate, one active process, and kill-on-close. Native timeout and job-close termination both pass and wait for child exit.

## Python staging

The interpreter source is fixed relative to the installed launcher: repository `vendor/python/python.exe`. There is no executable override. The fixture copies flat bundled DLL/PYD/ZIP files and python.exe into a new runtime directory, rejecting reparse-point entries; pythonw.exe and arbitrary subdirectories are not copied. A new isolated python312._pth contains only python312.zip and the runtime directory, without site initialization. A small explicit list of Windows runtime DLLs is copied to this private runtime for LPAC loader diagnosis. These are trusted runtime dependencies, not permission grants on Windows directories.

New project/runtime directories are read/execute-only to the package; new out/temp directories are writable. A private sibling canary receives an owner-only DACL. Scripts are fixed fixture strings, launched with `-I -S -B`. Python fixtures cover protected reads/writes, output/temp writes, IPv4/IPv6 loopback TCP/UDP and external TCP/UDP, timeout, job-close cancellation, and MemoryError. **These Python fixtures have not executed successfully.** They do not yet establish network, resource, or arbitrary user-data isolation.

## Observed results

On this host, the compiled native preflight passes. The diagnostic native child runs inside the same LPAC and staged tree and reports:

| Probe | Actual result |
| --- | --- |
| Owner-only sibling canary read/write | Win32 5, access denied |
| Project fixture read | Success |
| Project write | Win32 5, access denied |
| Output and temp writes | Success |
| Windows System32/kernel32.dll read | Success; trusted OS runtime is ambient |
| WSAStartup | 10107, provider initialization failure; socket tests not reached |
| Staged python312.dll read | Success |
| Staged python312.dll map without resolving imports | Success |
| Each Python direct import library and function resolution | Success |
| Full python312.dll LoadLibrary | Win32 5 / NTSTATUS 0xC0000022 |
| Staged python.exe execution | Exits 0xC0000022 before Python fixture |
| Failure-path private fixture/profile cleanup | Explicit checked success |

Testing the narrowly scoped lpacLoaderThreads capability and private child process/thread object ACLs did not resolve startup. Those ineffective permission changes were removed. Final code retains zero capabilities.

Windows DLL readability is expected for the trusted OS runtime closure; it does not show arbitrary user files are readable. Conversely, one denied private canary does not establish arbitrary user-data isolation. LPAC is an ACL boundary, not a filesystem namespace.

## Remaining gates

Resolve the Python DLL loader failure without weakening user-data/network isolation. Then require actual Python file/network probes, reachable loopback listeners, DNS/IPv4/IPv6/TCP/UDP checks, broad user-data denial tests, handle/reparse/hardlink attacks, memory exhaustion, timeout and cancellation. A safe general script API also needs input/output staging validation, artifact validation and cleanup recovery. Forced launcher termination reaps the assigned child through job close, but can leave private fixture/profile resources; crash recovery is not implemented.

The diagnostic native loader entry point refuses execution outside an AppContainer. It exists only for fixed self-test staging and is not a payload launcher. Even if future Python fixtures reach completion, this gate currently returns 126 until the remaining guarantees are implemented and reviewed.
