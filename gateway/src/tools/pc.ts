/**
 * NESTeq Gateway — PC Control Tools
 * Calls NESTdesktop's local agent at localhost:3001/pc/*.
 * Only works when NESTdesktop is running on the PC.
 *
DESANITIZE
DESANITIZE
 */

const PC_AGENT_URL = process.env.PC_AGENT_URL || 'http://localhost:3001'

async function callPcAgent(endpoint: string, body?: Record<string, unknown>, method = 'POST'): Promise<string> {
  try {
    const resp = await fetch(`${PC_AGENT_URL}/pc${endpoint}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120000), // 2 min timeout for shell commands
    })

    const data = await resp.json() as any

    if (!resp.ok) {
      return `PC Agent error: ${data.error || `HTTP ${resp.status}`}`
    }

    // Format output nicely
    if (data.content) return data.content // file read returns content directly
    if (data.output) return data.output   // grep returns output
    if (data.stdout !== undefined) {      // shell returns stdout/stderr
      let result = data.stdout || ''
      if (data.stderr) result += (result ? '\n' : '') + `[stderr] ${data.stderr}`
      if (data.exitCode && data.exitCode !== 0) result += `\n[exit code: ${data.exitCode}]`
      return result || '(no output)'
    }
    return JSON.stringify(data, null, 2)
  } catch (err: any) {
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      return 'NESTdesktop is not running on this machine. Start it to use PC tools.'
    }
    if (err.name === 'TimeoutError') {
      return 'PC command timed out (120s limit).'
    }
    return `PC Agent error: ${err.message}`
  }
}

export async function executePcTool(toolName: string, args: Record<string, unknown>): Promise<string> {
  switch (toolName) {
    case 'pc_file_read':
      return callPcAgent('/file/read', {
        path: args.path,
        offset: args.offset,
        limit: args.limit,
      })

    case 'pc_file_write':
      return callPcAgent('/file/write', {
        path: args.path,
        content: args.content,
      })

    case 'pc_file_edit':
      return callPcAgent('/file/edit', {
        path: args.path,
        old_string: args.old_string,
        new_string: args.new_string,
        replace_all: args.replace_all,
      })

    case 'pc_glob':
      return callPcAgent('/glob', {
        pattern: args.pattern,
        path: args.path,
      })

    case 'pc_grep':
      return callPcAgent('/grep', {
        pattern: args.pattern,
        path: args.path,
        glob: args.glob,
        type: args.type,
        output_mode: args.output_mode,
        context: args.context,
        case_insensitive: args.case_insensitive,
      })

    case 'pc_shell':
      return callPcAgent('/shell', {
        command: args.command,
        cwd: args.cwd,
        timeout: args.timeout,
      })

    case 'pc_process_list':
      return callPcAgent('/process/list', undefined, 'GET')

    case 'pc_process_kill':
      return callPcAgent('/process/kill', { pid: args.pid })

    case 'pc_screenshot':
      return callPcAgent('/screenshot', undefined, 'GET')

    case 'pc_clipboard_get':
      return callPcAgent('/clipboard', undefined, 'GET')

    case 'pc_clipboard_set':
      return callPcAgent('/clipboard', { text: args.text })

    case 'pc_app_launch':
      return callPcAgent('/app/launch', { name: args.name, args: args.args })

    case 'pc_app_list':
      return callPcAgent('/app/list', undefined, 'GET')

    case 'pc_web_fetch':
      return callPcAgent('/web/fetch', { url: args.url })

    case 'pc_web_search_local':
      return callPcAgent('/web/search', { query: args.query, max_results: args.max_results })

    default:
      return `Unknown PC tool: ${toolName}`
  }
}
