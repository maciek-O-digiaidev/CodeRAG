import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFile, readFile, mkdir, appendFile, unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  loadConfig,
  createIgnoreFilter,
  FileScanner,
  TreeSitterParser,
  ASTChunker,
  OllamaClient,
  NLEnricher,
  OllamaEmbeddingProvider,
  LanceDBStore,
  BM25Index,
  GraphBuilder,
  DependencyGraph,
  scanForABReferences,
  IndexState,
  MultiRepoIndexer,
  AzureDevOpsProvider,
  JiraProvider,
  ClickUpProvider,
  type BacklogProvider,
  type BacklogItem,
  type Chunk,
  type ChunkMetadata,
  type GraphNode,
  type ParsedFile,
  type CodeRAGConfig,
  type BacklogConfig,
} from '@coderag/core';

// ---------------------------------------------------------------------------
// IndexLogger — dual output: ora spinner (interactive) + file log
// ---------------------------------------------------------------------------

class IndexLogger {
  private spinner: ReturnType<typeof ora>;
  private logPath: string;
  private progressPath: string;
  private phase = 'init';
  private counts: Record<string, number> = {};

  constructor(storagePath: string) {
    this.spinner = ora();
    this.logPath = join(storagePath, 'index.log');
    this.progressPath = join(storagePath, 'index-progress.json');
  }

  async init(): Promise<void> {
    const dir = resolve(this.logPath, '..');
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await this.log('='.repeat(60));
    await this.log(`Indexing started at ${new Date().toISOString()}`);
    await this.log('='.repeat(60));
  }

  start(text: string): void {
    this.spinner.start(text);
    void this.log(text);
  }

  async info(text: string): Promise<void> {
    this.spinner.text = text;
    await this.log(text);
  }

  async succeed(text: string): Promise<void> {
    this.spinner.succeed(text);
    await this.log(`[OK] ${text}`);
  }

  async warn(text: string): Promise<void> {
    this.spinner.warn(text);
    await this.log(`[WARN] ${text}`);
  }

  async fail(text: string): Promise<void> {
    this.spinner.fail(text);
    await this.log(`[FAIL] ${text}`);
  }

  async setPhase(phase: string, counts?: Record<string, number>): Promise<void> {
    this.phase = phase;
    if (counts) this.counts = { ...this.counts, ...counts };
    await this.writeProgress();
  }

  async updateCount(key: string, value: number): Promise<void> {
    this.counts[key] = value;
    await this.writeProgress();
  }

  private async log(message: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;
    try {
      await appendFile(this.logPath, line, 'utf-8');
    } catch {
      // Ignore log write failures
    }
  }

  private async writeProgress(): Promise<void> {
    const progress = {
      phase: this.phase,
      updatedAt: new Date().toISOString(),
      ...this.counts,
    };
    try {
      await writeFile(this.progressPath, JSON.stringify(progress, null, 2), 'utf-8');
    } catch {
      // Ignore progress write failures
    }
  }
}

// ---------------------------------------------------------------------------
// Enrichment with checkpointing
// ---------------------------------------------------------------------------

interface EnrichmentCheckpoint {
  /** Map of chunkId → nlSummary for already-enriched chunks */
  summaries: Record<string, string>;
  totalProcessed: number;
}

async function loadEnrichmentCheckpoint(storagePath: string): Promise<EnrichmentCheckpoint | null> {
  const checkpointPath = join(storagePath, 'enrichment-checkpoint.json');
  try {
    const data = await readFile(checkpointPath, 'utf-8');
    return JSON.parse(data) as EnrichmentCheckpoint;
  } catch {
    return null;
  }
}

async function saveEnrichmentCheckpoint(
  storagePath: string,
  checkpoint: EnrichmentCheckpoint,
): Promise<void> {
  const checkpointPath = join(storagePath, 'enrichment-checkpoint.json');
  await writeFile(checkpointPath, JSON.stringify(checkpoint), 'utf-8');
}

async function clearEnrichmentCheckpoint(storagePath: string): Promise<void> {
  const checkpointPath = join(storagePath, 'enrichment-checkpoint.json');
  try {
    await unlink(checkpointPath);
  } catch {
    // Ignore if file doesn't exist
  }
}

