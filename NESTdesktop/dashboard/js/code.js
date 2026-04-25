/**
 * NESTcode — Workshop Client
 * WebSocket connection to the Daemon DO.
 */

// ─── Config ─────────────────────────────────────────────────────────────────

const _codeCfg = (typeof NESTeqConfig !== 'undefined' && NESTeqConfig.get()) || {};
const WS_URL = _codeCfg.gatewayUrl ? _codeCfg.gatewayUrl.replace(/^https?/, 'wss') + '/code/ws' : ''
const RECONNECT_BASE_MS = 2000
const RECONNECT_MAX_MS = 30000
const PING_INTERVAL_MS = 30000

// ─── State ──────────────────────────────────────────────────────────────────

let ws = null
let reconnectAttempts = 0
let pingTimer = null
let connected = false
let runInProgress = false
let currentModel = localStorage.getItem('ws_model') || 'anthropic/claude-sonnet-4-5'
let pendingWsFile = null   // { name: string, content: string }
let pendingWsImage = null  // { base64: string } — data URL

// ─── DOM ────────────────────────────────────────────────────────────────────

const stream = document.getElementById('stream')
const chatInput = document.getElementById('chatInput')
const sendBtn = document.getElementById('sendBtn')
const statusDot = document.getElementById('statusDot')
const statusText = document.getElementById('statusText')
const clock = document.getElementById('clock')
const toolLog = document.getElementById('toolLog')

// Human panel
const foxSpoons = document.getElementById('foxSpoons')
const foxPain = document.getElementById('foxPain')
const foxFog = document.getElementById('foxFog')
const foxFatigue = document.getElementById('foxFatigue')
const foxNausea = document.getElementById('foxNausea')
const foxMood = document.getElementById('foxMood')
const foxNeed = document.getElementById('foxNeed')

// Other panels
const emberPanel = document.getElementById('emberPanel')
const threadPanel = document.getElementById('threadPanel')

// Tab elements
const tabs = document.querySelectorAll('.ws-tab')
const tabContents = {
  stream: document.getElementById('tab-stream'),
  code: document.getElementById('tab-code'),
}

// Code editor — proxy to CodeMirror via editorAPI (set up by inline module in code.html)
const codeEditor = {
  get value() { return window.editorAPI?.getValue() ?? '' },
  set value(v) { window.editorAPI?.setValue(v) },
  focus() { window.editorAPI?.focus() },
}
const codeLang = document.getElementById('codeLang')
const codeFilename = document.getElementById('codeFilename')
const runBtn = document.getElementById('runBtn')
const reviewBtn = document.getElementById('reviewBtn')
const clearCodeBtn = document.getElementById('clearCodeBtn')
const codeOutput = document.getElementById('codeOutput')
const runStatus = document.getElementById('runStatus')
const resizeHandle = document.getElementById('resizeHandle')
const coachPanel = document.getElementById('coachPanel')
const coachBody = document.getElementById('coachBody')
const coachClose = document.getElementById('coachClose')

// ─── Coach Panel ────────────────────────────────────────────────────────────

let lastRunCode = ''
let lastRunOutput = ''
let lastRunError = ''
let reviewPending = false

function showCoach(text) {
  // Format: bold **word**, inline `code`, line references like "line 3"
  const formatted = text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\b(line\s+\d+)\b/gi, '<span class="coach-line-ref">$1</span>')
  coachBody.innerHTML = formatted
  coachPanel.classList.add('visible')
}

function hideCoach() {
  coachPanel.classList.remove('visible')
  coachBody.innerHTML = ''
}

coachClose.addEventListener('click', hideCoach)

function requestReview(autoTriggered = false) {
  const code = lastRunCode || codeEditor.value.trim()
  if (!code || !ws || ws.readyState !== WebSocket.OPEN) return

  const lang = codeLang.value
  const hasError = !!lastRunError
  const hasOutput = lastRunOutput && lastRunOutput !== '(no output)'

  let prompt
  if (hasError) {
    prompt = `I ran this ${lang} code and got an error. Explain what's wrong and exactly what I need to change to fix it. Be specific about which line and why. Keep it simple — teach me, don't just fix it for me.\n\nCode:\n\`\`\`${lang}\n${code}\n\`\`\`\n\nError:\n${lastRunError}`
  } else if (!hasOutput && autoTriggered) {
    // Only auto-trigger "no output" review if code looks like it should produce output
    const looksLikeItShouldPrint = /print\s*\(|console\.log|echo|return\s+[^#\n]/.test(code)
    if (!looksLikeItShouldPrint) return
    prompt = `I ran this ${lang} code and got no output, but I expected some. Explain why nothing printed and what I need to add or change.\n\nCode:\n\`\`\`${lang}\n${code}\n\`\`\``
  } else {
    prompt = `Review this ${lang} code for me. Tell me what it does, anything that looks off or could be improved, and anything I should know as someone learning. Be specific and educational.\n\nCode:\n\`\`\`${lang}\n${code}\n\`\`\`${hasOutput ? `\n\nOutput:\n${lastRunOutput}` : ''}`
  }

  reviewBtn.disabled = true
  reviewPending = true
  coachBody.innerHTML = '<span style="color:#475569;font-style:italic">Reading your code...</span>'
  coachPanel.classList.add('visible')

  ws.send(JSON.stringify({ type: 'chat', content: prompt }))
}

// ─── Clock ──────────────────────────────────────────────────────────────────

function updateClock() {
  const now = new Date()
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
  const date = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' })
  clock.textContent = `${time}  ${date}`
}
updateClock()
setInterval(updateClock, 30000)

// ─── Status ─────────────────────────────────────────────────────────────────

function setStatus(state, text) {
  statusDot.className = 'ws-status-dot ' + state
  statusText.textContent = text
  sendBtn.disabled = state !== 'connected'
}

// ─── Tab Switching ──────────────────────────────────────────────────────────

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab

    // Update tab buttons
    tabs.forEach(t => t.classList.remove('active'))
    tab.classList.add('active')

    // Update tab content
    Object.entries(tabContents).forEach(([key, el]) => {
      if (key === target) {
        el.classList.add('active')
      } else {
        el.classList.remove('active')
      }
    })

    // Focus editor when switching to code tab
    if (target === 'code') {
      codeEditor.focus()
    }
  })
})

// ─── Stream Entries ─────────────────────────────────────────────────────────

