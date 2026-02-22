import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFile, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
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
  type Chunk,
  type ParsedFile,
  type CodeRAGConfig,
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
