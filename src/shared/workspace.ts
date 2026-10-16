export interface WorkspaceSettings {
  workspace: string;
  outputDirectory: string;
  workspaceInput: string;
  outputInput: string;
}
export interface BrainNode {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  kind: 'folder' | 'document';
  extension?: string;
  modifiedAt?: string;
}
export interface BrainCatalog {
  root: string;
  nodes: BrainNode[];
  router: string | null;
  warnings: string[];
  scannedAt: string;
}
