import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFile, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
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
  IndexState,
  MultiRepoIndexer,
  AzureDevOpsProvider,
  JiraProvider,
  ClickUpProvider,
  type BacklogProvider,
  type BacklogItem,
  type Chunk,
  type ChunkMetadata,
  type ParsedFile,
  type CodeRAGConfig,
  type BacklogConfig,
} from '@coderag/core';

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
  spinner: ReturnType<typeof ora>,
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
  spinner.text = `${prefix}Scanning files...`;
  const ignoreFilter = createIgnoreFilter(rootDir);
  const scanner = new FileScanner(rootDir, ignoreFilter);
  const scanResult = await scanner.scanFiles();
  if (scanResult.isErr()) {
    throw new Error(`Scan failed: ${scanResult.error.message}`);
  }
  const scannedFiles = scanResult.value;
  spinner.text = `${prefix}Scanned ${scannedFiles.length} files`;

  // Filter to changed files (incremental)
  let filesToProcess = scannedFiles;
  if (!options.full) {
    filesToProcess = scannedFiles.filter(
      (f) => indexState.isDirty(f.filePath, f.contentHash),
    );
    if (filesToProcess.length === 0) {
      return { filesProcessed: 0, chunksCreated: 0, parseErrors: 0, parseErrorDetails: [] };
    }
    spinner.text = `${prefix}${filesToProcess.length} file(s) changed, processing...`;
  }

  // Initialize parser
  spinner.text = `${prefix}Initializing parser...`;
  const parser = new TreeSitterParser();
  const initResult = await parser.initialize();
  if (initResult.isErr()) {
    throw new Error(`Parser init failed: ${initResult.error.message}`);
  }

  // Parse and chunk
  spinner.text = `${prefix}Parsing ${filesToProcess.length} files...`;
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

  spinner.text = `${prefix}Parsed ${filesToProcess.length - parseErrors} files, created ${allChunks.length} chunks`;

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

  // Enrich with NL summaries
  spinner.text = `${prefix}Enriching ${allChunks.length} chunks with NL summaries...`;
  const ollamaClient = new OllamaClient({ model: config.llm.model });
  const enricher = new NLEnricher(ollamaClient);
  const enrichResult = await enricher.enrichBatch(allChunks);
  let enrichedChunks: Chunk[];
  if (enrichResult.isErr()) {
    spinner.text = chalk.yellow(`${prefix}NL enrichment failed, using chunks without summaries`);
    enrichedChunks = allChunks;
  } else {
    enrichedChunks = enrichResult.value;
  }

  // Embed chunks
  spinner.text = `${prefix}Embedding ${enrichedChunks.length} chunks...`;
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
  spinner.text = `${prefix}Storing embeddings in LanceDB...`;
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
  spinner.text = `${prefix}Building BM25 index...`;
  const bm25 = new BM25Index();
  bm25.addChunks(enrichedChunks);
  const bm25Path = join(storagePath, 'bm25-index.json');
  await writeFile(bm25Path, bm25.serialize(), 'utf-8');

  // Build dependency graph
  spinner.text = `${prefix}Building dependency graph...`;
  const graphBuilder = new GraphBuilder(rootDir);
  const graphResult = graphBuilder.buildFromFiles(allParsedFiles);
  if (graphResult.isOk()) {
    const graphPath = join(storagePath, 'graph.json');
    await writeFile(graphPath, JSON.stringify(graphResult.value.toJSON()), 'utf-8');
  }

  // Update index state
  spinner.text = `${prefix}Saving index state...`;
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
  spinner: ReturnType<typeof ora>,
): Promise<BacklogIndexResult> {
  // Create provider
  const provider = createBacklogProvider(backlogConfig);
  if (!provider) {
    return { itemsFetched: 0, itemsIndexed: 0, skipped: 0, error: `Unknown backlog provider: ${backlogConfig.provider}` };
  }

  // Initialize provider
  spinner.text = 'Backlog: connecting to provider...';
  const initResult = await provider.initialize(backlogConfig.config ?? {});
  if (initResult.isErr()) {
    return { itemsFetched: 0, itemsIndexed: 0, skipped: 0, error: `Backlog init failed: ${initResult.error.message}` };
  }

  // Fetch all items
  spinner.text = 'Backlog: fetching work items...';
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

  spinner.text = `Backlog: converting ${changedItems.length} items to chunks...`;
  const chunks = changedItems.map(backlogItemToChunk);

  // Embed chunks
  spinner.text = `Backlog: embedding ${chunks.length} items...`;
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
  spinner.text = `Backlog: storing ${chunks.length} items in vector database...`;
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
  spinner.text = 'Backlog: updating BM25 index...';
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

  return { itemsFetched: items.length, itemsIndexed: changedItems.length, skipped };
}

