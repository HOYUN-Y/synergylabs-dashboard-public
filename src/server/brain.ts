import { createHash } from 'node:crypto';
import { basename, dirname, extname } from 'node:path';
import { scanWorkspace } from './workspace-scan.js';
import { loadBrainConfig } from './brain/config.js';
import type { BrainCatalog, BrainNode, WorkspaceSettings } from '../shared/workspace.js';

export const brainNodeId = (root: string, path: string) => createHash('sha256').update(`${root}\0${path}`).digest('hex').slice(0, 24);

export class BrainService {
  constructor(private settings: () => Promise<WorkspaceSettings>) {}
  async catalog(force = false): Promise<BrainCatalog> {
    const settings = await this.settings();
    const inventory = await scanWorkspace(settings.workspace, settings.outputDirectory, force);
    const id = (path: string) => brainNodeId(inventory.root, path);
    const parent = (path: string) => id(dirname(path) === '.' ? '' : dirname(path));
    const nodes: BrainNode[] = inventory.folders.map(path => ({ id: id(path), parentId: path ? parent(path) : null,
      name: basename(path || inventory.root), path, kind: 'folder' }));
    for (const file of inventory.files) {
      const extension = extname(file.name).toLowerCase();
      if (!['.md', '.txt', '.html', '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.csv'].includes(extension)) continue;
      nodes.push({ id: id(file.path), parentId: parent(file.path), name: file.name, path: file.path, kind: 'document', extension, modifiedAt: file.modifiedAt });
    }
    const current = await this.settings();
    if (current.workspace !== settings.workspace || current.outputDirectory !== settings.outputDirectory) throw new Error('작업 공간이 변경되었습니다. 다시 스캔해 주세요.');
    // 라우터 이름은 지도와 같은 설정에서 읽는다. 설정 오류는 지도 API(/api/brain/graph)가 알리고, 목록은 라우터 없이 보인다
    const routerFile = await loadBrainConfig().then(config => config.routerFile, () => null);
    return { root: inventory.root, nodes, router: inventory.files.find(file => file.path.normalize('NFC') === routerFile)?.path ?? null,
      warnings: inventory.warnings, scannedAt: new Date().toISOString() };
  }
}
