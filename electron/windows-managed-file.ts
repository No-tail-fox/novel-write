import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

interface ManagedDirectoryIdentity {
  version: 1;
  dev: string;
  ino: string;
}

const maxUint32 = 0xffff_ffffn;
const maxUint64 = 0xffff_ffff_ffff_ffffn;
const maxDiagnosticLength = 64 * 1024;

const windowsWriterScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace StoryDreamSecurity {
  public static class ManagedFileWriter {
    private const uint FILE_READ_ATTRIBUTES = 0x00000080;
    private const uint GENERIC_WRITE = 0x40000000;
    private const uint DELETE = 0x00010000;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint CREATE_NEW = 1;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    private const uint FILE_ATTRIBUTE_NORMAL = 0x00000080;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private const int FILE_DISPOSITION_INFO_CLASS = 4;

    [StructLayout(LayoutKind.Sequential)]
    private struct BY_HANDLE_FILE_INFORMATION {
      public uint FileAttributes;
      public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
      public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
      public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
      public uint VolumeSerialNumber;
      public uint FileSizeHigh;
      public uint FileSizeLow;
      public uint NumberOfLinks;
      public uint FileIndexHigh;
      public uint FileIndexLow;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FILE_DISPOSITION_INFO {
      [MarshalAs(UnmanagedType.Bool)]
      public bool DeleteFile;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(
      string path,
      uint desiredAccess,
      uint shareMode,
      IntPtr securityAttributes,
      uint creationDisposition,
      uint flagsAndAttributes,
      IntPtr templateFile
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(
      SafeFileHandle handle,
      out BY_HANDLE_FILE_INFORMATION information
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WriteFile(
      SafeFileHandle handle,
      IntPtr buffer,
      uint bytesToWrite,
      out uint bytesWritten,
      IntPtr overlapped
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool FlushFileBuffers(SafeFileHandle handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileSizeEx(SafeFileHandle handle, out long fileSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetFileInformationByHandle(
      SafeFileHandle handle,
      int informationClass,
      IntPtr information,
      uint bufferSize
    );

    public static void Write(
      string directoryPath,
      string destinationPath,
      uint expectedVolumeSerial,
      ulong expectedFileIndex,
      Stream input,
      long expectedLength
    ) {
      string directory = NormalizeDirectory(directoryPath);
      string destination = Path.GetFullPath(destinationPath);
      string destinationDirectory = NormalizeDirectory(Path.GetDirectoryName(destination));
      if (!String.Equals(directory, destinationDirectory, StringComparison.OrdinalIgnoreCase)) {
        throw new InvalidOperationException("WINDOWS_MANAGED_FILE_PATH_INVALID: Destination must be a direct child of the pinned directory.");
      }

      using (SafeFileHandle directoryHandle = CreateFileW(
        directory,
        FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        IntPtr.Zero,
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
        IntPtr.Zero
      )) {
        EnsureHandle(directoryHandle, "WINDOWS_MANAGED_DIRECTORY_OPEN_FAILED");
        BY_HANDLE_FILE_INFORMATION directoryInformation;
        if (!GetFileInformationByHandle(directoryHandle, out directoryInformation)) {
          throw Win32Failure("WINDOWS_MANAGED_DIRECTORY_INSPECTION_FAILED");
        }
        if ((directoryInformation.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0
          || (directoryInformation.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) {
          throw new InvalidOperationException("WINDOWS_MANAGED_DIRECTORY_INVALID: Directory is missing or is a reparse point.");
        }
        ulong actualFileIndex = ((ulong)directoryInformation.FileIndexHigh << 32) | directoryInformation.FileIndexLow;
        if (directoryInformation.VolumeSerialNumber != expectedVolumeSerial || actualFileIndex != expectedFileIndex) {
          throw new InvalidOperationException("WINDOWS_MANAGED_DIRECTORY_IDENTITY_CHANGED: Directory identity changed before destination creation.");
        }

        using (SafeFileHandle destinationHandle = CreateFileW(
          destination,
          GENERIC_WRITE | DELETE,
          0,
          IntPtr.Zero,
          CREATE_NEW,
          FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT,
          IntPtr.Zero
        )) {
          EnsureHandle(destinationHandle, "WINDOWS_MANAGED_DESTINATION_CREATE_FAILED");
          try {
            CopyExact(input, destinationHandle, expectedLength);
            if (!FlushFileBuffers(destinationHandle)) {
              throw Win32Failure("WINDOWS_MANAGED_DESTINATION_FLUSH_FAILED");
            }
            long actualLength;
            if (!GetFileSizeEx(destinationHandle, out actualLength)) {
              throw Win32Failure("WINDOWS_MANAGED_DESTINATION_SIZE_FAILED");
            }
            if (actualLength != expectedLength) {
              throw new IOException("WINDOWS_MANAGED_DESTINATION_SIZE_CHANGED: Destination length does not match the validated buffer.");
            }
          } catch (Exception writeFailure) {
            try {
              MarkForDeletion(destinationHandle);
            } catch (Exception cleanupFailure) {
              throw new AggregateException("WINDOWS_MANAGED_DESTINATION_CLEANUP_FAILED", writeFailure, cleanupFailure);
            }
            throw;
          }
        }
      }
    }

    private static string NormalizeDirectory(string path) {
      if (String.IsNullOrWhiteSpace(path)) {
        throw new InvalidOperationException("WINDOWS_MANAGED_FILE_PATH_INVALID: Directory path is empty.");
      }
      string root = Path.GetPathRoot(path);
      string normalized = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
      return normalized.Length == 0 && !String.IsNullOrEmpty(root) ? root : normalized;
    }

    private static void CopyExact(Stream input, SafeFileHandle destination, long expectedLength) {
      byte[] buffer = new byte[64 * 1024];
      long total = 0;
      int read;
      while ((read = input.Read(buffer, 0, buffer.Length)) > 0) {
        GCHandle pinned = GCHandle.Alloc(buffer, GCHandleType.Pinned);
        try {
          int offset = 0;
          while (offset < read) {
            uint written;
            if (!WriteFile(destination, IntPtr.Add(pinned.AddrOfPinnedObject(), offset), (uint)(read - offset), out written, IntPtr.Zero)) {
              throw Win32Failure("WINDOWS_MANAGED_DESTINATION_WRITE_FAILED");
            }
            if (written == 0) {
              throw new IOException("WINDOWS_MANAGED_DESTINATION_WRITE_FAILED: WriteFile made no progress.");
            }
            offset += checked((int)written);
          }
        } finally {
          pinned.Free();
        }
        total = checked(total + read);
        if (total > expectedLength) {
          throw new IOException("WINDOWS_MANAGED_DESTINATION_INPUT_CHANGED: Input exceeded the validated buffer length.");
        }
      }
      if (total != expectedLength) {
        throw new IOException("WINDOWS_MANAGED_DESTINATION_INPUT_CHANGED: Input did not match the validated buffer length.");
      }
    }

    private static void MarkForDeletion(SafeFileHandle handle) {
      FILE_DISPOSITION_INFO disposition = new FILE_DISPOSITION_INFO { DeleteFile = true };
      int size = Marshal.SizeOf(typeof(FILE_DISPOSITION_INFO));
      IntPtr buffer = Marshal.AllocHGlobal(size);
      try {
        Marshal.StructureToPtr(disposition, buffer, false);
        if (!SetFileInformationByHandle(handle, FILE_DISPOSITION_INFO_CLASS, buffer, (uint)size)) {
          throw Win32Failure("WINDOWS_MANAGED_DESTINATION_CLEANUP_FAILED");
        }
      } finally {
        Marshal.FreeHGlobal(buffer);
      }
    }

    private static void EnsureHandle(SafeFileHandle handle, string operation) {
      if (handle == null || handle.IsInvalid) throw Win32Failure(operation);
    }

    private static Win32Exception Win32Failure(string operation) {
      return new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }
  }
}
'@

try {
  [StoryDreamSecurity.ManagedFileWriter]::Write(
    $env:STORYDREAM_MANAGED_DIRECTORY,
    $env:STORYDREAM_MANAGED_DESTINATION,
    [uint32]::Parse($env:STORYDREAM_MANAGED_VOLUME),
    [uint64]::Parse($env:STORYDREAM_MANAGED_FILE_INDEX),
    [Console]::OpenStandardInput(),
    [int64]::Parse($env:STORYDREAM_MANAGED_LENGTH)
  )
} catch {
  [Console]::Error.WriteLine($_.Exception.ToString())
  exit 1
}
`;

export async function writeWindowsManagedFile(
  directoryPath: string,
  destinationPath: string,
  expectedIdentityJson: string,
  validatedBytes: Buffer,
): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('WINDOWS_MANAGED_FILE_UNSUPPORTED: Identity-pinned writes require Windows.');
  }
  const directory = resolve(directoryPath);
  const destination = resolve(destinationPath);
  if (dirname(destination).toLowerCase() !== directory.toLowerCase()) {
    throw new Error('WINDOWS_MANAGED_FILE_PATH_INVALID: Destination must be a direct child of the pinned directory.');
  }
  const identity = parseIdentity(expectedIdentityJson);
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot) {
    throw new Error('WINDOWS_MANAGED_FILE_RUNTIME_UNAVAILABLE: Windows system root is unavailable.');
  }
  const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const encodedCommand = Buffer.from(windowsWriterScript, 'utf16le').toString('base64');
  const child = spawn(powershell, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodedCommand,
  ], {
    env: {
      ...process.env,
      STORYDREAM_MANAGED_DIRECTORY: directory,
      STORYDREAM_MANAGED_DESTINATION: destination,
      STORYDREAM_MANAGED_VOLUME: identity.dev,
      STORYDREAM_MANAGED_FILE_INDEX: identity.ino,
      STORYDREAM_MANAGED_LENGTH: String(validatedBytes.length),
    },
    stdio: ['pipe', 'ignore', 'pipe'],
    windowsHide: true,
  });

  await new Promise<void>((resolveWrite, rejectWrite) => {
    let settled = false;
    let diagnostic = '';
    let inputError: Error | null = null;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (diagnostic.length < maxDiagnosticLength) diagnostic += chunk.slice(0, maxDiagnosticLength - diagnostic.length);
    });
    child.stdin.on('error', (error) => {
      inputError = error;
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      rejectWrite(new Error(`WINDOWS_MANAGED_FILE_RUNTIME_FAILED: ${error.message}`));
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      if (code === 0 && inputError === null) {
        resolveWrite();
        return;
      }
      const reason = diagnostic.trim() || inputError?.message || `PowerShell exited with code ${String(code)} and signal ${String(signal)}.`;
      rejectWrite(new Error(`WINDOWS_MANAGED_FILE_WRITE_FAILED: ${reason}`));
    });
    child.stdin.end(validatedBytes);
  });
}

function parseIdentity(identityJson: string): ManagedDirectoryIdentity {
  let value: unknown;
  try {
    value = JSON.parse(identityJson);
  } catch {
    throw new Error('WINDOWS_MANAGED_DIRECTORY_IDENTITY_INVALID: Identity is not valid JSON.');
  }
  if (!isRecord(value)
    || value.version !== 1
    || !isUnsignedDecimal(value.dev)
    || !isUnsignedDecimal(value.ino)
    || BigInt(value.dev) > maxUint32
    || BigInt(value.ino) > maxUint64) {
    throw new Error('WINDOWS_MANAGED_DIRECTORY_IDENTITY_INVALID: Identity fields are invalid.');
  }
  return { version: 1, dev: value.dev, ino: value.ino };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUnsignedDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value);
}
