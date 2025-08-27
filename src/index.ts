import { Hono } from 'hono'
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { Config } from './config/config';
import { githubAuth } from './middleware/auth';

import { ChunkSearcher, CodeReviewer, PromptLoader, GitClient, Parser } from './lib'
import { ChromaManager } from './lib/chroma';
import { SvelteKitParser, sveltekitPatterns } from './frameworks/sveltekit';

const app = new Hono()

app.use('*', cors());
app.use('*', logger());
app.use('*', githubAuth);

app.get('/', async (c) => {
  return c.json({
    status: 'healthy',
    service: 'Code Review API',
    timestamp: new Date().toISOString()
  });
});


app.post('/update-codebase', async (c) => {
  try {
    const body = await c.req.json();
    const { repoUrl, branch = 'main', token } = body;

    if (!repoUrl) {
      return c.json({ success: false, error: 'repoUrl is required' }, 400);
    }

    // const gitClient = new GitClient();
    // const accessToken = token || Bun.env.GITHUB_ACCESS_TOKEN
    // const repoPath = await gitClient.cloneRepository(repoUrl, branch, accessToken);

    const chromaManager = new ChromaManager();
    await chromaManager.initializeCollection();
    await chromaManager.clearCollection();

    const parser = new Parser(chromaManager);

    parser.register(sveltekitPatterns, new SvelteKitParser())

    const chunksCreated = await parser.chunkCodebase("/app/tmp/repo-1756205646640")//repoPath);

    console.log(`Chunks created: ${chunksCreated}`);

    return c.json({
      success: true,
      message: 'Codebase updated successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update codebase'
    }, 500);
  }
});

app.post('/review', async (c) => {
  try {
    const body = await c.req.json();
    const { changedCode, description, fileName, files } = body;

    let codeToReview = '';
    let fileNames = [];

    if (files && Array.isArray(files)) {
      fileNames = files.map(f => f.fileName);
      codeToReview = files.map(f =>
        `\n=== File: ${f.fileName} ===\n${f.changedCode}`
      ).join('\n\n');

      console.log(`Processing PR review for ${files.length} files`);
    } else if (changedCode) {

      codeToReview = changedCode;
      fileNames = [fileName || 'Unknown'];

      console.log(`Processing PR review for: ${fileName}`);
    } else {
      return c.json({
        success: false,
        error: 'No code to review. Provide either "files" array or "changedCode"'
      }, 400);
    }

    if (!codeToReview) {
      return c.json({
        success: false,
        error: 'No code changes found'
      }, 400);
    }

    const searcher = new ChunkSearcher();
    await searcher.init();

    console.log('Finding relevant code context...')
    const relevantChunks = await searcher.findSimilarChunks(codeToReview, 5);


    for (const chunk of relevantChunks) {
      chunk.content = await searcher.getChunkContent(chunk.hash);
    }

    const reviewer = new CodeReviewer();
    const contextString = reviewer.formatContext(relevantChunks);

    const config = Config.getInstance();

    const promptPath = config.getFullPath(
      config.get().paths.promptsDir,
      'review.txt'
    );

    const prompt = await PromptLoader.loadPrompt(promptPath, {
      fileName: fileName || 'Unknown file',
      description: description || 'No description provided',
      changedCode: codeToReview,
      context: contextString
    });
    const review = await reviewer.generateReview(prompt);

    return c.json({
      success: true,
      review,
      relevantContext: relevantChunks.map(chunk => ({
        type: chunk.type,
        similarity: chunk.similarity,
        preview: chunk.content?.slice(0, 100) + '...'
      })),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error reviewing PR:', error)
    return c.json({
      success: false,
      error: 'Failed to review PR',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

export default app
