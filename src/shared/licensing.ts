export interface SignedEnvelope { payload: string; signature: string }

export interface LicenseLease {
  schemaVersion: 1;
  kind: 'lease';
  status: 'active';
  licenseId: string;
  deviceId: string;
  keyHash: string;
  issuedAt: number;
  validUntil: number;
  expiresAt: number;
  // Optional server-granted deadline for running on a persisted lease while the license server is unreachable.
  offlineGraceUntil?: number;
  maxDevices: number;
  devices: Array<{ deviceId: string; label: string; lastSeen: number }>;
}

/** v3 lease: server assigns all identity fields; hardware values are advisory only. */
export interface LicenseLeaseV3 {
  schemaVersion: 3;
  kind: 'lease';
  status: 'active';
  licenseId: string;
  /** Server-assigned device record UUID — not derived from hardware. */
  deviceRecordId: string;
  /** Server-assigned credential UUID for the active public key. */
  credentialId: string;
  /** Server credential generation; increments when recovery revokes the old key. */
  credentialEpoch: number;
  /** Server-assigned binding UUID for this device × license slot. */
  bindingId: string;
  /** Incremented on rebind / recovery; used by admin for optimistic concurrency. */
  bindingRevision: number;
  keyHash: string;
  issuedAt: number;
  validUntil: number;
  expiresAt: number;
  offlineGraceUntil?: number;
  maxDevices: number;
  devices: Array<{ deviceRecordId: string; label: string; lastSeen: number }>;
}

export type AnyLicenseLease = LicenseLease | LicenseLeaseV3;

export interface RecoveryRequest {
  id: string;
  licenseId: string;
  deviceRecordId: string;
  deviceLabel: string;
  state: 'pending' | 'approved' | 'rejected' | 'completed' | 'expired';
  createdAt: number;
  expiresAt: number;
}

export interface LicenseStatus {
  configured: boolean;
  status: 'unconfigured' | 'inactive' | 'active' | 'offline' | 'locked' | 'expired' | 'error';
  deviceId: string;
  deviceLabel: string;
  expiresAt: string | null;
  validUntil: string | null;
  devices: LicenseLease['devices'];
  message: string;
}

export interface ReleaseManifest {
  schemaVersion: 1;
  kind: 'release';
  sequence: number;
  version: string;
  minimumVersion: string;
  platform: 'win32';
  arch: 'x64';
  filename: string;
  sha256: string;
  size: number;
  notes: string;
  issuedAt: number;
  validUntil: number;
}

export interface AnnouncementManifest {
  schemaVersion: 1;
  kind: 'announcement';
  id: string;
  category: 'update' | 'problem';
  title: string;
  body: string;
  version: string | null;
  createdAt: number;
}

// A separate signed protocol keeps strict v1 release clients compatible.
export interface DifferentialManifest {
  schemaVersion: 1;
  kind: 'differential';
  sequence: number;
  version: string;
  filename: string;
  sha256: string;
  sha512: string;
  size: number;
  blockmap: { sha256: string; size: number };
  issuedAt: number;
  validUntil: number;
}

export interface UpdateStatus {
  currentVersion: string;
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';
  release: ReleaseManifest | null;
  announcements: AnnouncementManifest[];
  downloaded: number;
  required: boolean;
  message: string;
}
