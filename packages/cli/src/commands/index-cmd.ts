import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFile, readFile, mkdir, appendFile, unlink } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  loadConfig,
  createIgnoreFilter,
  FileScanner,
  TreeSitterParser,
  MarkdownParser,
  ASTChunker,
  OllamaClient,
  NLEnricher,
  OllamaEmbeddingProvider,
  OpenAICompatibleEmbeddingProvider,
  ModelLifecycleManager,
  LanceDBStore,
  BM25Index,
  GraphBuilder,
  DependencyGraph,
  scanForABReferences,
  IndexState,
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
  type EmbeddingConfig,
  type EmbeddingProvider,
  type BacklogConfig,
} from '@code-rag/core';

// ---------------------------------------------------------------------------
// Simple embedding provider factory — dispatches based on provider name
// (Used for non-lifecycle providers like openai-compatible and direct ollama)
// ---------------------------------------------------------------------------

export function createSimpleEmbeddingProvider(embeddingConfig: EmbeddingConfig): EmbeddingProvider {
  const provider = embeddingConfig.provider;

  switch (provider) {
    case 'openai-compatible': {
      const compat = embeddingConfig.openaiCompatible;
      return new OpenAICompatibleEmbeddingProvider({
        baseUrl: compat?.baseUrl ?? 'http://localhost:1234/v1',
        apiKey: compat?.apiKey,
        model: embeddingConfig.model,
        dimensions: embeddingConfig.dimensions,
        maxBatchSize: compat?.maxBatchSize ?? 100,
      });
    }
    case 'ollama':
    default:
      return new OllamaEmbeddingProvider({
        model: embeddingConfig.model,
        dimensions: embeddingConfig.dimensions,
      });
  }
}

// ---------------------------------------------------------------------------
// IndexLogger — dual output: ora spinner (interactive) + file log
// ---------------------------------------------------------------------------

export class IndexLogger {
  private spinner: ReturnType<typeof ora>;
  private logPath: string;
  private progressPath: string;
  private phase = 'init';
  private counts: Record<string, number> = {};
  private readonly quiet: boolean;

  constructor(storagePath: string, quiet = false) {
    this.spinner = ora();
    this.logPath = join(storagePath, 'index.log');
    this.progressPath = join(storagePath, 'index-progress.json');
    this.quiet = quiet;
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
    if (!this.quiet) this.spinner.start(text);
    void this.log(text);
  }

  async info(text: string): Promise<void> {
    if (!this.quiet) this.spinner.text = text;
    await this.log(text);
  }

  async succeed(text: string): Promise<void> {
    if (!this.quiet) this.spinner.succeed(text);
    await this.log(`[OK] ${text}`);
  }

  async warn(text: string): Promise<void> {
    if (!this.quiet) this.spinner.warn(text);
    await this.log(`[WARN] ${text}`);
  }