const ENRICHMENT_BATCH_SIZE = 100;

/**
 * Index a single repo directory using the full pipeline:
 * scan, parse, chunk, enrich, embed, store.
 *
 * Shared between single-repo and multi-repo paths.
 */
async function indexSingleRepo(
  rootDir: string,
  storagePath: string,
  config: CodeRAGConfig,
  options: { full?: boolean },
  logger: IndexLogger,
  repoLabel?: string,
): Promise<{ filesProcessed: number; chunksCreated: number; parseErrors: number; parseErrorDetails: Array<{ file: string; reason: string }> }> {
  const prefix = repoLabel ? `[${repoLabel}] ` : '';

  // Load or create index state
  let indexState = new IndexState();
  const indexStatePath = join(storagePath, 'index-state.json');
  if (!options.full) {
    try {
      const stateData = await readFile(indexStatePath, 'utf-8');
      indexState = IndexState.fromJSON(JSON.parse(stateData) as Parameters<typeof IndexState.fromJSON>[0]);
    } catch {
      // No saved state, start fresh
    }
  }

  // Scan files
  await logger.setPhase('scan');
  await logger.info(`${prefix}Scanning files...`);
  const ignoreFilter = createIgnoreFilter(rootDir);
  const scanner = new FileScanner(rootDir, ignoreFilter);
  const scanResult = await scanner.scanFiles();
  if (scanResult.isErr()) {
    throw new Error(`Scan failed: ${scanResult.error.message}`);
  }
  const scannedFiles = scanResult.value;
  await logger.info(`${prefix}Scanned ${scannedFiles.length} files`);

  // Filter to changed files (incremental)
  let filesToProcess = scannedFiles;
  if (!options.full) {
    filesToProcess = scannedFiles.filter(
      (f) => indexState.isDirty(f.filePath, f.contentHash),
    );
    if (filesToProcess.length === 0) {
      return { filesProcessed: 0, chunksCreated: 0, parseErrors: 0, parseErrorDetails: [] };
    }
    await logger.info(`${prefix}${filesToProcess.length} file(s) changed, processing...`);
  }

  // Initialize parser
  await logger.setPhase('parse');
  await logger.info(`${prefix}Initializing parser...`);
  const parser = new TreeSitterParser();
  const initResult = await parser.initialize();
  if (initResult.isErr()) {
    throw new Error(`Parser init failed: ${initResult.error.message}`);
  }

  // Parse and chunk
  await logger.info(`${prefix}Parsing ${filesToProcess.length} files...`);
  const chunker = new ASTChunker({ maxTokensPerChunk: config.ingestion.maxTokensPerChunk });
  const allChunks: Chunk[] = [];
  const allParsedFiles: ParsedFile[] = [];
  let parseErrors = 0;
  const parseErrorDetails: Array<{ file: string; reason: string }> = [];

  for (const file of filesToProcess) {
    const parseResult = await parser.parse(file.filePath, file.content);
    if (parseResult.isErr()) {
      parseErrors++;
      parseErrorDetails.push({ file: file.filePath, reason: parseResult.error.message });
      continue;
    }

    const parsed = parseResult.value;
    allParsedFiles.push(parsed);

    const chunkResult = await chunker.chunk(parsed);
    if (chunkResult.isErr()) {
      parseErrors++;
      parseErrorDetails.push({ file: file.filePath, reason: chunkResult.error.message });
      continue;
    }

    allChunks.push(...chunkResult.value);
  }

  await logger.info(`${prefix}Parsed ${filesToProcess.length - parseErrors} files, created ${allChunks.length} chunks`);
  await logger.updateCount('totalChunks', allChunks.length);

  // Stamp repoName in chunk metadata if multi-repo
  if (repoLabel) {
    for (const chunk of allChunks) {
      chunk.metadata.repoName = repoLabel;
    }
  }

  if (allChunks.length === 0) {
    // Still update index state for processed files (even if no chunks)
    for (const file of filesToProcess) {
      indexState.setFileState(file.filePath, {
        filePath: file.filePath,
        contentHash: file.contentHash,
        lastIndexedAt: new Date(),
        chunkIds: [],
      });
    }
    await writeFile(indexStatePath, JSON.stringify(indexState.toJSON(), null, 2), 'utf-8');

    return { filesProcessed: filesToProcess.length, chunksCreated: 0, parseErrors, parseErrorDetails };
  }

  // Enrich with NL summaries — batched with checkpointing
  await logger.setPhase('enrich', { totalChunks: allChunks.length, enrichedChunks: 0 });
  const ollamaClient = new OllamaClient({ model: config.llm.model });
  const enricher = new NLEnricher(ollamaClient);

  // Load checkpoint to resume after crash/restart
  const checkpoint = await loadEnrichmentCheckpoint(storagePath);
  const savedSummaries: Record<string, string> = checkpoint?.summaries ?? {};
  const chunksToEnrich = allChunks.filter((c) => !(c.id in savedSummaries));

  if (checkpoint && Object.keys(savedSummaries).length > 0) {
    await logger.info(
      `${prefix}Resuming enrichment: ${Object.keys(savedSummaries).length} already done, ${chunksToEnrich.length} remaining`,
    );
  } else {
    await logger.info(`${prefix}Enriching ${allChunks.length} chunks with NL summaries...`);
  }

  let enrichErrors = 0;
  const totalBatches = Math.ceil(chunksToEnrich.length / ENRICHMENT_BATCH_SIZE);

  for (let i = 0; i < chunksToEnrich.length; i += ENRICHMENT_BATCH_SIZE) {
    const batchNum = Math.floor(i / ENRICHMENT_BATCH_SIZE) + 1;
    const batch = chunksToEnrich.slice(i, i + ENRICHMENT_BATCH_SIZE);
    await logger.info(
      `${prefix}Enrichment batch ${batchNum}/${totalBatches} (${batch.length} chunks, ${Object.keys(savedSummaries).length}/${allChunks.length} total)...`,
    );

    const enrichResult = await enricher.enrichBatch(batch);
    if (enrichResult.isOk()) {
      for (const enriched of enrichResult.value) {
        if (enriched.nlSummary) {
          savedSummaries[enriched.id] = enriched.nlSummary;
        }
      }
    } else {
      enrichErrors++;
      await logger.warn(`${prefix}Batch ${batchNum} enrichment failed: ${enrichResult.error.message}`);
    }

    // Save checkpoint after every batch
    await saveEnrichmentCheckpoint(storagePath, {
      summaries: savedSummaries,
      totalProcessed: Object.keys(savedSummaries).length,
    });
    await logger.updateCount('enrichedChunks', Object.keys(savedSummaries).length);
  }

  // Apply saved summaries to all chunks
  const enrichedChunks = allChunks.map((c) => {
    const summary = savedSummaries[c.id];
    return summary ? { ...c, nlSummary: summary } : c;
  });

  if (enrichErrors > 0) {
    await logger.warn(`${prefix}${enrichErrors} enrichment batch(es) failed, some chunks have no NL summary`);
  }

  // Clear checkpoint — enrichment phase complete
  await clearEnrichmentCheckpoint(storagePath);

  // Embed chunks
  await logger.setPhase('embed');
  await logger.info(`${prefix}Embedding ${enrichedChunks.length} chunks...`);
  const embeddingProvider = new OllamaEmbeddingProvider({
    model: config.embedding.model,
    dimensions: config.embedding.dimensions,
  });

  const textsToEmbed = enrichedChunks.map(
    (c) => c.nlSummary ? `${c.nlSummary}\n\n${c.content}` : c.content,
  );
  const embedResult = await embeddingProvider.embed(textsToEmbed);
  if (embedResult.isErr()) {
    throw new Error(`Embedding failed: ${embedResult.error.message}`);
  }
  const embeddings = embedResult.value;

  // Store in LanceDB
  await logger.setPhase('store');
  await logger.info(`${prefix}Storing embeddings in LanceDB...`);
  const store = new LanceDBStore(storagePath, config.embedding.dimensions);
  await store.connect();

  const ids = enrichedChunks.map((c) => c.id);
  const metadata = enrichedChunks.map((c) => ({
    content: c.content,
    nl_summary: c.nlSummary,
    chunk_type: c.metadata.chunkType,
    file_path: c.filePath,
    language: c.language,
    start_line: c.startLine,
    end_line: c.endLine,
    name: c.metadata.name,
    ...(c.metadata.repoName ? { repo_name: c.metadata.repoName } : {}),
  }));

  const upsertResult = await store.upsert(ids, embeddings, metadata);
  if (upsertResult.isErr()) {
    store.close();
    throw new Error(`Store failed: ${upsertResult.error.message}`);
  }

  // Build BM25 index
  await logger.info(`${prefix}Building BM25 index...`);
  const bm25 = new BM25Index();
  bm25.addChunks(enrichedChunks);
  const bm25Path = join(storagePath, 'bm25-index.json');
  await writeFile(bm25Path, bm25.serialize(), 'utf-8');

  // Build dependency graph
  await logger.info(`${prefix}Building dependency graph...`);
  const graphBuilder = new GraphBuilder(rootDir);
  const graphResult = graphBuilder.buildFromFiles(allParsedFiles);
  if (graphResult.isOk()) {
    const graphPath = join(storagePath, 'graph.json');
    await writeFile(graphPath, JSON.stringify(graphResult.value.toJSON()), 'utf-8');
  }

  // Update index state
  await logger.setPhase('finalize');
  await logger.info(`${prefix}Saving index state...`);
  for (const file of filesToProcess) {
    const fileChunkIds = enrichedChunks
      .filter((c) => c.filePath === file.filePath)
      .map((c) => c.id);

    indexState.setFileState(file.filePath, {
      filePath: file.filePath,
      contentHash: file.contentHash,
      lastIndexedAt: new Date(),
      chunkIds: fileChunkIds,
    });
  }
  await writeFile(indexStatePath, JSON.stringify(indexState.toJSON(), null, 2), 'utf-8');

  store.close();

  return { filesProcessed: filesToProcess.length, chunksCreated: enrichedChunks.length, parseErrors, parseErrorDetails };
}

