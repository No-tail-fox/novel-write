import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

type RuntimeDownloadManifest = {
  version: number;
  artifacts: {
    pythonEmbed: { url: string; sha256: string };
    getPip: { url: string; sha256: string };
  };
};

describe('Windows Python runtime bootstrap integrity', () => {
  it('pins official bootstrap artifacts and verifies both cache and fresh downloads before use', async () => {
    const [runtimeScript, manifestText] = await Promise.all([
      readFile(new URL('../scripts/prepare-python-runtime.ps1', import.meta.url), 'utf8'),
      readFile(new URL('../scripts/runtime-downloads.json', import.meta.url), 'utf8'),
    ]);
    const manifest = JSON.parse(manifestText) as RuntimeDownloadManifest;

    expect(manifest).toEqual({
      version: 1,
      artifacts: {
        pythonEmbed: {
          url: 'https://www.python.org/ftp/python/3.12.4/python-3.12.4-embed-amd64.zip',
          sha256: '15fea3c9367653a85086fe37216b4d1a1c78688fa5e1587e1db0b0f658856564',
        },
        getPip: {
          url: 'https://bootstrap.pypa.io/get-pip.py',
          sha256: 'a341e1a43e38001c551a1508a73ff23636a11970b61d901d9a1cad2a18f57055',
        },
      },
    });
    expect(runtimeScript).toContain('$DownloadManifestPath');
    expect(runtimeScript).toContain('Ensure-VerifiedDownload');
    expect(runtimeScript).toContain('Get-FileHash -Algorithm SHA256 -LiteralPath $Path');
    expect(runtimeScript).toContain('SHA-256 mismatch');
    expect(runtimeScript).toContain('Removing cached artifact with invalid SHA-256');
    expect(runtimeScript).toContain('Remove-Item -LiteralPath $Path -Force');
    expect(runtimeScript).toContain('manifest_sha256=$ManifestHash');
    expect(runtimeScript).toContain('Ensure-VerifiedDownload $Downloads.artifacts.pythonEmbed $ZipPath');
    expect(runtimeScript).toContain('Ensure-VerifiedDownload $Downloads.artifacts.getPip $GetPipPath');
  });

  it('rebuilds a runtime whose marker cannot prove the current manifest identity', async () => {
    const runtimeScript = await readFile(
      new URL('../scripts/prepare-python-runtime.ps1', import.meta.url),
      'utf8',
    );

    expect(runtimeScript).toContain('function Test-RuntimeMarkerCurrent');
    expect(runtimeScript).toContain(
      'if ((Test-Path -LiteralPath $PythonExe) -and !(Test-RuntimeMarkerCurrent))',
    );
    expect(runtimeScript).toContain(
      'Removing runtime without a current verified-download marker',
    );
    expect(runtimeScript.indexOf('Remove-Item -LiteralPath $VendorDir -Recurse -Force')).toBeLessThan(
      runtimeScript.indexOf('Ensure-VerifiedDownload $Downloads.artifacts.pythonEmbed $ZipPath'),
    );
  });
});
