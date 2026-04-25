import { Router } from 'express';

const router = Router();

/**
 * Fetch URL content and convert to markdown.
 * Uses Turndown for HTML → Markdown conversion.
 */
router.post('/fetch', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'NESTdesktop/1.0 (Mozilla/5.0 compatible)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });

    const contentType = resp.headers.get('content-type') || '';
    const text = await resp.text();

    if (contentType.includes('text/html')) {
      // Convert HTML to markdown using Turndown
      const { default: TurndownService } = await import('turndown');
      const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
      const markdown = td.turndown(text);

      // Truncate if huge
      const truncated = markdown.length > 50000 ? markdown.slice(0, 50000) + '\n\n[Content truncated]' : markdown;
      res.json({ content: truncated, url, contentType: 'text/markdown', originalLength: text.length });
    } else {
      // Return raw text
      const truncated = text.length > 50000 ? text.slice(0, 50000) + '\n\n[Content truncated]' : text;
      res.json({ content: truncated, url, contentType, originalLength: text.length });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Web search using Tavily API.
 */
router.post('/search', async (req, res) => {
  try {
    const { query, max_results = 5 } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });

    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'TAVILY_API_KEY not set' });

    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results,
        search_depth: 'basic',
        include_answer: true,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await resp.json();
    res.json({
      answer: data.answer,
      results: (data.results || []).map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