// ---------------------------------------------------------------------------
// Backlog indexing
// ---------------------------------------------------------------------------

function createBacklogProvider(backlogConfig: BacklogConfig): BacklogProvider | null {
  switch (backlogConfig.provider) {
    case 'ado':
    case 'azure-devops':
      return new AzureDevOpsProvider();
    case 'jira':
      return new JiraProvider();
    case 'clickup':
      return new ClickUpProvider();
    default:
      return null;
  }
}

function backlogItemToChunk(item: BacklogItem): Chunk {
  const lines: string[] = [];
  lines.push(`# ${item.externalId}: ${item.title}`);
  lines.push('');
  lines.push(`**Type:** ${item.type} | **State:** ${item.state}`);
  if (item.assignedTo) lines.push(`**Assigned to:** ${item.assignedTo}`);
  if (item.tags.length > 0) lines.push(`**Tags:** ${item.tags.join(', ')}`);
  if (item.url) lines.push(`**URL:** ${item.url}`);
  lines.push('');

  if (item.description) {
    // Strip HTML tags for cleaner embedding
    const plainDesc = item.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (plainDesc) {
      lines.push('## Description');
      lines.push(plainDesc);
      lines.push('');
    }
  }

  if (item.linkedCodePaths.length > 0) {
    lines.push('## Linked Code');
    for (const path of item.linkedCodePaths) {
      lines.push(`- ${path}`);
    }
  }

  const content = lines.join('\n');

  const metadata: ChunkMetadata = {
    chunkType: 'doc',
    name: `${item.externalId}: ${item.title}`,
    declarations: [],
    imports: [],
    exports: [],
    tags: item.tags,
    docTitle: item.title,
  };

  return {
    id: `backlog:${item.externalId}`,
    content,
    nlSummary: `${item.type} work item "${item.title}" (${item.state})${item.assignedTo ? ` assigned to ${item.assignedTo}` : ''}`,
    filePath: `backlog/${item.externalId}`,
    startLine: 1,
    endLine: content.split('\n').length,
    language: 'markdown',
    metadata,
  };
}