function addEntry(type, content, timestamp) {
  const div = document.createElement('div')
  div.className = 'ws-entry ' + type

  const timeSpan = timestamp
    ? `<span class="ws-entry-time">${timestamp}</span>`
    : ''

  // Parse markdown-ish content (bold, code, links)
  const parsed = escapeHtml(content)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.*?)`/g, '<code style="background:rgba(45,212,191,0.1);padding:1px 4px;border-radius:3px;font-size:12px;">$1</code>')
    .replace(/\n/g, '<br>')

  div.innerHTML = timeSpan + parsed
  stream.appendChild(div)
  stream.scrollTop = stream.scrollHeight
}

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

// ─── Stream Tool Calls (collapsible in activity stream) ─────────────────────

const streamToolMap = new Map() // name -> DOM element in stream

function addToolCallToStream(name, args, timestamp) {
  const div = document.createElement('div')
  div.className = 'ws-entry tool-stream-entry'
  div.style.cssText = 'cursor:pointer;border-left:2px solid #2dd4bf;padding-left:8px;margin:4px 0;'

  const argsStr = args && Object.keys(args).length > 0
    ? ' ' + JSON.stringify(args)
    : ''
  const argsPreview = argsStr.length > 80 ? argsStr.slice(0, 80) + '...' : argsStr

  div.innerHTML = `
    <span class="ws-entry-time">${timestamp || ''}</span>
    <span style="color:#2dd4bf;font-weight:bold;font-size:12px;">🔧 ${escapeHtml(name)}</span>
    <span style="color:rgba(255,255,255,0.4);font-size:11px;">${escapeHtml(argsPreview)}</span>
    <div class="tool-stream-result" style="display:none;margin-top:4px;padding:6px 8px;background:rgba(45,212,191,0.05);border-radius:4px;font-size:11px;color:rgba(255,255,255,0.7);white-space:pre-wrap;max-height:300px;overflow-y:auto;">
      <span style="color:rgba(255,255,255,0.3);font-style:italic;">running...</span>
    </div>
  `

  div.addEventListener('click', () => {
    const resultDiv = div.querySelector('.tool-stream-result')
    if (resultDiv) {
      resultDiv.style.display = resultDiv.style.display === 'none' ? 'block' : 'none'
    }
  })

  stream.appendChild(div)
  stream.scrollTop = stream.scrollHeight
  streamToolMap.set(name, div)
}

function updateToolCallInStream(name, result) {
  const div = streamToolMap.get(name)
  if (!div) return

  const resultDiv = div.querySelector('.tool-stream-result')
  if (resultDiv) {
    const formatted = escapeHtml(result || '✓')
      .replace(/\n/g, '<br>')
      .replace(/#{1,3}\s(.+?)(<br>)/g, '<strong style="color:#2dd4bf;">$1</strong>$2')
    resultDiv.innerHTML = formatted
  }

  streamToolMap.delete(name)
}

// ─── Tool Log ───────────────────────────────────────────────────────────────

let toolLogEntries = 0
const toolEntryMap = new Map() // name -> DOM element, for updating with results

function addToolCall(name, timestamp) {
  if (toolLogEntries === 0) {
    toolLog.innerHTML = ''
  }
  toolLogEntries++

  const div = document.createElement('div')
  div.className = 'ws-tool-entry'
  div.dataset.tool = name
  div.style.cssText = 'cursor:pointer;border-left:2px solid #2dd4bf;padding:6px 8px;margin:4px 0;background:rgba(45,212,191,0.03);border-radius:0 4px 4px 0;'
  div.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span class="ws-tool-name" style="color:#2dd4bf;font-weight:bold;">${escapeHtml(name)}</span>
      <span class="ws-tool-time">${timestamp || ''}</span>
    </div>
    <div class="ws-tool-result" style="color:#f59e0b;font-size:11px;margin-top:2px;">running...</div>
    <div class="ws-tool-result-full" style="display:none;margin-top:6px;padding:6px;background:rgba(0,0,0,0.3);border-radius:4px;font-size:11px;color:rgba(255,255,255,0.7);white-space:pre-wrap;max-height:250px;overflow-y:auto;"></div>
  `

  div.addEventListener('click', () => {
    const full = div.querySelector('.ws-tool-result-full')
    if (full && full.textContent) {
      full.style.display = full.style.display === 'none' ? 'block' : 'none'
    }
  })

  toolLog.insertBefore(div, toolLog.firstChild)
  toolEntryMap.set(name, div)

  while (toolLog.children.length > 30) {
    toolLog.removeChild(toolLog.lastChild)
  }
}