  async fail(text: string): Promise<void> {
    if (!this.quiet) this.spinner.fail(text);
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

// ---------------------------------------------------------------------------
// Embedding provider factory with auto-start lifecycle
// ---------------------------------------------------------------------------

interface ManagedEmbeddingProvider {
  provider: EmbeddingProvider;
  lifecycleManager: ModelLifecycleManager | null;
}

async function createManagedEmbeddingProvider(
  config: CodeRAGConfig,
  logger: IndexLogger,
): Promise<ManagedEmbeddingProvider> {
  const embeddingConfig = config.embedding;
  const providerName = embeddingConfig.provider;

  if (providerName === 'openai-compatible') {
    // OpenAI-compatible provider — no lifecycle management needed
    return {
      provider: createSimpleEmbeddingProvider(embeddingConfig),
      lifecycleManager: null,
    };
  }

  if (providerName === 'ollama') {
    // Direct Ollama — no lifecycle management
    return {
      provider: new OllamaEmbeddingProvider({
        model: embeddingConfig.model,
        dimensions: embeddingConfig.dimensions,
      }),
      lifecycleManager: null,
    };
  }

  if (providerName === 'auto') {
    // Auto provider: detect/start backend, pull model, then create Ollama provider
    const manager = new ModelLifecycleManager({
      model: embeddingConfig.model,
      autoStart: embeddingConfig.autoStart,
      autoStop: embeddingConfig.autoStop,
      docker: embeddingConfig.docker,
    });

    await logger.info('Auto-detecting embedding backend...');

    const backendResult = await manager.ensureRunning();
    if (backendResult.isErr()) {
      await logger.fail(backendResult.error.message);
      throw backendResult.error;
    }
    const backend = backendResult.value;
    await logger.info(`Embedding backend: ${backend.type}${backend.managedByUs ? ' (auto-started)' : ' (already running)'}`);

    // Ensure model is available
    await logger.info(`Checking model "${embeddingConfig.model}"...`);
    const modelResult = await manager.ensureModel(embeddingConfig.model, (status, completed, total) => {
      if (total > 0) {
        const pct = Math.round((completed / total) * 100);
        void logger.info(`Pulling model: ${status} ${pct}%`);
      } else {
        void logger.info(`Pulling model: ${status}`);
      }
    });
    if (modelResult.isErr()) {
      await logger.fail(modelResult.error.message);
      throw modelResult.error;
    }
    await logger.info(`Model "${embeddingConfig.model}" is ready`);

    return {
      provider: new OllamaEmbeddingProvider({
        baseUrl: backend.baseUrl,
        model: embeddingConfig.model,
        dimensions: embeddingConfig.dimensions,
      }),
      lifecycleManager: manager,
    };
  }

  // Fallback: treat as direct Ollama (backward compat)
  return {
    provider: new OllamaEmbeddingProvider({
      model: embeddingConfig.model,
      dimensions: embeddingConfig.dimensions,
    }),
    lifecycleManager: null,
  };
}

/**
 * Rebuild BM25 index from all documents in LanceDB.
 * Used as a fallback when incremental update fails (e.g., corrupted index).
 */
async function rebuildBm25FromStore(
  store: LanceDBStore,
  logger: IndexLogger,
  prefix: string,
): Promise<BM25Index> {
  const bm25 = new BM25Index();
  try {
    const internal = store as unknown as {
      table: { query: () => { toArray: () => Promise<Array<{
        id: string; content: string; nl_summary: string;
        file_path: string; chunk_type: string; language: string;
        metadata: string;
      }>> } } | null;
    };
    const table = internal.table;
    if (table) {
      const allRows = await table.query().toArray();
      const chunks: Chunk[] = allRows.map((row) => {
        let parsedMeta: Record<string, unknown> = {};
        try { parsedMeta = JSON.parse(row.metadata) as Record<string, unknown>; } catch { /* ignore */ }
        return {
          id: row.id,
          content: row.content,
          nlSummary: row.nl_summary,
          filePath: row.file_path,
          startLine: 0,
          endLine: 0,
          language: row.language,
          metadata: {
            chunkType: (row.chunk_type ?? 'function') as ChunkMetadata['chunkType'],
            name: (parsedMeta['name'] as string) ?? '',
            declarations: [],
            imports: [],
            exports: [],
          },
        };
      });
      bm25.addChunks(chunks);
      await logger.info(`${prefix}Rebuilt BM25 from LanceDB: ${chunks.length} documents`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await logger.warn(`${prefix}BM25 rebuild from LanceDB failed: ${msg}`);
  }
  return bm25;
}

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
  embeddingProvider?: EmbeddingProvider,
): Promise<{ filesProcessed: number; chunksCreated: number; parseErrors: number; skippedFiles: number; parseErrorDetails: Array<{ file: string; reason: string }> }> {
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
      return { filesProcessed: 0, chunksCreated: 0, parseErrors: 0, skippedFiles: 0, parseErrorDetails: [] };
    }
    await logger.info(`${prefix}${filesToProcess.length} file(s) changed, processing...`);
  }

  // Initialize parsers
  await logger.setPhase('parse');
  await logger.info(`${prefix}Initializing parser...`);
  const parser = new TreeSitterParser();
  const initResult = await parser.initialize();
  if (initResult.isErr()) {
    throw new Error(`Parser init failed: ${initResult.error.message}`);
  }
  const mdParser = new MarkdownParser({ maxTokensPerChunk: config.ingestion.maxTokensPerChunk });

  // Parse and chunk
  await logger.info(`${prefix}Parsing ${filesToProcess.length} files...`);
  const chunker = new ASTChunker({ maxTokensPerChunk: config.ingestion.maxTokensPerChunk });
  const allChunks: Chunk[] = [];
  const allParsedFiles: ParsedFile[] = [];
  let parseErrors = 0;
  let skippedFiles = 0;
  const parseErrorDetails: Array<{ file: string; reason: string }> = [];

  for (const file of filesToProcess) {
    // Route .md/.mdx files to MarkdownParser (produces chunks directly)
    if (MarkdownParser.isMarkdownFile(file.filePath)) {
      const mdResult = mdParser.parse(file.filePath, file.content);
      if (mdResult.isErr()) {
        parseErrors++;
        parseErrorDetails.push({ file: file.filePath, reason: mdResult.error.message });
        continue;
      }
      allChunks.push(...mdResult.value.chunks);
      continue;
    }

    const parseResult = await parser.parse(file.filePath, file.content);
    if (parseResult.isErr()) {
      // Distinguish true parse errors from unsupported file types
      if (parseResult.error.message.startsWith('Unsupported file type:')) {
        skippedFiles++;
        continue;
      }
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

  const parsedCount = filesToProcess.length - parseErrors - skippedFiles;
  await logger.info(`${prefix}Parsed ${parsedCount} files, created ${allChunks.length} chunks${skippedFiles > 0 ? ` (${skippedFiles} unsupported skipped)` : ''}`);
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

    return { filesProcessed: filesToProcess.length, chunksCreated: 0, parseErrors, skippedFiles, parseErrorDetails };
  }

  // Enrich with NL summaries — batched with checkpointing
  await logger.setPhase('enrich', { totalChunks: allChunks.length, enrichedChunks: 0 });
  const ollamaClient = new OllamaClient({ model: config.llm.model });
  const enricher = new NLEnricher(ollamaClient);

  // Load checkpoint to resume after crash/restart
  const checkpoint = await loadEnrichmentCheckpoint(storagePath);
  const savedSummaries: Record<string, string> = checkpoint?.summaries ?? {};
  await logger.info(`${prefix}Checkpoint: ${checkpoint ? `loaded (${Object.keys(savedSummaries).length} summaries)` : 'none found'}`);

  const chunksToEnrich = allChunks.filter((c) => !(c.id in savedSummaries));

  if (Object.keys(savedSummaries).length > 0) {
    await logger.info(
      `${prefix}Resuming enrichment: ${Object.keys(savedSummaries).length} already done, ${chunksToEnrich.length} remaining`,
    );
  } else {
    await logger.info(`${prefix}Enriching ${allChunks.length} chunks with NL summaries...`);
  }

  // Pre-flight: verify Ollama is reachable before starting enrichment
  const ollamaAvailable = await ollamaClient.isAvailable();
  if (!ollamaAvailable) {
    await logger.fail(`${prefix}Ollama is not reachable at ${ollamaClient.currentConfig.baseUrl}. Start Ollama first, then re-run.`);
    throw new Error(`Ollama is not reachable at ${ollamaClient.currentConfig.baseUrl}`);
  }

  let enrichErrors = 0;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;
  const totalBatches = Math.ceil(chunksToEnrich.length / ENRICHMENT_BATCH_SIZE);

  for (let i = 0; i < chunksToEnrich.length; i += ENRICHMENT_BATCH_SIZE) {
    const batchNum = Math.floor(i / ENRICHMENT_BATCH_SIZE) + 1;
    const batch = chunksToEnrich.slice(i, i + ENRICHMENT_BATCH_SIZE);
    await logger.info(
      `${prefix}Enrichment batch ${batchNum}/${totalBatches} (${batch.length} chunks, ${Object.keys(savedSummaries).length}/${allChunks.length} total)...`,
    );

    const enrichResult = await enricher.enrichBatch(batch);
    if (enrichResult.isOk()) {
      const { enriched, failedCount } = enrichResult.value;
      for (const chunk of enriched) {
        if (chunk.nlSummary) {
          savedSummaries[chunk.id] = chunk.nlSummary;
        }
      }

      if (failedCount === 0) {
        consecutiveFailures = 0;
      } else if (enriched.length > 0) {
        // Partial success — reset consecutive failures but log the partial failure
        consecutiveFailures = 0;
        enrichErrors++;
        await logger.warn(`${prefix}Batch ${batchNum}: ${enriched.length} OK, ${failedCount} failed`);
      } else {
        // Complete batch failure — all chunks failed
        consecutiveFailures++;
        enrichErrors++;
        await logger.warn(`${prefix}Batch ${batchNum}: all ${failedCount} chunks failed`);

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          await logger.fail(
            `${prefix}Enrichment aborted: ${MAX_CONSECUTIVE_FAILURES} consecutive batch failures. ` +
            `Is Ollama running? Check: curl ${ollamaClient.currentConfig.baseUrl}/api/tags`,
          );
          await saveEnrichmentCheckpoint(storagePath, {
            summaries: savedSummaries,
            totalProcessed: Object.keys(savedSummaries).length,
          });
          throw new Error(`Enrichment aborted after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`);
        }
      }
    } else {
      // Should not happen with new enrichBatch, but handle gracefully
      enrichErrors++;
      consecutiveFailures++;
      await logger.warn(`${prefix}Batch ${batchNum} enrichment error: ${enrichResult.error.message}`);
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
  const resolvedEmbeddingProvider = embeddingProvider ?? createSimpleEmbeddingProvider(config.embedding);

  const textsToEmbed = enrichedChunks.map(
    (c) => c.nlSummary ? `${c.nlSummary}\n\n${c.content}` : c.content,
  );
  const embedResult = await resolvedEmbeddingProvider.embed(textsToEmbed);
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

  // Build / update BM25 index
  const bm25Path = join(storagePath, 'bm25-index.json');
  let bm25: BM25Index;

  let bm25RebuiltFromStore = false;

  if (options.full) {
    // Full reindex: start fresh
    await logger.info(`${prefix}Building BM25 index from scratch...`);
    bm25 = new BM25Index();
  } else {
    // Incremental: load existing, remove stale chunks for re-indexed files
    await logger.info(`${prefix}Updating BM25 index incrementally...`);
    try {
      const existingBm25 = await readFile(bm25Path, 'utf-8');
      bm25 = BM25Index.deserialize(existingBm25);

      // Remove old chunks that belong to the files being re-indexed
      const staleChunkIds: string[] = [];
      for (const file of filesToProcess) {
        const fileState = indexState.getFileState(file.filePath);
        if (fileState) {
          staleChunkIds.push(...fileState.chunkIds);
        }
      }
      if (staleChunkIds.length > 0) {
        try {
          bm25.removeChunks(staleChunkIds);
        } catch {
          // Some IDs may not exist (e.g., after a corrupted incremental run);
          // fall back to rebuilding from scratch via LanceDB
          await logger.warn(`${prefix}BM25 stale chunk removal failed, rebuilding from LanceDB...`);
          bm25 = await rebuildBm25FromStore(store, logger, prefix);
          bm25RebuiltFromStore = true;
        }
      }
    } catch {
      // No existing BM25 index, start fresh
      bm25 = new BM25Index();
    }
  }

  // Skip addChunks when rebuilt from LanceDB — the store already contains
  // the enrichedChunks (upserted above), so the rebuilt index is complete.
  if (!bm25RebuiltFromStore) {
    bm25.addChunks(enrichedChunks);
  }
  await writeFile(bm25Path, bm25.serialize(), 'utf-8');

  // Build / update dependency graph
  await logger.info(`${prefix}Building dependency graph...`);
  const graphBuilder = new GraphBuilder(rootDir);
  const graphResult = graphBuilder.buildFromFiles(allParsedFiles);
  if (graphResult.isOk()) {
    const graphPath = join(storagePath, 'graph.json');
    const newGraph = graphResult.value;

    if (options.full) {
      // Full reindex: write the new graph directly
      await writeFile(graphPath, JSON.stringify(newGraph.toJSON()), 'utf-8');
    } else {
      // Incremental: merge new graph into existing
      try {
        const existingData = await readFile(graphPath, 'utf-8');
        const existingGraph = DependencyGraph.fromJSON(
          JSON.parse(existingData) as { nodes: GraphNode[]; edges: { source: string; target: string; type: 'imports' | 'extends' | 'implements' | 'calls' | 'references' }[] },
        );

        // Collect file paths being re-indexed to identify stale nodes
        const reindexedFiles = new Set(filesToProcess.map((f) => f.filePath));
        const existingNodes = existingGraph.getAllNodes();
        const existingEdges = existingGraph.getAllEdges();

        // Keep nodes NOT from re-indexed files, then add all new nodes
        const keptNodes = existingNodes.filter((n) => !reindexedFiles.has(n.filePath));
        const keptNodeIds = new Set(keptNodes.map((n) => n.id));
        const keptEdges = existingEdges.filter(
          (e) => keptNodeIds.has(e.source) && keptNodeIds.has(e.target),
        );

        // Rebuild merged graph
        const merged = new DependencyGraph();
        for (const node of keptNodes) merged.addNode(node);
        for (const edge of keptEdges) merged.addEdge(edge);
        for (const node of newGraph.getAllNodes()) merged.addNode(node);
        for (const edge of newGraph.getAllEdges()) merged.addEdge(edge);

        await writeFile(graphPath, JSON.stringify(merged.toJSON()), 'utf-8');
      } catch {
        // No existing graph, write new one
        await writeFile(graphPath, JSON.stringify(newGraph.toJSON()), 'utf-8');
      }
    }
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

  return { filesProcessed: filesToProcess.length, chunksCreated: enrichedChunks.length, parseErrors, skippedFiles, parseErrorDetails };
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
    id: `backlog:${item.externalId.replace('#', '-')}`,
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
  embeddingProvider?: EmbeddingProvider,
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
  const resolvedEmbeddingProvider = embeddingProvider ?? createSimpleEmbeddingProvider(config.embedding);

  const textsToEmbed = chunks.map(
    (c) => c.nlSummary ? `${c.nlSummary}\n\n${c.content}` : c.content,
  );
  const embedResult = await resolvedEmbeddingProvider.embed(textsToEmbed);
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
    const nodeId = `backlog:${item.externalId.replace('#', '-')}`;

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
        const backlogNodeId = `backlog:${externalId.replace('#', '-')}`;
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
    .option('--quiet', 'Suppress progress output (used by git hooks and background processes)')
    .action(async (options: { full?: boolean; quiet?: boolean }) => {
      const quiet = options.quiet === true;
      const startTime = Date.now();
      // Use a temporary spinner for config loading (logger needs storagePath from config)
      const bootSpinner = quiet ? null : ora('Loading configuration...').start();

      try {
        const rootDir = process.cwd();

        // Step 1: Load config
        const configResult = await loadConfig(rootDir);
        if (configResult.isErr()) {
          bootSpinner?.fail(configResult.error.message);
          if (!quiet) {
            // eslint-disable-next-line no-console
            console.error(chalk.red('Run "coderag init" first to create a configuration file.'));
          }
          process.exit(1);
        }
        const config = configResult.value;
        const storagePath = resolve(rootDir, config.storage.path);

        // Prevent path traversal outside project root
        if (!storagePath.startsWith(resolve(rootDir) + sep) && storagePath !== resolve(rootDir)) {
          bootSpinner?.fail('Storage path escapes project root');
          process.exit(1);
        }

        bootSpinner?.succeed('Configuration loaded');

        // Create IndexLogger — writes to .coderag/index.log + progress JSON
        const logger = new IndexLogger(storagePath, quiet);
        await logger.init();

        // Create embedding provider (with auto-start lifecycle if provider is 'auto')
        const managed = await createManagedEmbeddingProvider(config, logger);

        try {
          // Multi-repo path: if repos are configured, index each independently
          if (config.repos && config.repos.length > 0) {
            await indexMultiRepo(config, storagePath, options, logger, startTime, managed.provider);
            return;
          }

          // Single-repo path
          logger.start('Starting indexing...');
          const result = await indexSingleRepo(rootDir, storagePath, config, options, logger, undefined, managed.provider);

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
              backlogResult = await indexBacklog(config.backlog, storagePath, config, options, logger, managed.provider);
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
        if (result.skippedFiles > 0) {
          // eslint-disable-next-line no-console
          console.log(`  Skipped:         ${chalk.gray(String(result.skippedFiles))} (unsupported file types)`);
        }
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
        } finally {
          // Auto-stop backend if configured
          if (managed.lifecycleManager && config.embedding.autoStop) {
            await logger.info('Stopping embedding backend (auto_stop enabled)...');
            await managed.lifecycleManager.stop();
            await logger.info('Embedding backend stopped.');
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        // eslint-disable-next-line no-console
        console.error(chalk.red('\nIndexing failed:'), message);
        process.exit(1);
      }
    });
}

/**
 * Rebuild the root-level merged index from existing per-repo stores.
 * Used when incremental indexing finds no changes but the unified index is missing
 * (e.g., after upgrading CodeRAG or first run after multi-repo index was created).
 */
export async function rebuildMergedIndex(
  storagePath: string,
  repoResults: Array<{ repoName: string; repoPath: string; repoStoragePath: string; parsedFiles: ParsedFile[] }>,
  config: CodeRAGConfig,
  logger: IndexLogger,
): Promise<void> {
  await logger.info('Rebuilding unified index from per-repo data...');

  const mergedGraph = new DependencyGraph();
  let totalMergedChunks = 0;

  // Open root LanceDB store
  const rootStore = new LanceDBStore(storagePath, config.embedding.dimensions);
  await rootStore.connect();

  for (const rr of repoResults) {
    const repoGraphPath = join(rr.repoStoragePath, 'graph.json');

    // Read all rows from per-repo LanceDB and copy to root store
    const repoStore = new LanceDBStore(rr.repoStoragePath, config.embedding.dimensions);
    await repoStore.connect();

    try {
      const internal = repoStore as unknown as {
        table: { query: () => { toArray: () => Promise<Array<{
          id: string; vector: number[]; content: string; nl_summary: string;
          file_path: string; chunk_type: string; language: string; metadata: string;
        }>> } } | null;
      };
      const table = internal.table;
      if (table) {
        const allRows = await table.query().toArray();
        if (allRows.length > 0) {
          const ids = allRows.map((r) => r.id);
          // LanceDB returns Arrow-typed vectors (FixedSizeList with .isValid),
          // not plain number[]. Convert to plain arrays for re-ingestion.
          const embeddings = allRows.map((r) => Array.from(r.vector as Iterable<number>));
          // Parse the metadata JSON string back to an object so upsert
          // preserves all original fields (start_line, end_line, name, repo_name, etc.)
          // without double-serialization.
          const metadata = allRows.map((r) => {
            try {
              return JSON.parse(r.metadata) as Record<string, unknown>;
            } catch {
              return {
                content: r.content,
                nl_summary: r.nl_summary,
                chunk_type: r.chunk_type,
                file_path: r.file_path,
                language: r.language,
              };
            }
          });
          const upsertResult = await rootStore.upsert(ids, embeddings, metadata);
          if (upsertResult.isOk()) {
            totalMergedChunks += allRows.length;
          } else {
            await logger.warn(`[${rr.repoName}] LanceDB upsert failed: ${upsertResult.error.message}`);
          }
        }
      }
    } catch (mergeErr: unknown) {
      const mergeMsg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
      await logger.warn(`[${rr.repoName}] Failed to read LanceDB for merge: ${mergeMsg}`);
    }
    repoStore.close();

    // Merge graph
    try {
      const graphData = await readFile(repoGraphPath, 'utf-8');
      const repoGraph = DependencyGraph.fromJSON(
        JSON.parse(graphData) as { nodes: GraphNode[]; edges: { source: string; target: string; type: 'imports' | 'extends' | 'implements' | 'calls' | 'references' }[] },
      );
      for (const node of repoGraph.getAllNodes()) mergedGraph.addNode(node);
      for (const edge of repoGraph.getAllEdges()) mergedGraph.addEdge(edge);
    } catch {
      // No graph for this repo — skip
    }
  }

  // Build merged BM25 from the root LanceDB (which now has all chunks)
  const mergedBm25 = await rebuildBm25FromStore(rootStore, logger, '');
  await writeFile(join(storagePath, 'bm25-index.json'), mergedBm25.serialize(), 'utf-8');

  rootStore.close();

  // Write merged graph
  await writeFile(join(storagePath, 'graph.json'), JSON.stringify(mergedGraph.toJSON()), 'utf-8');

  await logger.succeed(`Unified index rebuilt: ${totalMergedChunks} chunks from ${repoResults.length} repos`);
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
  embeddingProvider?: EmbeddingProvider,
): Promise<void> {
  const repos = config.repos!;

  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(chalk.bold(`Indexing ${repos.length} repo(s)...`));
  // eslint-disable-next-line no-console
  console.log('');

  logger.start('Starting multi-repo indexing...');

  // ── Phase 1: Scan & Parse all repos (fast) ──────────────────────────
  interface RepoScanResult {
    repoName: string;
    repoPath: string;
    repoStoragePath: string;
    filesToProcess: Array<{ filePath: string; content: string; contentHash: string }>;
    chunks: Chunk[];
    parsedFiles: ParsedFile[];
    indexState: IndexState;
    indexStatePath: string;
    parseErrors: number;
    skippedFiles: number;
    parseErrorDetails: Array<{ file: string; reason: string }>;
  }

  const parser = new TreeSitterParser();
  const initResult = await parser.initialize();
  if (initResult.isErr()) {
    throw new Error(`Parser init failed: ${initResult.error.message}`);
  }
  const mdParser = new MarkdownParser({ maxTokensPerChunk: config.ingestion.maxTokensPerChunk });
  const chunker = new ASTChunker({ maxTokensPerChunk: config.ingestion.maxTokensPerChunk });

  const repoResults: RepoScanResult[] = [];
  let totalFiles = 0;
  let totalChunks = 0;
  let totalErrors = 0;

  for (const repo of repos) {
    const repoName = repo.name ?? basename(repo.path);
    const repoPath = resolve(repo.path);
    const repoStoragePath = join(storagePath, repoName);
    await mkdir(repoStoragePath, { recursive: true });

    // Load or create index state
    let indexState = new IndexState();
    const indexStatePath = join(repoStoragePath, 'index-state.json');
    if (!options.full) {
      try {
        const stateData = await readFile(indexStatePath, 'utf-8');
        indexState = IndexState.fromJSON(JSON.parse(stateData) as Parameters<typeof IndexState.fromJSON>[0]);
      } catch {
        // No saved state, start fresh
      }
    }

    // Scan files
    await logger.info(`[${repoName}] Scanning files...`);
    const ignoreFilter = createIgnoreFilter(repoPath);
    const scanner = new FileScanner(repoPath, ignoreFilter);
    const scanResult = await scanner.scanFiles();
    if (scanResult.isErr()) {
      totalErrors++;
      await logger.fail(`[${repoName}] Scan failed: ${scanResult.error.message}`);
      continue;
    }

    const scannedFiles = scanResult.value;
    let filesToProcess = scannedFiles;
    if (!options.full) {
      filesToProcess = scannedFiles.filter(
        (f) => indexState.isDirty(f.filePath, f.contentHash),
      );
      if (filesToProcess.length === 0) {
        repoResults.push({
          repoName, repoPath, repoStoragePath, filesToProcess: [], chunks: [],
          parsedFiles: [], indexState, indexStatePath, parseErrors: 0, skippedFiles: 0, parseErrorDetails: [],
        });
        await logger.succeed(`[${repoName}] Up to date`);
        continue;
      }
    }

    // Parse & chunk
    const repoChunks: Chunk[] = [];
    const repoParsedFiles: ParsedFile[] = [];
    let parseErrors = 0;
    let skippedFiles = 0;
    const parseErrorDetails: Array<{ file: string; reason: string }> = [];

    for (const file of filesToProcess) {
      if (MarkdownParser.isMarkdownFile(file.filePath)) {
        const mdResult = mdParser.parse(file.filePath, file.content);
        if (mdResult.isErr()) {
          parseErrors++;
          parseErrorDetails.push({ file: file.filePath, reason: mdResult.error.message });
          continue;
        }
        repoChunks.push(...mdResult.value.chunks);
        continue;
      }

      const parseResult = await parser.parse(file.filePath, file.content);
      if (parseResult.isErr()) {
        if (parseResult.error.message.startsWith('Unsupported file type:')) {
          skippedFiles++;
          continue;
        }
        parseErrors++;
        parseErrorDetails.push({ file: file.filePath, reason: parseResult.error.message });
        continue;
      }

      const parsed = parseResult.value;
      repoParsedFiles.push(parsed);

      const chunkResult = await chunker.chunk(parsed);
      if (chunkResult.isErr()) {
        parseErrors++;
        parseErrorDetails.push({ file: file.filePath, reason: chunkResult.error.message });
        continue;
      }
      repoChunks.push(...chunkResult.value);
    }

    // Stamp repoName in chunk metadata
    for (const chunk of repoChunks) {
      chunk.metadata.repoName = repoName;
    }

    totalFiles += filesToProcess.length;
    totalChunks += repoChunks.length;
    totalErrors += parseErrors;

    const parsedCount = filesToProcess.length - parseErrors - skippedFiles;
    await logger.succeed(
      `[${repoName}] ${filesToProcess.length} files, ${parsedCount} parsed, ${repoChunks.length} chunks` +
        (skippedFiles > 0 ? ` (${skippedFiles} unsupported skipped)` : ''),
    );

    if (parseErrors > 0) {
      for (const detail of parseErrorDetails.slice(0, 3)) {
        // eslint-disable-next-line no-console
        console.log(`    ${chalk.gray('→')} ${detail.file}: ${chalk.yellow(detail.reason)}`);
      }
    }

    repoResults.push({
      repoName, repoPath, repoStoragePath, filesToProcess, chunks: repoChunks,
      parsedFiles: repoParsedFiles, indexState, indexStatePath, parseErrors, skippedFiles, parseErrorDetails,
    });
  }

  // Show aggregate totals after scan & parse
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(
    chalk.bold('Scan complete: ') +
      `${chalk.cyan(String(totalFiles))} files, ${chalk.cyan(String(totalChunks))} chunks across ${chalk.cyan(String(repos.length))} repos`,
  );
  // eslint-disable-next-line no-console
  console.log('');

  // All chunks across all repos (for unified enrichment)
  const allChunks = repoResults.flatMap((r) => r.chunks);

  if (allChunks.length === 0) {
    // Still update index state for files with no chunks
    for (const rr of repoResults) {
      for (const file of rr.filesToProcess) {
        rr.indexState.setFileState(file.filePath, {
          filePath: file.filePath,
          contentHash: file.contentHash,
          lastIndexedAt: new Date(),
          chunkIds: [],
        });
      }
      await writeFile(rr.indexStatePath, JSON.stringify(rr.indexState.toJSON(), null, 2), 'utf-8');
    }

    // Check if root merged index is missing or empty — rebuild from per-repo stores
    const rootBm25Path = join(storagePath, 'bm25-index.json');
    let needsRebuild = !existsSync(rootBm25Path);
    if (!needsRebuild) {
      try {
        const bm25Data = await readFile(rootBm25Path, 'utf-8');
        const parsed = JSON.parse(bm25Data) as { documentCount?: number };
        needsRebuild = !parsed.documentCount || parsed.documentCount === 0;
      } catch {
        needsRebuild = true;
      }
    }
    if (needsRebuild) {
      await rebuildMergedIndex(storagePath, repoResults, config, logger);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    // eslint-disable-next-line no-console
    console.log(chalk.yellow('No new chunks. Index is up to date.'));
    // eslint-disable-next-line no-console
    console.log(`  Time elapsed: ${chalk.cyan(elapsed + 's')}`);
    return;
  }

  // ── Phase 2: Enrich all chunks together (slow) ─────────────────────
  await logger.setPhase('enrich', { totalChunks: allChunks.length, enrichedChunks: 0 });
  const ollamaClient = new OllamaClient({ model: config.llm.model });
  const enricher = new NLEnricher(ollamaClient);

  // Load checkpoint (shared across repos)
  const checkpoint = await loadEnrichmentCheckpoint(storagePath);
  const savedSummaries: Record<string, string> = checkpoint?.summaries ?? {};
  await logger.info(`Checkpoint: ${checkpoint ? `loaded (${Object.keys(savedSummaries).length} summaries)` : 'none found'}`);

  const chunksToEnrich = allChunks.filter((c) => !(c.id in savedSummaries));

  if (Object.keys(savedSummaries).length > 0) {
    await logger.info(
      `Resuming enrichment: ${Object.keys(savedSummaries).length} already done, ${chunksToEnrich.length} remaining`,
    );
  } else {
    await logger.info(`Enriching ${allChunks.length} chunks with NL summaries...`);
  }

  // Pre-flight: verify Ollama
  const ollamaAvailable = await ollamaClient.isAvailable();
  if (!ollamaAvailable) {
    await logger.fail(`Ollama is not reachable at ${ollamaClient.currentConfig.baseUrl}. Start Ollama first, then re-run.`);
    throw new Error(`Ollama is not reachable at ${ollamaClient.currentConfig.baseUrl}`);
  }

  let enrichErrors = 0;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;
  const totalBatches = Math.ceil(chunksToEnrich.length / ENRICHMENT_BATCH_SIZE);

  for (let i = 0; i < chunksToEnrich.length; i += ENRICHMENT_BATCH_SIZE) {
    const batchNum = Math.floor(i / ENRICHMENT_BATCH_SIZE) + 1;
    const batch = chunksToEnrich.slice(i, i + ENRICHMENT_BATCH_SIZE);
    await logger.info(
      `Enrichment batch ${batchNum}/${totalBatches} (${batch.length} chunks, ${Object.keys(savedSummaries).length}/${allChunks.length} total)...`,
    );

    const enrichResult = await enricher.enrichBatch(batch);
    if (enrichResult.isOk()) {
      const { enriched, failedCount } = enrichResult.value;
      for (const chunk of enriched) {
        if (chunk.nlSummary) {
          savedSummaries[chunk.id] = chunk.nlSummary;
        }
      }

      if (failedCount === 0) {
        consecutiveFailures = 0;
      } else if (enriched.length > 0) {
        consecutiveFailures = 0;
        enrichErrors++;
        await logger.warn(`Batch ${batchNum}: ${enriched.length} OK, ${failedCount} failed`);
      } else {
        consecutiveFailures++;
        enrichErrors++;
        await logger.warn(`Batch ${batchNum}: all ${failedCount} chunks failed`);

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          await logger.fail(
            `Enrichment aborted: ${MAX_CONSECUTIVE_FAILURES} consecutive batch failures. ` +
              `Is Ollama running? Check: curl ${ollamaClient.currentConfig.baseUrl}/api/tags`,
          );
          await saveEnrichmentCheckpoint(storagePath, {
            summaries: savedSummaries,
            totalProcessed: Object.keys(savedSummaries).length,
          });
          throw new Error(`Enrichment aborted after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`);
        }
      }
    } else {
      enrichErrors++;
      consecutiveFailures++;
      await logger.warn(`Batch ${batchNum} enrichment error: ${enrichResult.error.message}`);
    }

    await saveEnrichmentCheckpoint(storagePath, {
      summaries: savedSummaries,
      totalProcessed: Object.keys(savedSummaries).length,
    });
    await logger.updateCount('enrichedChunks', Object.keys(savedSummaries).length);
  }

  if (enrichErrors > 0) {
    await logger.warn(`${enrichErrors} enrichment batch(es) failed, some chunks have no NL summary`);
  }

  await clearEnrichmentCheckpoint(storagePath);

  // ── Phase 3: Embed & Store per repo ─────────────────────────────────
  await logger.setPhase('embed');
  const resolvedEmbeddingProvider = embeddingProvider ?? createSimpleEmbeddingProvider(config.embedding);

  // Accumulators for merged root-level index
  const mergedIds: string[] = [];
  const mergedEmbeddings: number[][] = [];
  const mergedMetadata: Record<string, unknown>[] = [];
  const mergedBm25Chunks: Chunk[] = [];
  const mergedGraph = new DependencyGraph();

  for (const rr of repoResults) {
    if (rr.chunks.length === 0) continue;

    // Apply saved summaries to this repo's chunks
    const enrichedChunks = rr.chunks.map((c) => {
      const summary = savedSummaries[c.id];
      return summary ? { ...c, nlSummary: summary } : c;
    });

    await logger.info(`[${rr.repoName}] Embedding ${enrichedChunks.length} chunks...`);
    const textsToEmbed = enrichedChunks.map(
      (c) => c.nlSummary ? `${c.nlSummary}\n\n${c.content}` : c.content,
    );
    const embedResult = await resolvedEmbeddingProvider.embed(textsToEmbed);
    if (embedResult.isErr()) {
      totalErrors++;
      await logger.fail(`[${rr.repoName}] Embedding failed: ${embedResult.error.message}`);
      continue;
    }
    const embeddings = embedResult.value;

    // Store in per-repo LanceDB
    await logger.info(`[${rr.repoName}] Storing in LanceDB...`);
    const store = new LanceDBStore(rr.repoStoragePath, config.embedding.dimensions);
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
      totalErrors++;
      await logger.fail(`[${rr.repoName}] Store failed: ${upsertResult.error.message}`);
      continue;
    }

    // Accumulate for merged root index
    mergedIds.push(...ids);
    mergedEmbeddings.push(...embeddings);
    mergedMetadata.push(...metadata);
    mergedBm25Chunks.push(...enrichedChunks);

    // Per-repo BM25 index
    const bm25Path = join(rr.repoStoragePath, 'bm25-index.json');
    let bm25: BM25Index;

    if (options.full) {
      bm25 = new BM25Index();
    } else {
      try {
        const existingBm25 = await readFile(bm25Path, 'utf-8');
        bm25 = BM25Index.deserialize(existingBm25);
        const staleChunkIds: string[] = [];
        for (const file of rr.filesToProcess) {
          const fileState = rr.indexState.getFileState(file.filePath);
          if (fileState) staleChunkIds.push(...fileState.chunkIds);
        }
        if (staleChunkIds.length > 0) {
          try {
            bm25.removeChunks(staleChunkIds);
          } catch {
            bm25 = await rebuildBm25FromStore(store, logger, `[${rr.repoName}] `);
          }
        }
      } catch {
        bm25 = new BM25Index();
      }
    }

    bm25.addChunks(enrichedChunks);
    await writeFile(bm25Path, bm25.serialize(), 'utf-8');

    // Per-repo dependency graph
    const graphBuilder = new GraphBuilder(rr.repoPath);
    const graphResult = graphBuilder.buildFromFiles(rr.parsedFiles);
    if (graphResult.isOk()) {
      const graphPath = join(rr.repoStoragePath, 'graph.json');
      const newGraph = graphResult.value;

      // Accumulate for merged graph
      for (const node of newGraph.getAllNodes()) mergedGraph.addNode(node);
      for (const edge of newGraph.getAllEdges()) mergedGraph.addEdge(edge);

      if (options.full) {
        await writeFile(graphPath, JSON.stringify(newGraph.toJSON()), 'utf-8');
      } else {
        try {
          const existingData = await readFile(graphPath, 'utf-8');
          const existingGraph = DependencyGraph.fromJSON(
            JSON.parse(existingData) as { nodes: GraphNode[]; edges: { source: string; target: string; type: 'imports' | 'extends' | 'implements' | 'calls' | 'references' }[] },
          );
          const reindexedFiles = new Set(rr.filesToProcess.map((f) => f.filePath));
          const existingNodes = existingGraph.getAllNodes();
          const existingEdges = existingGraph.getAllEdges();
          const keptNodes = existingNodes.filter((n) => !reindexedFiles.has(n.filePath));
          const keptNodeIds = new Set(keptNodes.map((n) => n.id));
          const keptEdges = existingEdges.filter(
            (e) => keptNodeIds.has(e.source) && keptNodeIds.has(e.target),
          );
          const merged = new DependencyGraph();
          for (const node of keptNodes) merged.addNode(node);
          for (const edge of keptEdges) merged.addEdge(edge);
          for (const node of newGraph.getAllNodes()) merged.addNode(node);
          for (const edge of newGraph.getAllEdges()) merged.addEdge(edge);
          await writeFile(graphPath, JSON.stringify(merged.toJSON()), 'utf-8');
        } catch {
          await writeFile(graphPath, JSON.stringify(newGraph.toJSON()), 'utf-8');
        }
      }
    }

    // Update index state
    for (const file of rr.filesToProcess) {
      const fileChunkIds = enrichedChunks
        .filter((c) => c.filePath === file.filePath)
        .map((c) => c.id);
      rr.indexState.setFileState(file.filePath, {
        filePath: file.filePath,
        contentHash: file.contentHash,
        lastIndexedAt: new Date(),
        chunkIds: fileChunkIds,
      });
    }
    await writeFile(rr.indexStatePath, JSON.stringify(rr.indexState.toJSON(), null, 2), 'utf-8');

    store.close();

    await logger.succeed(`[${rr.repoName}] ${enrichedChunks.length} chunks indexed`);
  }

  // ── Phase 4: Merge all repos into root-level unified index ─────────
  // This ensures search/MCP/viewer/benchmark can query all repos at once
  if (mergedIds.length > 0) {
    await logger.info('Merging all repos into unified index...');

    // Merged LanceDB at root storagePath
    const rootStore = new LanceDBStore(storagePath, config.embedding.dimensions);
    await rootStore.connect();
    const mergeResult = await rootStore.upsert(mergedIds, mergedEmbeddings, mergedMetadata);
    if (mergeResult.isErr()) {
      await logger.fail(`Merged store failed: ${mergeResult.error.message}`);
    }
    rootStore.close();

    // Merged BM25 index at root
    const rootBm25 = new BM25Index();
    rootBm25.addChunks(mergedBm25Chunks);
    await writeFile(join(storagePath, 'bm25-index.json'), rootBm25.serialize(), 'utf-8');

    // Merged graph at root
    await writeFile(join(storagePath, 'graph.json'), JSON.stringify(mergedGraph.toJSON()), 'utf-8');

    await logger.succeed(`Unified index: ${mergedIds.length} chunks across ${repos.length} repos`);
  }

  // ── Final summary ───────────────────────────────────────────────────
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