function hashBacklogItem(item: BacklogItem): string {
  const data = JSON.stringify({
    title: item.title,
    description: item.description,
    state: item.state,
    type: item.type,
    assignedTo: item.assignedTo,
    tags: item.tags,
    linkedCodePaths: item.linkedCodePaths,
  });
  return createHash('sha256').update(data).digest('hex');
}

interface BacklogIndexResult {
  itemsFetched: number;
  itemsIndexed: number;
  skipped: number;
  error?: string;
}

async function indexBacklog(
  backlogConfig: BacklogConfig,
  storagePath: string,
  config: CodeRAGConfig,
  options: { full?: boolean },
  logger: IndexLogger,
): Promise<BacklogIndexResult> {
  // Create provider
  const provider = createBacklogProvider(backlogConfig);
  if (!provider) {
    return { itemsFetched: 0, itemsIndexed: 0, skipped: 0, error: `Unknown backlog provider: ${backlogConfig.provider}` };
  }

  // Initialize provider
  await logger.info('Backlog: connecting to provider...');
  const initResult = await provider.initialize(backlogConfig.config ?? {});
  if (initResult.isErr()) {
    return { itemsFetched: 0, itemsIndexed: 0, skipped: 0, error: `Backlog init failed: ${initResult.error.message}` };
  }

  // Fetch all items
  await logger.info('Backlog: fetching work items...');
  const itemsResult = await provider.getItems({ limit: 500 });
  if (itemsResult.isErr()) {
    return { itemsFetched: 0, itemsIndexed: 0, skipped: 0, error: `Backlog fetch failed: ${itemsResult.error.message}` };
  }

  const items = itemsResult.value;
  if (items.length === 0) {
    return { itemsFetched: 0, itemsIndexed: 0, skipped: 0 };
  }

  // Load backlog index state for incremental indexing
  const backlogStatePath = join(storagePath, 'backlog-state.json');
  let backlogState: Record<string, string> = {};
  if (!options.full) {
    try {
      const stateData = await readFile(backlogStatePath, 'utf-8');
      backlogState = JSON.parse(stateData) as Record<string, string>;
    } catch {
      // No saved state, index all
    }
  }

  // Filter to changed items (incremental)
  const changedItems: BacklogItem[] = [];
  let skipped = 0;
  for (const item of items) {
    const currentHash = hashBacklogItem(item);
    if (!options.full && backlogState[item.externalId] === currentHash) {
      skipped++;
      continue;
    }
    backlogState[item.externalId] = currentHash;
    changedItems.push(item);
  }

  if (changedItems.length === 0) {
    return { itemsFetched: items.length, itemsIndexed: 0, skipped };
  }

  await logger.info(`Backlog: converting ${changedItems.length} items to chunks...`);
  const chunks = changedItems.map(backlogItemToChunk);

  // Embed chunks
  await logger.info(`Backlog: embedding ${chunks.length} items...`);
  const embeddingProvider = new OllamaEmbeddingProvider({
    model: config.embedding.model,
    dimensions: config.embedding.dimensions,
  });

  const textsToEmbed = chunks.map(
    (c) => c.nlSummary ? `${c.nlSummary}\n\n${c.content}` : c.content,
  );
  const embedResult = await embeddingProvider.embed(textsToEmbed);
  if (embedResult.isErr()) {
    return { itemsFetched: items.length, itemsIndexed: 0, skipped, error: `Backlog embedding failed: ${embedResult.error.message}` };
  }
  const embeddings = embedResult.value;

  // Store in LanceDB
  await logger.info(`Backlog: storing ${chunks.length} items in vector database...`);
  const store = new LanceDBStore(storagePath, config.embedding.dimensions);
  await store.connect();

  const ids = chunks.map((c) => c.id);
  const metadata = chunks.map((c) => ({
    content: c.content,
    nl_summary: c.nlSummary,
    chunk_type: c.metadata.chunkType,
    file_path: c.filePath,
    language: c.language,
    start_line: c.startLine,
    end_line: c.endLine,
    name: c.metadata.name,
  }));

  const upsertResult = await store.upsert(ids, embeddings, metadata);
  store.close();

  if (upsertResult.isErr()) {
    return { itemsFetched: items.length, itemsIndexed: 0, skipped, error: `Backlog store failed: ${upsertResult.error.message}` };
  }

  // Add to BM25 index (append to existing)
  await logger.info('Backlog: updating BM25 index...');
  const bm25Path = join(storagePath, 'bm25-index.json');
  let bm25: BM25Index;
  try {
    const existingBm25 = await readFile(bm25Path, 'utf-8');
    bm25 = BM25Index.deserialize(existingBm25);
  } catch {
    bm25 = new BM25Index();
  }
  bm25.addChunks(chunks);
  await writeFile(bm25Path, bm25.serialize(), 'utf-8');

  // Save backlog state
  await writeFile(backlogStatePath, JSON.stringify(backlogState, null, 2), 'utf-8');

  // Link backlog items into the dependency graph
  await logger.info('Backlog: linking items to dependency graph...');
  await linkBacklogToGraph(items, storagePath, bm25Path, logger);

  return { itemsFetched: items.length, itemsIndexed: changedItems.length, skipped };
}