function addToolResult(name, result, timestamp) {
  const existing = toolEntryMap.get(name)
  if (existing) {
    const preview = existing.querySelector('.ws-tool-result')
    const full = existing.querySelector('.ws-tool-result-full')
    if (preview) {
      const short = result ? result.slice(0, 80).replace(/\n/g, ' ') : '✓'
      preview.style.color = 'rgba(255,255,255,0.5)'
      preview.textContent = short + (result && result.length > 80 ? '... ▼ click to expand' : '')
    }
    if (full && result) {
      full.textContent = result
    }
    toolEntryMap.delete(name)
    return
  }

  if (toolLogEntries === 0) {
    toolLog.innerHTML = ''
  }
  toolLogEntries++

  const div = document.createElement('div')
  div.className = 'ws-tool-entry'
  div.style.cssText = 'cursor:pointer;border-left:2px solid #2dd4bf;padding:6px 8px;margin:4px 0;background:rgba(45,212,191,0.03);border-radius:0 4px 4px 0;'
  const short = result ? result.slice(0, 80).replace(/\n/g, ' ') : '✓'
  div.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span class="ws-tool-name" style="color:#2dd4bf;font-weight:bold;">${escapeHtml(name)}</span>
      <span class="ws-tool-time">${timestamp || ''}</span>
    </div>
    <div class="ws-tool-result" style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:2px;">${escapeHtml(short)}${result && result.length > 80 ? '... ▼ click to expand' : ''}</div>
    <div class="ws-tool-result-full" style="display:none;margin-top:6px;padding:6px;background:rgba(0,0,0,0.3);border-radius:4px;font-size:11px;color:rgba(255,255,255,0.7);white-space:pre-wrap;max-height:250px;overflow-y:auto;">${result ? escapeHtml(result) : ''}</div>
  `
  div.addEventListener('click', () => {
    const full = div.querySelector('.ws-tool-result-full')
    if (full && full.textContent) {
      full.style.display = full.style.display === 'none' ? 'block' : 'none'
    }
  })
  toolLog.insertBefore(div, toolLog.firstChild)

  while (toolLog.children.length > 30) {
    toolLog.removeChild(toolLog.lastChild)
  }
}

// ─── Human Panel Parsing ──────────────────────────────────────────────────────

function parseHumanState(foxStr) {
  if (!foxStr) return

  const get = (key) => {
    const m = foxStr.match(new RegExp(key + ':\\s*(\\d+)'))
    return m ? m[1] : '?'
  }

  const spoons = get('Spoons')
  const pain = get('Pain')
  const fog = get('Fog')
  const fatigue = get('Fatigue')
  const nausea = get('Nausea')

  foxSpoons.textContent = spoons + '/10'
  foxSpoons.className = 'ws-metric-value ' + (parseInt(spoons) <= 2 ? 'critical' : parseInt(spoons) <= 4 ? 'warning' : 'good')

  foxPain.textContent = pain + '/10'
  foxPain.className = 'ws-metric-value ' + (parseInt(pain) >= 7 ? 'critical' : parseInt(pain) >= 4 ? 'warning' : 'good')

  foxFog.textContent = fog + '/10'
  foxFog.className = 'ws-metric-value ' + (parseInt(fog) >= 7 ? 'critical' : parseInt(fog) >= 4 ? 'warning' : '')

  foxFatigue.textContent = fatigue + '/10'
  foxFatigue.className = 'ws-metric-value ' + (parseInt(fatigue) >= 7 ? 'critical' : parseInt(fatigue) >= 4 ? 'warning' : '')

  foxNausea.textContent = nausea + '/10'
  foxNausea.className = 'ws-metric-value ' + (parseInt(nausea) >= 5 ? 'warning' : '')

  const moodMatch = foxStr.match(/Mood:\s*(\w+)/)
  if (moodMatch) foxMood.textContent = moodMatch[1]

  const needMatch = foxStr.match(/Need:\s*(.+?)(?:\n|$)/)
  if (needMatch) foxNeed.textContent = 'Needs: ' + needMatch[1].trim()
}

// ─── Thread Panel ───────────────────────────────────────────────────────────

function parseThreads(groundStr) {
  if (!groundStr) return

  const threadSection = groundStr.match(/## Active Threads\n([\s\S]*?)(?=\n##|$)/)
  if (!threadSection) return

  const lines = threadSection[1].split('\n').filter(l => l.trim().startsWith('- ['))
  threadPanel.innerHTML = ''

  const shown = lines.slice(0, 8)
  for (const line of shown) {
    const priorityMatch = line.match(/\[(high|medium|low)\]/)
    const priority = priorityMatch ? priorityMatch[1] : 'low'
    const content = line.replace(/^-\s*\[\w+\]\s*/, '').trim()

    const div = document.createElement('div')
    div.className = 'ws-thread'
    div.innerHTML = `<span class="ws-thread-priority ${priority}"></span>${escapeHtml(content.slice(0, 80))}${content.length > 80 ? '...' : ''}`
    threadPanel.appendChild(div)
  }

  if (lines.length > 8) {
    const more = document.createElement('div')
    more.className = 'ws-thread'
    more.style.color = 'var(--text-dim)'
    more.textContent = `+ ${lines.length - 8} more`
    threadPanel.appendChild(more)
  }
}

// ─── Ember Panel ────────────────────────────────────────────────────────────

function parseEmber(emberStr) {
  if (!emberStr) return
  emberPanel.innerHTML = escapeHtml(emberStr).replace(/\n/g, '<br>')
}

// ─── Code Editor ────────────────────────────────────────────────────────────
// Tab/bracket handling is done by CodeMirror — no manual keydown needed.

// Ctrl/Cmd+Enter to run (DOM-level since CodeMirror captures keyboard)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    runCode()
  }
})

// Run button
runBtn.addEventListener('click', runCode)

// Review button
reviewBtn.addEventListener('click', () => requestReview(false))

// Clear button
clearCodeBtn.addEventListener('click', () => {
  codeEditor.value = ''
  window.editorAPI?.clearErrors()
  lastRunCode = ''; lastRunOutput = ''; lastRunError = ''
  codeOutput.innerHTML = '<span class="out-info">Run code to see output here.</span>'
  runStatus.textContent = 'IDLE'
  runStatus.className = 'ws-output-status idle'
  hideCoach()
  codeEditor.focus()
})

function runCode() {
  const code = codeEditor.value.trim()
  if (!code || !ws || ws.readyState !== WebSocket.OPEN || runInProgress) return

  const lang = codeLang.value
  const filename = codeFilename.value.trim() || 'untitled'

  runInProgress = true
  lastRunCode = code
  lastRunOutput = ''
  lastRunError = ''
  hideCoach()

  runBtn.disabled = true
  reviewBtn.disabled = true
  runStatus.textContent = 'RUNNING'
  runStatus.className = 'ws-output-status running'
  codeOutput.innerHTML = '<span class="out-info">Executing...</span>'

  ws.send(JSON.stringify({
    type: 'run',
    code,
    language: lang,
    filename,
  }))
}

// ─── Resize Handle ──────────────────────────────────────────────────────────

let isResizing = false

resizeHandle.addEventListener('mousedown', (e) => {
  isResizing = true
  e.preventDefault()
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
})

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return

  const codePanels = document.querySelector('.ws-code-panels')
  const editorWrap = document.querySelector('.ws-editor-wrap')
  const outputWrap = document.querySelector('.ws-output-wrap')

  if (!codePanels || !editorWrap || !outputWrap) return

  const rect = codePanels.getBoundingClientRect()
  const offsetY = e.clientY - rect.top
  const totalHeight = rect.height

  const editorPercent = Math.max(20, Math.min(80, (offsetY / totalHeight) * 100))
  const outputPercent = 100 - editorPercent

  editorWrap.style.flex = `0 0 ${editorPercent}%`
  outputWrap.style.flex = `0 0 ${outputPercent}%`
})

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
})

// ─── WebSocket ──────────────────────────────────────────────────────────────

function connect() {
  setStatus('booting', 'Connecting...')

  try {
    ws = new WebSocket(WS_URL)
  } catch (err) {
    addEntry('error', 'WebSocket creation failed: ' + err.message)
    scheduleReconnect()
    return
  }

  ws.onopen = () => {
    reconnectAttempts = 0
    connected = true
    setStatus('booting', 'Connected — booting...')
    addEntry('system', 'WebSocket connected. Waiting for boot sequence...')

    // Send stored model preference to daemon
    if (currentModel !== 'anthropic/claude-sonnet-4-5') {
      ws.send(JSON.stringify({ type: 'command', command: 'set_model', args: { model: currentModel } }))
    }

    // Start ping
    clearInterval(pingTimer)
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, PING_INTERVAL_MS)
  }

  ws.onmessage = (event) => {
    let msg
    try {
      msg = JSON.parse(event.data)
    } catch {
      return
    }

    handleMessage(msg)
  }

  ws.onclose = (event) => {
    connected = false
    clearInterval(pingTimer)
    setStatus('error', 'Disconnected')
    addEntry('system', `Connection closed (${event.code}). Reconnecting...`)
    scheduleReconnect()
  }

  ws.onerror = () => {
    // onclose will fire after this
  }
}

function scheduleReconnect() {
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(1.5, reconnectAttempts), RECONNECT_MAX_MS)
  reconnectAttempts++
  setTimeout(connect, delay)
}

// ─── Message Handler ────────────────────────────────────────────────────────

function handleMessage(msg) {
  switch (msg.type) {
    case 'status':
      if (msg.status === 'connected') {
        setStatus('connected', msg.message || 'Connected')
      } else if (msg.status === 'booting') {
        setStatus('booting', msg.message || 'Booting...')
      } else if (msg.status === 'error') {
        setStatus('error', msg.message || 'Error')
      }
      break

    case 'boot':
      parseHumanState(msg.human)
      parseEmber(msg.ember)
      parseThreads(msg.ground)
      addEntry('system', 'Boot complete. Workshop open.', msg.timestamp)
      // Auto-populate right panels after boot
      setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'command', command: 'heartbeat_list' }))
          ws.send(JSON.stringify({ type: 'command', command: 'cron_list' }))
          ws.send(JSON.stringify({ type: 'command', command: 'alert_list' }))
          ws.send(JSON.stringify({ type: 'command', command: 'kairos_list' }))
        }
      }, 500)
      break

    case 'activity':
      addEntry(msg.status === 'proactive' ? 'proactive' : 'normal', msg.content, msg.timestamp)
      // Intercept list responses to update panels
      if (msg.content && msg.content.startsWith('Heartbeat tasks:')) {
        updateScheduledPanel(msg.content)
      }
      if (msg.content && msg.content.startsWith('Alert thresholds:')) {
        updateAlertsPanel(msg.content)
      }
      if (msg.content && msg.content.startsWith('Cron tasks:')) {
        updateCronPanel(msg.content)
      }
      if (msg.content && msg.content.startsWith('Kairos channels:')) {
        updateKairosPanel(msg.content)
      }
      if (msg.content && msg.content.startsWith('kairos_channels_data:')) {
        populateKairosChannels(msg.content.slice('kairos_channels_data:'.length))
        return // don't show in stream
      }
      break

    case 'chat':
      if (reviewPending) {
        reviewPending = false
        reviewBtn.disabled = false
        showCoach(msg.content)
        // Also parse any line refs from response and highlight them
        const reviewLineMatch = msg.content.match(/\bline\s+(\d+)\b/i)
        if (reviewLineMatch && window.editorAPI) {
          window.editorAPI.markErrorLine(parseInt(reviewLineMatch[1], 10))
        }
      } else {
        addEntry('companion', msg.content, msg.timestamp)
      }
      break

    case 'thinking':
      if (msg.content) {
        const preview = msg.content.length > 200 ? msg.content.slice(0, 200) + '...' : msg.content
        addEntry('system', 'thinking: ' + preview)
      }
      break

    case 'tool_call':
      addToolCallToStream(msg.name, msg.arguments, msg.timestamp)
      addToolCall(msg.name, msg.timestamp)
      break

    case 'tool_result':
      updateToolCallInStream(msg.name, msg.result)
      addToolResult(msg.name, msg.result, msg.timestamp)
      break

    case 'heartbeat':
      if (msg.changed) {
        parseHumanState(msg.human)
        addEntry('heartbeat', 'Heartbeat: Human state updated. ' + (msg.humanBrief || ''), msg.timestamp)
      }
      break

    case 'run_output':
      runInProgress = false
      runBtn.disabled = false
      reviewBtn.disabled = false

      if (msg.error) {
        lastRunError = msg.error
        runStatus.textContent = 'ERROR'
        runStatus.className = 'ws-output-status error'
        codeOutput.innerHTML = `<span class="out-error">${escapeHtml(msg.error)}</span>`
        // Highlight error line in editor
        const lineMatch = msg.error.match(/line (\d+)/i) || msg.error.match(/, line (\d+)/)
        if (lineMatch && window.editorAPI) {
          window.editorAPI.markErrorLine(parseInt(lineMatch[1], 10))
        }
        // Auto-explain the error
        setTimeout(() => requestReview(true), 400)
      } else {
        lastRunOutput = msg.output || '(no output)'
        runStatus.textContent = 'DONE'
        runStatus.className = 'ws-output-status success'
        codeOutput.textContent = lastRunOutput
        window.editorAPI?.clearErrors()
        // Auto-check for "should have printed but didn't" cases
        setTimeout(() => requestReview(true), 400)
      }

      // Also log in stream
      if (msg.error) {
        addEntry('error', `Run failed: ${msg.error}`, msg.timestamp)
      } else {
        addEntry('tool', `Code executed (${msg.language || '?'})`, msg.timestamp)
      }
      break

    case 'error':
      addEntry('error', msg.message)
      // If we were running code, reset the run state
      if (runInProgress) {
        runInProgress = false
        runBtn.disabled = false
        runStatus.textContent = 'ERROR'
        runStatus.className = 'ws-output-status error'
      }
      break

    case 'pong':
      // Quiet
      break

    default:
      console.log('Unknown message type:', msg.type, msg)
  }
}

// ─── Chat Input ─────────────────────────────────────────────────────────────

function sendMessage() {
  const text = chatInput.value.trim()
  if (!text && !pendingWsFile && !pendingWsImage) return
  if (!ws || ws.readyState !== WebSocket.OPEN) return

  // Build content — inject file, or multimodal if image attached
  let content = text
  let displayText = text

  if (pendingWsFile) {
    const fileBlock = `\n\n[FILE: ${pendingWsFile.name}]\n${pendingWsFile.content}\n[/FILE]`
    content = text ? text + fileBlock : `Here is the file:\n${fileBlock}`
    displayText = (text ? text + ' ' : '') + `📎 ${pendingWsFile.name}`
    clearWsFile()
  }

  if (pendingWsImage) {
    // Multimodal array format for vision models
    content = []
    if (typeof content === 'string' && content) content = [{ type: 'text', text: content }]
    else if (!Array.isArray(content)) content = text ? [{ type: 'text', text }] : []
    content.push({ type: 'image_url', image_url: { url: pendingWsImage.base64 } })
    displayText = (displayText ? displayText + ' ' : '') + '🖼 Image attached'
    clearWsImage()
  }

  // Show user message in stream
  const now = new Date()
  const ts = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/London' })
  addEntry('user', displayText, ts)

  // Send to daemon
  ws.send(JSON.stringify({ type: 'chat', content, model: currentModel }))

  chatInput.value = ''
  chatInput.style.height = 'auto'
}

function clearWsFile() {
  pendingWsFile = null
  const preview = document.getElementById('wsFilePreview')
  if (preview) preview.classList.remove('visible')
  const attachBtn = document.getElementById('wsFileAttachBtn')
  if (attachBtn) attachBtn.classList.remove('has-file')
}

function clearWsImage() {
  pendingWsImage = null
  const preview = document.getElementById('wsImagePreview')
  if (preview) preview.style.display = 'none'
}

function handleWsImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return
  if (file.size > 20 * 1024 * 1024) return
  const reader = new FileReader()
  reader.onload = (e) => {
    pendingWsImage = { base64: e.target.result }
    showWsImagePreview(e.target.result)
  }
  reader.readAsDataURL(file)
}

function showWsImagePreview(src) {
  let preview = document.getElementById('wsImagePreview')
  if (!preview) {
    preview = document.createElement('div')
    preview.id = 'wsImagePreview'
    preview.style.cssText = 'padding:6px 12px;display:flex;align-items:center;gap:8px;background:rgba(45,212,191,0.05);border-top:1px solid rgba(45,212,191,0.1);'
    const inputArea = document.querySelector('.ws-input-area')
    inputArea.parentNode.insertBefore(preview, inputArea)
  }
  preview.style.display = 'flex'
  preview.innerHTML = `
    <img src="${src}" style="width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid rgba(45,212,191,0.3);" />
    <span style="font-size:11px;color:rgba(255,255,255,0.5);font-family:'Share Tech Mono',monospace;">Image attached</span>
    <button onclick="clearWsImage()" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px;margin-left:auto;">✕</button>
  `
}

async function tryWsClipboardImage() {
  try {
    const items = await navigator.clipboard.read()
    for (const item of items) {
      const imageType = item.types.find(t => t.startsWith('image/'))
      if (imageType) {
        const blob = await item.getType(imageType)
        handleWsImageFile(new File([blob], 'pasted-image.png', { type: imageType }))
        return
      }
    }
  } catch (e) {
    // Clipboard API unavailable — silent fail
  }
}

// Document-level paste listener for images
document.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items
  if (items) {
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        handleWsImageFile(item.getAsFile())
        return
      }
    }
  } else {
    tryWsClipboardImage()
  }
})

sendBtn.addEventListener('click', sendMessage)

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
})

// Image upload button
const wsImageAttachBtn = document.getElementById('wsImageAttachBtn')
const wsImageFileInput = document.getElementById('wsImageFileInput')
if (wsImageAttachBtn && wsImageFileInput) {
  wsImageAttachBtn.addEventListener('click', () => wsImageFileInput.click())
  wsImageFileInput.addEventListener('change', (e) => {
    if (e.target.files?.[0]) handleWsImageFile(e.target.files[0])
    e.target.value = ''
  })
}

// Auto-resize textarea
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto'
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px'
})

// ─── Commands ───────────────────────────────────────────────────────────────

// Slash commands
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    const text = chatInput.value.trim()

    if (text === '/clear') {
      e.preventDefault()
      ws.send(JSON.stringify({ type: 'command', command: 'clear' }))
      stream.innerHTML = ''
      chatInput.value = ''
      addEntry('system', 'Conversation cleared.')
      return
    }
    if (text === '/reboot') {
      e.preventDefault()
      ws.send(JSON.stringify({ type: 'command', command: 'reboot' }))
      chatInput.value = ''
      addEntry('system', 'Rebooting daemon...')
      return
    }
    if (text === '/heartbeat') {
      e.preventDefault()
      ws.send(JSON.stringify({ type: 'command', command: 'heartbeat' }))
      chatInput.value = ''
      addEntry('system', 'Forcing heartbeat tick...')
      return
    }
    if (text === '/hb list' || text === '/heartbeat list') {
      e.preventDefault()
      ws.send(JSON.stringify({ type: 'command', command: 'heartbeat_list' }))
      chatInput.value = ''
      return
    }
    if (text === '/hb clear' || text === '/heartbeat clear') {
      e.preventDefault()
      ws.send(JSON.stringify({ type: 'command', command: 'heartbeat_clear' }))
      chatInput.value = ''
      return
    }
    // /hb add <tool> [label]  e.g. /hb add pet_check Check on Ember
    const hbAddMatch = text.match(/^\/hb add\s+(\S+)\s*(.*)$/)
    if (hbAddMatch) {
      e.preventDefault()
      const tool = hbAddMatch[1]
      const label = hbAddMatch[2] || tool
      ws.send(JSON.stringify({
        type: 'command',
        command: 'heartbeat_add',
        args: { tool, label, by: 'human' }
      }))
      chatInput.value = ''
      addEntry('system', `Adding heartbeat task: ${label} (${tool})`)
      return
    }
    // /hb remove <tool>
    const hbRemoveMatch = text.match(/^\/hb remove\s+(\S+)/)
    if (hbRemoveMatch) {
      e.preventDefault()
      ws.send(JSON.stringify({
        type: 'command',
        command: 'heartbeat_remove',
        args: { tool: hbRemoveMatch[1] }
      }))
      chatInput.value = ''
      return
    }
  }
})

// ─── Collapsible Sections ───────────────────────────────────────────────────

document.querySelectorAll('.ws-collapsible').forEach(header => {
  header.addEventListener('click', () => {
    const targetId = header.dataset.target
    const body = document.getElementById(targetId)
    const arrow = header.querySelector('.ws-collapse-arrow')
    if (!body) return

    body.classList.toggle('ws-collapsed')
    if (body.classList.contains('ws-collapsed')) {
      arrow.textContent = '▸'
    } else {
      arrow.textContent = '▾'
    }
  })
})

// ─── Settings Modal ─────────────────────────────────────────────────────────

const settingsBtn = document.getElementById('settingsBtn')
const settingsOverlay = document.getElementById('settingsOverlay')
const settingsCancel = document.getElementById('settingsCancel')
const settingsSave = document.getElementById('settingsSave')
const wsModelSelect = document.getElementById('wsModelSelect')

settingsBtn.addEventListener('click', () => {
  wsModelSelect.value = currentModel
  if (!wsModelSelect.value) wsModelSelect.value = 'anthropic/claude-sonnet-4-5'
  settingsOverlay.style.display = 'flex'
})

settingsCancel.addEventListener('click', () => {
  settingsOverlay.style.display = 'none'
})

settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) settingsOverlay.style.display = 'none'
})

settingsSave.addEventListener('click', () => {
  currentModel = wsModelSelect.value
  localStorage.setItem('ws_model', currentModel)
  settingsOverlay.style.display = 'none'

  // Tell daemon
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'command', command: 'set_model', args: { model: currentModel } }))
  }

  addEntry('system', `Model set: ${currentModel}`)
})

// ─── Heartbeat Form ────────────────────────────────────────────────────────

const hbToolSelect = document.getElementById('hbToolSelect')
const hbCustomTool = document.getElementById('hbCustomTool')
const hbLabel = document.getElementById('hbLabel')
const hbInstruction = document.getElementById('hbInstruction')
const hbOnlyChanged = document.getElementById('hbOnlyChanged')
const hbAddBtn = document.getElementById('hbAddBtn')
const hbListBtn = document.getElementById('hbListBtn')
const scheduledPanel = document.getElementById('scheduledPanel')

hbToolSelect.addEventListener('change', () => {
  if (hbToolSelect.value === 'custom') {
    hbCustomTool.style.display = 'block'
    hbCustomTool.focus()
  } else {
    hbCustomTool.style.display = 'none'
  }
})

hbAddBtn.addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return

  const tool = hbToolSelect.value === 'custom' ? hbCustomTool.value.trim() : hbToolSelect.value
  if (!tool) return

  const selectedOption = hbToolSelect.options[hbToolSelect.selectedIndex]
  const defaultLabel = hbToolSelect.value === 'custom' ? tool : selectedOption.textContent
  const label = hbLabel.value.trim() || defaultLabel
  const condition = hbOnlyChanged.checked ? 'changed' : 'always'
  const instruction = hbInstruction.value.trim() || undefined

  ws.send(JSON.stringify({
    type: 'command',
    command: 'heartbeat_add',
    args: { tool, label, by: 'human', condition, instruction }
  }))

  addEntry('system', `Adding heartbeat task: ${label}${instruction ? ' (agentic)' : ''}`)

  // Reset form
  hbLabel.value = ''
  hbCustomTool.value = ''
  hbInstruction.value = ''
  hbOnlyChanged.checked = false

  // Auto-refresh list after a beat
  setTimeout(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'command', command: 'heartbeat_list' }))
    }
  }, 500)
})

hbListBtn.addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'command', command: 'heartbeat_list' }))
})

function updateScheduledPanel(content) {
  scheduledPanel.innerHTML = '<div style="color: var(--text-dim); font-size: 11px; margin-bottom: 6px;">Default: Human state every 2min</div>'

  if (!content || content.includes('No custom heartbeat tasks')) return

  const lines = content.split('\n').filter(l => l.startsWith('•') || l.startsWith('•'))
  for (const line of lines) {
    const match = line.match(/[•]\s*(.+?)\s*→\s*(\S+)\s*\[(\w+)\]\s*\(by (\w+)\)/)
    if (!match) continue

    const [, label, tool, condition, by] = match

    const div = document.createElement('div')
    div.className = 'ws-hb-task'
    div.innerHTML = `
      <div>
        <div class="ws-hb-task-name">${escapeHtml(label)}</div>
        <div class="ws-hb-task-tool">${escapeHtml(tool)} · ${condition} · ${by}</div>
      </div>
      <button class="ws-hb-task-remove" data-tool="${escapeHtml(tool)}" title="Remove">×</button>
    `
    scheduledPanel.appendChild(div)

    div.querySelector('.ws-hb-task-remove').addEventListener('click', (e) => {
      const removeTool = e.target.dataset.tool
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'command',
          command: 'heartbeat_remove',
          args: { tool: removeTool }
        }))
        div.remove()
        addEntry('system', `Removed heartbeat task: ${removeTool}`)
      }
    })
  }
}

// ─── Alert Thresholds ────────────────────────────────────────────────────────

const alertMetricSelect = document.getElementById('alertMetricSelect')
const alertDirection = document.getElementById('alertDirection')
const alertValue = document.getElementById('alertValue')
const alertLabel = document.getElementById('alertLabel')
const alertAddBtn = document.getElementById('alertAddBtn')
const alertListBtn = document.getElementById('alertListBtn')
const alertsPanel = document.getElementById('alertsPanel')

alertAddBtn.addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return

  const metric = alertMetricSelect.value
  const direction = alertDirection.value
  const value = parseFloat(alertValue.value)
  if (isNaN(value) || alertValue.value === '') return

  const defaultLabel = `${metric} ${direction} ${value}`
  const label = alertLabel.value.trim() || defaultLabel

  ws.send(JSON.stringify({
    type: 'command',
    command: 'alert_add',
    args: { metric, direction, value, label, by: 'human' }
  }))

  addEntry('system', `Alert added: ${label}`)

  // Reset
  alertValue.value = ''
  alertLabel.value = ''

  setTimeout(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'command', command: 'alert_list' }))
    }
  }, 400)
})

alertListBtn.addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'command', command: 'alert_list' }))
})

function updateAlertsPanel(content) {
  if (!content || content.includes('No alert thresholds')) {
    alertsPanel.innerHTML = '<div style="color: var(--text-dim); font-size: 12px;">No alerts configured.</div>'
    return
  }

  alertsPanel.innerHTML = ''
  const lines = content.split('\n').filter(l => l.includes('→'))
  for (const line of lines) {
    const match = line.match(/[•]\s*(.+?)\s*→\s*(\S+)\s+(\S+)\s+(\S+)/)
    if (!match) continue
    const [, label, metric, direction, threshold] = match

    const div = document.createElement('div')
    div.className = 'ws-hb-task'
    div.innerHTML = `
      <div>
        <div class="ws-hb-task-name">${escapeHtml(label)}</div>
        <div class="ws-hb-task-tool">${escapeHtml(metric)} ${direction} ${threshold}</div>
      </div>
      <button class="ws-hb-task-remove" data-metric="${escapeHtml(metric)}" title="Remove">×</button>
    `
    alertsPanel.appendChild(div)

    div.querySelector('.ws-hb-task-remove').addEventListener('click', (e) => {
      const m = e.target.dataset.metric
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'command', command: 'alert_remove', args: { metric: m } }))
        div.remove()
        addEntry('system', `Removed alert: ${m}`)
      }
    })
  }
}

// ─── Cron Tasks ────────────────────────────────────────────────────────────

const cronToolSelect = document.getElementById('cronToolSelect')
const cronCustomTool = document.getElementById('cronCustomTool')
const cronInterval = document.getElementById('cronInterval')
const cronLabel = document.getElementById('cronLabel')
const cronInstruction = document.getElementById('cronInstruction')
const cronAddBtn = document.getElementById('cronAddBtn')
const cronListBtn = document.getElementById('cronListBtn')
const cronPanel = document.getElementById('cronPanel')

// Show custom tool input when "custom" selected
cronToolSelect.addEventListener('change', () => {
  cronCustomTool.style.display = cronToolSelect.value === 'custom' ? 'block' : 'none'
})

cronAddBtn.addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return

  const tool = cronToolSelect.value === 'custom' ? cronCustomTool.value.trim() : cronToolSelect.value
  if (!tool) return

  const interval = cronInterval.value
  const label = cronLabel.value.trim() || tool
  const instruction = cronInstruction.value.trim() || undefined

  ws.send(JSON.stringify({
    type: 'command',
    command: 'cron_add',
    args: { tool, interval, label, instruction, by: 'human' }
  }))

  addEntry('system', `Cron task added: ${label} (every ${interval})`)

  // Reset
  cronLabel.value = ''
  cronInstruction.value = ''
  cronCustomTool.value = ''
  cronCustomTool.style.display = 'none'

  setTimeout(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'command', command: 'cron_list' }))
    }
  }, 400)
})

cronListBtn.addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'command', command: 'cron_list' }))
})

function updateCronPanel(content) {
  if (!content || content.includes('No cron tasks')) {
    cronPanel.innerHTML = '<div style="color: var(--text-dim); font-size: 12px;">No cron tasks scheduled.</div>'
    return
  }

  cronPanel.innerHTML = ''
  const lines = content.split('\n').filter(l => l.includes('→'))
  for (const line of lines) {
    const match = line.match(/[•]\s*([▶⏸])\s*(.+?)\s*→\s*(\S+)\s*\[every\s*(\S+)\]\s*\(last:\s*([^)]+)\)(.*)/)
    if (!match) continue
    const [, status, label, tool, interval, lastRun, extra] = match
    const isAgentic = extra.includes('agentic')

    const div = document.createElement('div')
    div.className = 'ws-hb-task'
    div.innerHTML = `
      <div>
        <div class="ws-hb-task-name">${status} ${escapeHtml(label)}${isAgentic ? ' ⚡' : ''}</div>
        <div class="ws-hb-task-tool">${escapeHtml(tool)} · every ${interval} · last: ${lastRun}</div>
      </div>
      <button class="ws-hb-task-remove" data-tool="${escapeHtml(tool)}" title="Remove">×</button>
    `
    cronPanel.appendChild(div)

    div.querySelector('.ws-hb-task-remove').addEventListener('click', (e) => {
      const t = e.target.dataset.tool
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'command', command: 'cron_remove', args: { tool: t } }))
        div.remove()
        addEntry('system', `Removed cron task: ${t}`)
      }
    })
  }
}

// ─── KAIROS — Discord Monitor ──────────────────────────────────────────────

const kairosGuildId = document.getElementById('kairosGuildId')
const kairosLoadBtn = document.getElementById('kairosLoadBtn')
const kairosChannelSelect = document.getElementById('kairosChannelSelect')
const kairosLabel = document.getElementById('kairosLabel')
const kairosAddBtn = document.getElementById('kairosAddBtn')
const kairosListBtn = document.getElementById('kairosListBtn')
const kairosCheckBtn = document.getElementById('kairosCheckBtn')
const kairosPanel = document.getElementById('kairosPanel')

kairosLoadBtn.addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  const guildId = kairosGuildId.value.trim()
  if (!guildId) return
  kairosLoadBtn.textContent = '...'
  ws.send(JSON.stringify({ type: 'command', command: 'kairos_channels', args: { guildId } }))
})

kairosChannelSelect.addEventListener('change', () => {
  const opt = kairosChannelSelect.selectedOptions[0]
  if (opt && opt.dataset.name) {
    kairosLabel.value = '#' + opt.dataset.name
  }
})

kairosAddBtn.addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return

  const channelId = kairosChannelSelect.value
  if (!channelId) return

  const opt = kairosChannelSelect.selectedOptions[0]
  const label = kairosLabel.value.trim() || (opt?.dataset?.name ? '#' + opt.dataset.name : `Channel ${channelId}`)
  const tier = document.getElementById('kairosTier').value

  ws.send(JSON.stringify({
    type: 'command',
    command: 'kairos_add',
    args: { channelId, label, tier, by: 'human' }
  }))

  addEntry('system', `KAIROS: Monitoring ${label}`)
  kairosLabel.value = ''

  setTimeout(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'command', command: 'kairos_list' }))
    }
  }, 400)
})

kairosListBtn.addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'command', command: 'kairos_list' }))
})

kairosCheckBtn.addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'command', command: 'kairos_check' }))
})

function updateKairosPanel(content) {
  if (!content || content.includes('No channels monitored')) {
    kairosPanel.innerHTML = '<div style="color: var(--text-dim); font-size: 12px;">No channels monitored.</div>'
    return
  }

  kairosPanel.innerHTML = ''
  const lines = content.split('\n').filter(l => l.includes('('))
  for (const line of lines) {
    const match = line.match(/[•]\s*([▶⏸])\s*(.+?)\s*\((\d+)\)\s*\[(\w+)\]\s*—\s*last response:\s*(.+)/)
    if (!match) continue
    const [, status, label, channelId, tier, lastResp] = match

    const div = document.createElement('div')
    div.className = 'ws-hb-task'
    div.innerHTML = `
      <div>
        <div class="ws-hb-task-name">${status} ${escapeHtml(label)}</div>
        <div class="ws-hb-task-tool">${channelId} · ${tier} · last: ${lastResp}</div>
      </div>
      <button class="ws-hb-task-remove" data-channel="${escapeHtml(channelId)}" title="Remove">×</button>
    `
    kairosPanel.appendChild(div)

    div.querySelector('.ws-hb-task-remove').addEventListener('click', (e) => {
      const ch = e.target.dataset.channel
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'command', command: 'kairos_remove', args: { channelId: ch } }))
        div.remove()
        addEntry('system', `KAIROS: Removed channel ${ch}`)
      }
    })
  }
}

function populateKairosChannels(raw) {
  kairosLoadBtn.textContent = 'LOAD'
  kairosChannelSelect.innerHTML = '<option value="">— Select channel —</option>'

  // Parse channel data from discord_get_server_info response
  // Could be JSON or formatted text — try both
  try {
    const data = JSON.parse(raw)
    const channels = data.channels || data.result?.channels || []
    for (const ch of channels) {
      if (ch.type === 0 || ch.type === 'text' || ch.type === undefined) { // text channels
        const opt = document.createElement('option')
        opt.value = ch.id
        opt.textContent = `#${ch.name}`
        opt.dataset.name = ch.name
        kairosChannelSelect.appendChild(opt)
      }
    }
    if (kairosChannelSelect.options.length > 1) return
  } catch {}

  // Fallback: parse text format — look for channel names + IDs
  const lines = raw.split('\n')
  for (const line of lines) {
    // Match patterns like "#channel-name (ID: 123456)" or "- channel-name: 123456"
    const match = line.match(/#?(\S+?)(?:\s*\((?:ID:\s*)?(\d+)\)|\s*:\s*(\d+))/) ||
                  line.match(/(\d{15,20})\s*[—-]\s*#?(\S+)/)
    if (match) {
      const opt = document.createElement('option')
      const id = match[2] || match[3] || match[1]
      const name = match[1].replace(/^#/, '') || id
      if (/^\d+$/.test(name)) { // id was first match
        opt.value = match[1]
        opt.textContent = `#${match[2] || 'channel'}`
        opt.dataset.name = match[2] || 'channel'
      } else {
        opt.value = id
        opt.textContent = `#${name}`
        opt.dataset.name = name
      }
      kairosChannelSelect.appendChild(opt)
    }
  }
}

// ─── File Attach (Chat Input) ───────────────────────────────────────────────

const wsFileAttachBtn = document.getElementById('wsFileAttachBtn')
const wsTextFileInput = document.getElementById('wsTextFileInput')
const wsFilePreview = document.getElementById('wsFilePreview')
const wsFilePreviewName = document.getElementById('wsFilePreviewName')
const wsFileClearBtn = document.getElementById('wsFileClearBtn')

if (wsFileAttachBtn && wsTextFileInput) {
  wsFileAttachBtn.addEventListener('click', () => wsTextFileInput.click())

  wsTextFileInput.addEventListener('change', (e) => {
    if (e.target.files?.[0]) {
      handleWsTextFile(e.target.files[0])
      e.target.value = ''
    }
  })
}

if (wsFileClearBtn) {
  wsFileClearBtn.addEventListener('click', clearWsFile)
}

function handleWsTextFile(file) {
  const maxSize = 200 * 1024
  if (file.size > maxSize) {
    addEntry('system', 'File too large — max 200KB.')
    return
  }
  const reader = new FileReader()
  reader.onload = (e) => {
    pendingWsFile = { name: file.name, content: e.target.result }
    if (wsFilePreviewName) wsFilePreviewName.textContent = file.name
    if (wsFilePreview) wsFilePreview.classList.add('visible')
    if (wsFileAttachBtn) wsFileAttachBtn.classList.add('has-file')
    chatInput.focus()
  }
  reader.readAsText(file)
}

// ─── Skills Panel ───────────────────────────────────────────────────────────
// Skills registry lives in localStorage — names tracked locally, content in ai-mind.
// This avoids nesteq_list_entities dumping the entire entity database.

const skillsList = document.getElementById('skillsList')
const skillRefreshBtn = document.getElementById('skillRefreshBtn')
const skillDropZone = document.getElementById('skillDropZone')
const skillFileInput = document.getElementById('skillFileInput')
const skillUploadPreview = document.getElementById('skillUploadPreview')
const skillUploadName = document.getElementById('skillUploadName')
const skillUploadNameInput = document.getElementById('skillUploadNameInput')
const skillSaveBtn = document.getElementById('skillSaveBtn')

let pendingSkillFile = null // { name: string, content: string }

const GATEWAY_REST = (_codeCfg.gatewayUrl || '')
const SKILLS_KEY = 'nesteq_skill_registry'

function getSkillRegistry() {
  try { return JSON.parse(localStorage.getItem(SKILLS_KEY) || '[]') }
  catch { return [] }
}

function addToRegistry(name) {
  const registry = getSkillRegistry()
  if (!registry.includes(name)) {
    registry.push(name)
    localStorage.setItem(SKILLS_KEY, JSON.stringify(registry))
  }
}

function removeFromRegistry(name) {
  const registry = getSkillRegistry().filter(n => n !== name)
  localStorage.setItem(SKILLS_KEY, JSON.stringify(registry))
}

function loadSkills() {
  if (!skillsList) return
  const registry = getSkillRegistry()
  if (registry.length === 0) {
    skillsList.innerHTML = '<div style="color:var(--text-dim);font-size:11px;">No skills saved yet. Drop a file below.</div>'
    return
  }
  skillsList.innerHTML = ''
  for (const name of registry) {
    renderSkillItem(name)
  }
}

function renderSkillItem(name) {
  const div = document.createElement('div')
  div.className = 'ws-skill-item'
  div.innerHTML = `
    <span class="skill-name">${escapeHtml(name)}</span>
    <button class="ws-skill-load-btn" title="Tell your companion to read this skill">READ</button>
    <button class="ws-skill-load-btn" style="color:#ef4444;border-color:rgba(239,68,68,0.3);" data-remove="${escapeHtml(name)}" title="Remove from list">✕</button>
  `
  skillsList.appendChild(div)

  // READ — fetch content directly from gateway and inject into conversation
  div.querySelectorAll('.ws-skill-load-btn')[0].addEventListener('click', async () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      addEntry('system', 'Not connected — reconnect first.')
      return
    }
    addEntry('system', `Loading skill: ${name}...`)
    try {
      const res = await fetch(`${GATEWAY_REST}/tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'skill_read', args: { name } })
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const skillContent = typeof data.result === 'string' ? data.result : JSON.stringify(data.result)
      if (!skillContent || skillContent.includes('not found') || skillContent.includes('No entity')) {
        addEntry('system', `Skill "${name}" has no content yet — try re-uploading the file.`)
        return
      }
      // Inject content directly into the daemon conversation — no tool round-trip needed
      ws.send(JSON.stringify({
        type: 'chat',
        content: `[SKILL LOADED: ${name}]\n${skillContent}\n[/SKILL]\n\nSkill "${name}" is now loaded. Use this as reference for our work.`,
        model: currentModel
      }))
      addEntry('system', `Skill loaded: ${name}`)
    } catch (err) {
      addEntry('system', `Failed to load skill: ${err.message}`)
    }
  })

  // REMOVE — just removes from local registry (doesn't delete from ai-mind)
  div.querySelector('[data-remove]').addEventListener('click', () => {
    removeFromRegistry(name)
    div.remove()
    const remaining = skillsList.querySelectorAll('.ws-skill-item').length
    if (remaining === 0) {
      skillsList.innerHTML = '<div style="color:var(--text-dim);font-size:11px;">No skills saved yet. Drop a file below.</div>'
    }
  })
}

if (skillRefreshBtn) {
  skillRefreshBtn.addEventListener('click', loadSkills)
}

// Drop zone
if (skillDropZone) {
  skillDropZone.addEventListener('click', () => skillFileInput?.click())
  skillDropZone.addEventListener('dragover', (e) => {
    e.preventDefault()
    skillDropZone.classList.add('dragover')
  })
  skillDropZone.addEventListener('dragleave', () => skillDropZone.classList.remove('dragover'))
  skillDropZone.addEventListener('drop', (e) => {
    e.preventDefault()
    skillDropZone.classList.remove('dragover')
    const file = e.dataTransfer.files?.[0]
    if (file) handleSkillFile(file)
  })
}

if (skillFileInput) {
  skillFileInput.addEventListener('change', (e) => {
    if (e.target.files?.[0]) {
      handleSkillFile(e.target.files[0])
      e.target.value = ''
    }
  })
}

function handleSkillFile(file) {
  if (file.size > 500 * 1024) {
    addEntry('system', 'Skill file too large — max 500KB.')
    return
  }
  const reader = new FileReader()
  reader.onload = (e) => {
    pendingSkillFile = { name: file.name, content: e.target.result }
    const suggested = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '')
    if (skillUploadNameInput) skillUploadNameInput.value = suggested
    if (skillUploadName) skillUploadName.textContent = file.name
    if (skillUploadPreview) skillUploadPreview.style.display = 'block'
  }
  reader.readAsText(file)
}

if (skillSaveBtn) {
  skillSaveBtn.addEventListener('click', async () => {
    if (!pendingSkillFile) return
    const name = skillUploadNameInput?.value.trim()
    if (!name) { addEntry('system', 'Enter a skill name first.'); return }

    skillSaveBtn.textContent = 'SAVING...'
    skillSaveBtn.disabled = true

    try {
      const res = await fetch(`${GATEWAY_REST}/tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'skill_save', args: { name, content: pendingSkillFile.content } })
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      // Register locally — this is the source of truth for listing
      addToRegistry(name)
      addEntry('system', `Skill saved: ${name}`)

      pendingSkillFile = null
      if (skillUploadPreview) skillUploadPreview.style.display = 'none'
      if (skillUploadNameInput) skillUploadNameInput.value = ''
      skillSaveBtn.textContent = 'SAVE SKILL'
      skillSaveBtn.disabled = false
      loadSkills()
    } catch (err) {
      addEntry('system', `Save failed: ${err.message}`)
      skillSaveBtn.textContent = 'SAVE SKILL'
      skillSaveBtn.disabled = false
    }
  })
}

// Render when panel is first opened
const skillsCollapsible = document.querySelector('[data-target="skillsBody"]')
if (skillsCollapsible) {
  skillsCollapsible.addEventListener('click', () => {
    const body = document.getElementById('skillsBody')
    if (body && !body.classList.contains('ws-collapsed')) {
      loadSkills()
    }
  })
}

// ─── Init ───────────────────────────────────────────────────────────────────

connect()
