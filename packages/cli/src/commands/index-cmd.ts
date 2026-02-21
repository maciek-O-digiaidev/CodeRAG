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
  type Chunk,
  type ParsedFile,
} from '@coderag/core';

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

        // Step 2: Load or create index state
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

        // Step 3: Scan files
        spinner.text = 'Scanning files...';
        const ignoreFilter = createIgnoreFilter(rootDir);
        const scanner = new FileScanner(rootDir, ignoreFilter);
        const scanResult = await scanner.scanFiles();
        if (scanResult.isErr()) {
          spinner.fail(`Scan failed: ${scanResult.error.message}`);
          process.exit(1);
        }
        const scannedFiles = scanResult.value;
        spinner.text = `Scanned ${scannedFiles.length} files`;

        // Step 4: Filter to changed files (incremental)
        let filesToProcess = scannedFiles;
        if (!options.full) {
          filesToProcess = scannedFiles.filter(
            (f) => indexState.isDirty(f.filePath, f.contentHash),
          );
          if (filesToProcess.length === 0) {
            spinner.succeed('No changes detected, index is up to date.');
            return;
          }
          spinner.text = `${filesToProcess.length} file(s) changed, processing...`;
        }

        // Step 5: Initialize parser
        spinner.text = 'Initializing parser...';
        const parser = new TreeSitterParser();
        const initResult = await parser.initialize();
        if (initResult.isErr()) {
          spinner.fail(`Parser init failed: ${initResult.error.message}`);
          process.exit(1);
        }

        // Step 6: Parse and chunk
        spinner.text = `Parsing ${filesToProcess.length} files...`;
        const chunker = new ASTChunker({ maxTokensPerChunk: config.ingestion.maxTokensPerChunk });
        const allChunks: Chunk[] = [];
        const allParsedFiles: ParsedFile[] = [];
        let parseErrors = 0;

        for (const file of filesToProcess) {
          const parseResult = await parser.parse(file.filePath, file.content);
          if (parseResult.isErr()) {
            parseErrors++;
            continue;
          }

          const parsed = parseResult.value;
          allParsedFiles.push(parsed);

          const chunkResult = await chunker.chunk(parsed);
          if (chunkResult.isErr()) {
            parseErrors++;
            continue;
          }

          allChunks.push(...chunkResult.value);
        }

        spinner.text = `Parsed ${filesToProcess.length - parseErrors} files, created ${allChunks.length} chunks`;

        if (allChunks.length === 0) {
          spinner.succeed('No chunks produced. Nothing to index.');
          return;
        }

        // Step 7: Enrich with NL summaries
        spinner.text = `Enriching ${allChunks.length} chunks with NL summaries...`;
        const ollamaClient = new OllamaClient({ model: config.llm.model });
        const enricher = new NLEnricher(ollamaClient);
        const enrichResult = await enricher.enrichBatch(allChunks);
        let enrichedChunks: Chunk[];
        if (enrichResult.isErr()) {
          spinner.text = chalk.yellow('NL enrichment failed, using chunks without summaries');
          enrichedChunks = allChunks;
        } else {
          enrichedChunks = enrichResult.value;
        }

        // Step 8: Embed chunks
        spinner.text = `Embedding ${enrichedChunks.length} chunks...`;
        const embeddingProvider = new OllamaEmbeddingProvider({
          model: config.embedding.model,
          dimensions: config.embedding.dimensions,
        });

        const textsToEmbed = enrichedChunks.map(
          (c) => c.nlSummary ? `${c.nlSummary}\n\n${c.content}` : c.content,
        );
        const embedResult = await embeddingProvider.embed(textsToEmbed);
        if (embedResult.isErr()) {
          spinner.fail(`Embedding failed: ${embedResult.error.message}`);
          process.exit(1);
        }
        const embeddings = embedResult.value;

        // Step 9: Store in LanceDB
        spinner.text = 'Storing embeddings in LanceDB...';
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
        }));

        const upsertResult = await store.upsert(ids, embeddings, metadata);
        if (upsertResult.isErr()) {
          spinner.fail(`Store failed: ${upsertResult.error.message}`);
          store.close();
          process.exit(1);
        }

        // Step 10: Build BM25 index
        spinner.text = 'Building BM25 index...';
        const bm25 = new BM25Index();
        bm25.addChunks(enrichedChunks);
        const bm25Path = join(storagePath, 'bm25-index.json');
        await writeFile(bm25Path, bm25.serialize(), 'utf-8');

        // Step 11: Build dependency graph
        spinner.text = 'Building dependency graph...';
        const graphBuilder = new GraphBuilder(rootDir);
        const graphResult = graphBuilder.buildFromFiles(allParsedFiles);
        if (graphResult.isOk()) {
          const graphPath = join(storagePath, 'graph.json');
          await writeFile(graphPath, JSON.stringify(graphResult.value.toJSON()), 'utf-8');
        }

        // Step 12: Update index state
        spinner.text = 'Saving index state...';
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

        // Step 13: Summary
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        spinner.succeed('Indexing complete!');

        // eslint-disable-next-line no-console
        console.log('');
        // eslint-disable-next-line no-console
        console.log(chalk.bold('Summary:'));
        // eslint-disable-next-line no-console
        console.log(`  Files processed: ${chalk.cyan(String(filesToProcess.length))}`);
        // eslint-disable-next-line no-console
        console.log(`  Chunks created:  ${chalk.cyan(String(enrichedChunks.length))}`);
        if (parseErrors > 0) {
          // eslint-disable-next-line no-console
          console.log(`  Parse errors:    ${chalk.yellow(String(parseErrors))}`);
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