/**
 * Augment the dependency graph with backlog nodes and edges.
 *
 * Two linking directions:
 *  1. Backlog → Code: each item's linkedCodePaths creates a 'references' edge
 *  2. Code → Backlog: scan code chunks for AB#XXXX references, create reverse edges
 */
async function linkBacklogToGraph(
  items: BacklogItem[],
  storagePath: string,
  bm25Path: string,
  logger: IndexLogger,
): Promise<void> {
  // Load existing graph
  const graphPath = join(storagePath, 'graph.json');
  let graph: DependencyGraph;
  try {
    const graphData = await readFile(graphPath, 'utf-8');
    graph = DependencyGraph.fromJSON(JSON.parse(graphData) as { nodes: GraphNode[]; edges: { source: string; target: string; type: 'imports' | 'extends' | 'implements' | 'calls' | 'references' }[] });
  } catch {
    await logger.warn('Backlog: no graph.json found, skipping graph linking');
    return;
  }

  const existingNodeIds = new Set(graph.getAllNodes().map((n) => n.id));
  let edgesAdded = 0;

  // 1. Add backlog items as nodes + edges from linkedCodePaths
  for (const item of items) {
    const nodeId = `backlog:${item.externalId}`;

    if (!existingNodeIds.has(nodeId)) {
      graph.addNode({
        id: nodeId,
        filePath: `backlog/${item.externalId}`,
        symbols: [item.title],
        type: 'backlog',
      });
      existingNodeIds.add(nodeId);
    }

    // Edges: backlog item → linked code files
    for (const codePath of item.linkedCodePaths) {
      const normalizedPath = codePath.replace(/\\/g, '/');
      if (existingNodeIds.has(normalizedPath)) {
        graph.addEdge({ source: nodeId, target: normalizedPath, type: 'references' });
        edgesAdded++;
      }
    }
  }

  // 2. Scan code chunks for AB# references → create code → backlog edges
  //    Search BM25 for "AB" to find chunks likely containing AB#XXXX references
  const backlogIdSet = new Set(items.map((i) => i.externalId));
  try {
    const bm25Data = await readFile(bm25Path, 'utf-8');
    const bm25 = BM25Index.deserialize(bm25Data);
    const candidateResults = bm25.search('AB', 500);

    for (const result of candidateResults) {
      if (result.chunkId.startsWith('backlog:') || !result.chunk) continue;
      const refs = scanForABReferences(result.content);
      for (const refId of refs) {
        const externalId = `AB#${refId}`;
        const backlogNodeId = `backlog:${externalId}`;
        if (backlogIdSet.has(externalId) && existingNodeIds.has(backlogNodeId)) {
          const codeNodeId = result.chunk.filePath.replace(/\\/g, '/');
          if (existingNodeIds.has(codeNodeId)) {
            graph.addEdge({ source: codeNodeId, target: backlogNodeId, type: 'references' });
            edgesAdded++;
          }
        }
      }
    }
  } catch {
    // BM25 not available yet — skip code→backlog linking
  }

  // Save augmented graph
  await writeFile(graphPath, JSON.stringify(graph.toJSON()), 'utf-8');
  await logger.info(`Backlog: added ${items.length} backlog nodes, ${edgesAdded} reference edges to graph`);
}

