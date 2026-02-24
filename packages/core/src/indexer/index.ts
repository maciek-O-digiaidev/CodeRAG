export type { IndexedFileState } from './index-state.js';
export { IndexState, computeFileHash } from './index-state.js';

export type { IndexCheckResult } from './index-check.js';
export { checkIndexExists } from './index-check.js';

export type { ScannedFile } from './file-scanner.js';
export { FileScanner, ScanError } from './file-scanner.js';

export type { IndexerConfig, ChangeSet, IndexerResult } from './incremental-indexer.js';
export { IncrementalIndexer, IndexerError } from './incremental-indexer.js';

export type {
  RepoIndexResult,
  MultiRepoIndexResult,
  MultiRepoProgressCallback,
  MultiRepoIndexOptions,
  RepoProcessor,
} from './multi-repo-indexer.js';
export { MultiRepoIndexer, MultiRepoIndexerError } from './multi-repo-indexer.js';

export type { FileWatcherConfig, FileWatcherEvents } from './file-watcher.js';
export { FileWatcher } from './file-watcher.js';