export function registerIndexCommand(program: Command): void {
  program
    .command('index')
    .description('Index the codebase: scan, parse, chunk, enrich, embed, and store')
    .option('--full', 'Force a complete re-index (ignore incremental state)')
    .action(async (options: { full?: boolean }) => {
      const startTime = Date.now();
      const spinner = ora('Loading configuration...').start();

      try {
        const rootDir = process.cwd();

        // Step 1: Load config
        const configResult = await loadConfig(rootDir);
        if (configResult.isErr()) {
          spinner.fail(configResult.error.message);
          // eslint-disable-next-line no-console
          console.error(chalk.red('Run "coderag init" first to create a configuration file.'));
          process.exit(1);
        }
        const config = configResult.value;
        const storagePath = resolve(rootDir, config.storage.path);

        // Prevent path traversal outside project root
        if (!storagePath.startsWith(resolve(rootDir) + sep) && storagePath !== resolve(rootDir)) {
          spinner.fail('Storage path escapes project root');
          process.exit(1);
        }

        // Multi-repo path: if repos are configured, index each independently
        if (config.repos && config.repos.length > 0) {
          await indexMultiRepo(config, storagePath, options, spinner, startTime);
          return;
        }

        // Single-repo path: existing behavior
        const result = await indexSingleRepo(rootDir, storagePath, config, options, spinner);

        if (result.filesProcessed === 0 && result.chunksCreated === 0 && result.parseErrors === 0) {
          spinner.succeed('No changes detected, index is up to date.');
          return;
        }

        if (result.chunksCreated === 0 && result.parseErrors > 0) {
          spinner.warn('No chunks produced. Nothing to index.');
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
            backlogResult = await indexBacklog(config.backlog, storagePath, config, options, spinner);
          } catch (backlogError: unknown) {
            const msg = backlogError instanceof Error ? backlogError.message : String(backlogError);
            backlogResult = { itemsFetched: 0, itemsIndexed: 0, skipped: 0, error: msg };
          }
        }

        // Summary
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        spinner.succeed('Indexing complete!');

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
      } catch (error: unknown) {
        spinner.fail('Indexing failed');
        const message = error instanceof Error ? error.message : String(error);
        // eslint-disable-next-line no-console
        console.error(chalk.red('Error:'), message);
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
  spinner: ReturnType<typeof ora>,
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

  const result = await multiRepoIndexer.indexAll({
    full: options.full,
    onProgress: (repoName, status) => {
      spinner.text = `[${repoName}] ${status}`;
    },
  });

  if (result.isErr()) {
    spinner.fail(`Multi-repo indexing failed: ${result.error.message}`);
    process.exit(1);
  }

  // Per-repo summary
  for (const repoResult of result.value.repoResults) {
    totalFiles += repoResult.filesProcessed;
    totalChunks += repoResult.chunksCreated;

    if (repoResult.errors.length > 0) {
      totalErrors += repoResult.errors.length;
      spinner.fail(`[${repoResult.repoName}] Failed`);
      for (const error of repoResult.errors) {
        // eslint-disable-next-line no-console
        console.log(`    ${chalk.gray('→')} ${chalk.red(error)}`);
      }
    } else if (repoResult.filesProcessed === 0) {
      spinner.succeed(`[${repoResult.repoName}] Up to date`);
    } else {
      spinner.succeed(
        `[${repoResult.repoName}] ${repoResult.filesProcessed} file(s) processed`,
      );
    }

    // Reset spinner for next repo
    spinner = ora();
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
}