export function registerIndexCommand(program: Command): void {
  program
    .command('index')
    .description('Index the codebase: scan, parse, chunk, enrich, embed, and store')
    .option('--full', 'Force a complete re-index (ignore incremental state)')
    .action(async (options: { full?: boolean }) => {
      const startTime = Date.now();
      // Use a temporary spinner for config loading (logger needs storagePath from config)
      const bootSpinner = ora('Loading configuration...').start();

      try {
        const rootDir = process.cwd();

        // Step 1: Load config
        const configResult = await loadConfig(rootDir);
        if (configResult.isErr()) {
          bootSpinner.fail(configResult.error.message);
          // eslint-disable-next-line no-console
          console.error(chalk.red('Run "coderag init" first to create a configuration file.'));
          process.exit(1);
        }
        const config = configResult.value;
        const storagePath = resolve(rootDir, config.storage.path);

        // Prevent path traversal outside project root
        if (!storagePath.startsWith(resolve(rootDir) + sep) && storagePath !== resolve(rootDir)) {
          bootSpinner.fail('Storage path escapes project root');
          process.exit(1);
        }

        bootSpinner.succeed('Configuration loaded');

        // Create IndexLogger — writes to .coderag/index.log + progress JSON
        const logger = new IndexLogger(storagePath);
        await logger.init();

        // Multi-repo path: if repos are configured, index each independently
        if (config.repos && config.repos.length > 0) {
          await indexMultiRepo(config, storagePath, options, logger, startTime);
          return;
        }

        // Single-repo path
        logger.start('Starting indexing...');
        const result = await indexSingleRepo(rootDir, storagePath, config, options, logger);

        if (result.filesProcessed === 0 && result.chunksCreated === 0 && result.parseErrors === 0) {
          await logger.succeed('No changes detected, index is up to date.');
          return;
        }

        if (result.chunksCreated === 0 && result.parseErrors > 0) {
          await logger.warn('No chunks produced. Nothing to index.');
          // eslint-disable-next-line no-console
          console.log(chalk.yellow(`  ${result.parseErrors} file(s) failed to parse:`));
          for (const detail of result.parseErrorDetails.slice(0, 5)) {
            // eslint-disable-next-line no-console
            console.log(`    ${chalk.gray('→')} ${detail.file}: ${chalk.yellow(detail.reason)}`);
          }
          if (result.parseErrorDetails.length > 5) {
            // eslint-disable-next-line no-console
            console.log(`    ${chalk.gray(`… and ${result.parseErrorDetails.length - 5} more`)}`);
          }
          return;
        }

        // Backlog indexing (if configured)
        let backlogResult: BacklogIndexResult | null = null;
        if (config.backlog) {
          try {
            backlogResult = await indexBacklog(config.backlog, storagePath, config, options, logger);
          } catch (backlogError: unknown) {
            const msg = backlogError instanceof Error ? backlogError.message : String(backlogError);
            backlogResult = { itemsFetched: 0, itemsIndexed: 0, skipped: 0, error: msg };
          }
        }

        // Summary
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        await logger.succeed('Indexing complete!');

        // eslint-disable-next-line no-console
        console.log('');
        // eslint-disable-next-line no-console
        console.log(chalk.bold('Summary:'));
        // eslint-disable-next-line no-console
        console.log(`  Files processed: ${chalk.cyan(String(result.filesProcessed))}`);
        // eslint-disable-next-line no-console
        console.log(`  Chunks created:  ${chalk.cyan(String(result.chunksCreated))}`);
        if (result.parseErrors > 0) {
          // eslint-disable-next-line no-console
          console.log(`  Parse errors:    ${chalk.yellow(String(result.parseErrors))}`);
          for (const detail of result.parseErrorDetails.slice(0, 10)) {
            // eslint-disable-next-line no-console
            console.log(`    ${chalk.gray('→')} ${detail.file}: ${chalk.yellow(detail.reason)}`);
          }
          if (result.parseErrorDetails.length > 10) {
            // eslint-disable-next-line no-console
            console.log(`    ${chalk.gray(`… and ${result.parseErrorDetails.length - 10} more`)}`);
          }
        }
        if (backlogResult) {
          if (backlogResult.error) {
            // eslint-disable-next-line no-console
            console.log(`  Backlog:         ${chalk.yellow(backlogResult.error)}`);
          } else if (backlogResult.itemsIndexed > 0) {
            // eslint-disable-next-line no-console
            console.log(`  Backlog indexed: ${chalk.cyan(String(backlogResult.itemsIndexed))} items (${backlogResult.skipped} unchanged)`);
          } else if (backlogResult.itemsFetched > 0) {
            // eslint-disable-next-line no-console
            console.log(`  Backlog:         ${chalk.green('up to date')} (${backlogResult.itemsFetched} items)`);
          }
        }
        // eslint-disable-next-line no-console
        console.log(`  Time elapsed:    ${chalk.cyan(elapsed + 's')}`);
        // eslint-disable-next-line no-console
        console.log(`  Log file:        ${chalk.gray(join(storagePath, 'index.log'))}`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        // eslint-disable-next-line no-console
        console.error(chalk.red('\nIndexing failed:'), message);
        process.exit(1);
      }
    });
}

/**
 * Multi-repo indexing: iterate configured repos, index each with separate
 * progress reporting and per-repo storage directories.
 */
async function indexMultiRepo(
  config: CodeRAGConfig,
  storagePath: string,
  options: { full?: boolean },
  logger: IndexLogger,
  startTime: number,
): Promise<void> {
  const repos = config.repos!;

  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(chalk.bold(`Indexing ${repos.length} repo(s)...`));
  // eslint-disable-next-line no-console
  console.log('');

  const multiRepoIndexer = new MultiRepoIndexer(repos, storagePath);

  let totalFiles = 0;
  let totalChunks = 0;
  let totalErrors = 0;

  logger.start('Starting multi-repo indexing...');
  const result = await multiRepoIndexer.indexAll({
    full: options.full,
    onProgress: (repoName, status) => {
      void logger.info(`[${repoName}] ${status}`);
    },
  });

  if (result.isErr()) {
    await logger.fail(`Multi-repo indexing failed: ${result.error.message}`);
    process.exit(1);
  }

  // Per-repo summary
  for (const repoResult of result.value.repoResults) {
    totalFiles += repoResult.filesProcessed;
    totalChunks += repoResult.chunksCreated;

    if (repoResult.errors.length > 0) {
      totalErrors += repoResult.errors.length;
      await logger.fail(`[${repoResult.repoName}] Failed`);
      for (const error of repoResult.errors) {
        // eslint-disable-next-line no-console
        console.log(`    ${chalk.gray('→')} ${chalk.red(error)}`);
      }
    } else if (repoResult.filesProcessed === 0) {
      await logger.succeed(`[${repoResult.repoName}] Up to date`);
    } else {
      await logger.succeed(
        `[${repoResult.repoName}] ${repoResult.filesProcessed} file(s) processed`,
      );
    }
  }

  // Total summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(chalk.bold('Total Summary:'));
  // eslint-disable-next-line no-console
  console.log(`  Repos indexed:   ${chalk.cyan(String(repos.length))}`);
  // eslint-disable-next-line no-console
  console.log(`  Files processed: ${chalk.cyan(String(totalFiles))}`);
  // eslint-disable-next-line no-console
  console.log(`  Chunks created:  ${chalk.cyan(String(totalChunks))}`);
  if (totalErrors > 0) {
    // eslint-disable-next-line no-console
    console.log(`  Errors:          ${chalk.yellow(String(totalErrors))}`);
  }
  // eslint-disable-next-line no-console
  console.log(`  Time elapsed:    ${chalk.cyan(elapsed + 's')}`);
  // eslint-disable-next-line no-console
  console.log(`  Log file:        ${chalk.gray(join(storagePath, 'index.log'))}`);
}
