export interface ArtifactStorageLocation {
  directory: string;
  defaultDirectory: string;
  pendingDirectory: string | null;
  migrationError: string | null;
}
