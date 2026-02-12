// @ts-check
/// <reference types="../preload" />

/**
 * Sefaria Desktop – Renderer Process
 *
 * This file runs in Chromium (the Electron renderer). It talks to the
 * main process through the `window.sefaria` API exposed by preload.ts.
 */

/** @type {import('../preload').SefariaApi} */
const api = /** @type {any} */ (window).sefaria;

// ── DOM elements ──────────────────────────────────────────────────────
const setupOverlay   = /** @type {HTMLDivElement}       */ (document.getElementById('setup-overlay'));
const setupProvider  = /** @type {HTMLSelectElement}     */ (document.getElementById('setup-provider'));
const setupApiKey    = /** @type {HTMLInputElement}      */ (document.getElementById('setup-api-key'));
const setupSaveBtn   = /** @type {HTMLButtonElement}     */ (document.getElementById('setup-save-btn'));
const setupKeyLink   = /** @type {HTMLAnchorElement}     */ (document.getElementById('setup-key-link'));

const settingsPanel  = /** @type {HTMLDivElement}       */ (document.getElementById('settings-panel'));
const settingsProvider = /** @type {HTMLSelectElement}   */ (document.getElementById('settings-provider'));
const settingsModel  = /** @type {HTMLSelectElement}     */ (document.getElementById('settings-model'));
const settingsApiKey = /** @type {HTMLInputElement}      */ (document.getElementById('settings-api-key'));
const settingsSave   = /** @type {HTMLButtonElement}     */ (document.getElementById('settings-save-btn'));
const settingsKeyHint = /** @type {HTMLParagraphElement} */ (document.getElementById('settings-key-hint'));
const settingsBtn    = /** @type {HTMLButtonElement}     */ (document.getElementById('settings-btn'));
const reconnectBtn   = /** @type {HTMLButtonElement}     */ (document.getElementById('reconnect-btn'));
const mcpBadge       = /** @type {HTMLSpanElement}       */ (document.getElementById('mcp-badge'));

const modelPicker    = /** @type {HTMLSelectElement}    */ (document.getElementById('model-picker-select'));

const messagesDiv    = /** @type {HTMLDivElement}       */ (document.getElementById('messages'));
const chatContainer  = /** @type {HTMLDivElement}       */ (document.getElementById('chat-container'));
const messageInput   = /** @type {HTMLTextAreaElement}   */ (document.getElementById('message-input'));
const sendBtn        = /** @type {HTMLButtonElement}     */ (document.getElementById('send-btn'));
const clearBtn       = /** @type {HTMLButtonElement}     */ (document.getElementById('clear-btn'));

const historyBtn       = /** @type {HTMLButtonElement}  */ (document.getElementById('history-btn'));
const historySidebar   = /** @type {HTMLDivElement}     */ (document.getElementById('history-sidebar'));
const closeSidebarBtn  = /** @type {HTMLButtonElement}  */ (document.getElementById('close-sidebar-btn'));
const historyList      = /** @type {HTMLDivElement}     */ (document.getElementById('history-list'));
const newChatBtn       = /** @type {HTMLButtonElement}  */ (document.getElementById('new-chat-btn'));

// ── State ─────────────────────────────────────────────────────────────
let isStreaming   = false;
let currentChatId = /** @type {string|null} */ (null);
let sidebarOpen   = false;

/** @type {Array<{id: string, name: string, models: Array<{id: string, name: string}>, defaultModel: string, requiresKey?: boolean, keyPlaceholder: string, keyHelpUrl: string, keyHelpLabel: string}>} */
let providers = [];
let activeProviderId = 'gemini';
let activeModelId = '';

// ── Auto-linkify bare Sefaria citations ───────────────────────────────
/**
 * Detect bare text references (e.g. "Genesis 1:1", "Berakhot 2a") in
 * markdown and wrap them in Sefaria links.  Already-linked references
 * and inline code spans are left untouched.
 */
function linkifyCitations(md) {
    /** Protect existing markdown links & code so we don't double-link. */
    function protect(text) {
        const saved = [];
        const s = text.replace(/\[([^\]]*)\]\([^)]*\)|`[^`]+`/g, (m) => {
            saved.push(m);
            return `\x00S${saved.length - 1}\x00`;
        });
        return { text: s, saved };
    }
    function restore(text, saved) {
        let s = text;
        for (let i = 0; i < saved.length; i++) {
            s = s.replace(`\x00S${i}\x00`, () => saved[i]);
        }
        return s;
    }
    /** Build a Sefaria URL from a reference string. */
    function sefUrl(ref) {
        return 'https://www.sefaria.org/' + ref.trim().replace(/ /g, '_').replace(/:/g, '.');
    }
    /** Run one linkification regex, protecting existing links each time. */
    function pass(text, regex) {
        const { text: s, saved } = protect(text);
        const out = s.replace(regex, (match) => `[${match}](${sefUrl(match)})`);
        return restore(out, saved);
    }

    // ── Pattern building ──────────────────────────────────────────────
    const commentators = [
        'Siftei Chakhamim', 'Or HaChaim', 'Kli Yakar',
        'Ibn Ezra', 'Tosafot', 'Rashbam', 'Onkelos', 'Sforno',
        'Ramban', 'Rashi',
    ].join('|');

    const tractates = [
        'Rosh Hashanah', 'Avodah Zarah', 'Moed Katan',
        'Bava Kamma', 'Bava Metzia', 'Bava Batra',
        'Berakhot', 'Pesachim', 'Shekalim', 'Chagigah',
        'Yevamot', 'Ketubot', 'Kiddushin', 'Sanhedrin',
        'Menachot', 'Bekhorot', 'Shabbat', 'Eruvin',
        'Sukkah', 'Beitzah', 'Taanit', 'Megillah',
        'Nedarim', 'Shevuot', 'Horayot', 'Zevachim',
        'Chullin', 'Arakhin', 'Temurah', 'Keritot',
        'Meilah', 'Makkot', 'Gittin', 'Nazir', 'Sotah',
        'Tamid', 'Niddah', 'Yoma',
    ].join('|');

    const tanakhBooks = [
        'Song of Songs', 'Shir HaShirim',
        'Deuteronomy', 'Ecclesiastes', 'Lamentations',
        'I Chronicles', 'II Chronicles', '1 Chronicles', '2 Chronicles',
        'I Samuel', 'II Samuel', '1 Samuel', '2 Samuel',
        'I Kings', 'II Kings', '1 Kings', '2 Kings',
        'Leviticus', 'Yeshayahu', 'Yirmiyahu', 'Yechezkel',
        'Bereishit', 'Bereshit', 'Habakkuk', 'Zephaniah',
        'Zechariah', 'Nehemiah', 'Jeremiah',
        'Genesis', 'Exodus', 'Numbers', 'Shemot', 'Vayikra',
        'Bamidbar', 'Devarim', 'Joshua', 'Judges', 'Isaiah',
        'Ezekiel', 'Psalms', 'Proverbs', 'Esther', 'Daniel',
        'Malachi', 'Haggai', 'Obadiah', 'Tehillim', 'Mishlei',
        'Kohelet', 'Yehoshua', 'Shoftim',
        'Hosea', 'Micah', 'Nahum', 'Jonah', 'Eicha',
        'Joel', 'Amos', 'Ruth', 'Ezra', 'Job',
    ].join('|');

    const otherWorks = [
        'Pirkei DeRabbi Eliezer', 'Midrash Tanchuma',
        'Beresheet Rabbah', 'Shemot Rabbah', 'Vayikra Rabbah',
        'Bamidbar Rabbah', 'Devarim Rabbah',
        'Mishnah Berakhot', 'Mishnah Shabbat', 'Mishnah Pesachim',
        'Mishnah Yoma', 'Mishnah Sukkah', 'Mishnah Taanit',
        'Mishnah Megillah', 'Mishnah Sanhedrin', 'Mishnah Avot',
        'Shulchan Arukh', 'Mishneh Torah',
        'Pirkei Avot', 'Avot',
    ].join('|');

    let s = md;

    // 1. "Commentator on Book Chapter:Verse"
    const commentRe = new RegExp(
        `((?:${commentators})\\s+on\\s+[A-Z][A-Za-z]+(?:\\s+[A-Za-z]+)*\\s+\\d+[:\\.]\\d+(?:[\\-\u2013]\\d+)?)`,
        'g'
    );
    s = pass(s, commentRe);

    // 2. Talmud daf: "Tractate 2a" or "Tractate 2a-2b"
    const talmudRe = new RegExp(
        `((?:${tractates})\\s+\\d+[ab](?:[\\-\u2013]\\d+[ab])?)`,
        'g'
    );
    s = pass(s, talmudRe);

    // 3. Tanakh: "Book Chapter:Verse" (or Chapter.Verse)
    const tanakhRe = new RegExp(
        `((?:${tanakhBooks})\\s+\\d+[:\\.]\\d+(?:[\\-\u2013]\\d+)?)`,
        'g'
    );
    s = pass(s, tanakhRe);

    // 4. Other works: "Work Chapter:Verse"
    const otherRe = new RegExp(
        `((?:${otherWorks})\\s+\\d+[:\\.]\\d+(?:[\\-\u2013]\\d+)?)`,
        'g'
    );
    s = pass(s, otherRe);

    return s;
}

// ── Mermaid setup ─────────────────────────────────────────────────────
if (typeof mermaid !== 'undefined') {
    mermaid.initialize({ startOnLoad: false, theme: 'default' });
}
let mermaidIdCounter = 0;

/**
 * Render a Mermaid code block into an SVG diagram.
 * Returns an HTML string with the rendered diagram or the raw code on failure.
 */
async function renderMermaidBlock(code) {
    if (typeof mermaid === 'undefined') {
        return `<pre><code class="language-mermaid">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
    }
    const id = `mermaid-${++mermaidIdCounter}`;
    try {
        const { svg } = await mermaid.render(id, code);
        return `<div class="mermaid-diagram">${svg}</div>`;
    } catch {
        return `<pre><code class="language-mermaid">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
    }
}

// ── Markdown helper (uses the `marked` library loaded via CDN) ────────
function renderMarkdown(text) {
    if (typeof marked !== 'undefined' && marked.parse) {
        const renderer = new marked.Renderer();
        // Override link rendering to prevent default navigation
        renderer.link = function({ href, title, text }) {
            const titleAttr = title ? ` title="${title}"` : '';
            return `<a href="${href}"${titleAttr} data-external="true">${text}</a>`;
        };
        // Collect mermaid blocks and replace with placeholders for async rendering
        const mermaidBlocks = [];
        const originalCode = renderer.code;
        renderer.code = function({ text: codeText, lang }) {
            if (lang === 'mermaid') {
                const placeholder = `<!--MERMAID_PLACEHOLDER_${mermaidBlocks.length}-->`;
                mermaidBlocks.push(codeText);
                return placeholder;
            }
            if (originalCode) {
                return originalCode.call(this, { text: codeText, lang });
            }
            const escaped = codeText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<pre><code class="language-${lang || ''}">${escaped}</code></pre>`;
        };
        let html = marked.parse(linkifyCitations(text), { breaks: true, renderer });
        // If there were mermaid blocks, schedule async rendering
        if (mermaidBlocks.length > 0) {
            // Store the blocks for post-render processing
            html = html.replace(/data-mermaid-pending/g, '');
            for (let i = 0; i < mermaidBlocks.length; i++) {
                const placeholder = `<!--MERMAID_PLACEHOLDER_${i}-->`;
                const tempId = `mermaid-pending-${mermaidIdCounter + i + 1}`;
                html = html.replace(placeholder,
                    `<div class="mermaid-diagram" id="${tempId}" data-mermaid-src="${encodeURIComponent(mermaidBlocks[i])}">` +
                    `<div class="mermaid-loading">Rendering diagram…</div></div>`);
            }
        }
        return html;
    }
    // Fallback: escape HTML and convert newlines
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
}

/**
 * Post-process rendered HTML to render any pending Mermaid diagrams.
 * Call this after setting innerHTML with renderMarkdown output.
 */
async function renderPendingMermaid(container) {
    if (typeof mermaid === 'undefined') return;
    const pendingDivs = container.querySelectorAll('.mermaid-diagram[data-mermaid-src]');
    for (const div of pendingDivs) {
        const src = decodeURIComponent(div.getAttribute('data-mermaid-src'));
        div.removeAttribute('data-mermaid-src');
        const id = `mermaid-${++mermaidIdCounter}`;
        try {
            const { svg } = await mermaid.render(id, src);
            div.innerHTML = svg;
        } catch {
            div.innerHTML = `<pre><code class="language-mermaid">${src.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
        }
    }
}

// ── Scrolling ─────────────────────────────────────────────────────────
function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ── Tool name descriptions ────────────────────────────────────────────
/** Map MCP tool names to user-friendly "in progress" labels */
function describeToolCall(toolName) {
    const map = {
        'get_text':               'Looking up text…',
        'text_search':            'Searching texts…',
        'english_semantic_search':'Searching texts…',
        'search_in_book':         'Searching in book…',
        'search_in_dictionaries': 'Looking up in dictionaries…',
        'get_links_between_texts':'Finding connections…',
        'get_topic_details':      'Loading topic details…',
        'get_english_translations':'Fetching translations…',
        'get_text_catalogue_info':'Loading catalogue info…',
        'get_text_or_category_shape':'Checking text structure…',
        'get_current_calendar':   'Checking calendar…',
        'get_available_manuscripts':'Finding manuscripts…',
        'get_manuscript_image':   'Loading manuscript image…',
        'clarify_name_argument':  'Resolving reference…',
        'clarify_search_path_filter':'Resolving search path…',
    };
    return map[toolName] || `Calling ${toolName}…`;
}

/** Map MCP tool names to user-friendly "done" labels */
function describeToolDone(toolName) {
    const map = {
        'get_text':               'Looked up text',
        'text_search':            'Searched texts',
        'english_semantic_search':'Searched texts',
        'search_in_book':         'Searched in book',
        'search_in_dictionaries': 'Looked up in dictionaries',
        'get_links_between_texts':'Found connections',
        'get_topic_details':      'Loaded topic details',
        'get_english_translations':'Fetched translations',
        'get_text_catalogue_info':'Loaded catalogue info',
        'get_text_or_category_shape':'Checked text structure',
        'get_current_calendar':   'Checked calendar',
        'get_available_manuscripts':'Found manuscripts',
        'get_manuscript_image':   'Loaded manuscript image',
        'clarify_name_argument':  'Resolved reference',
        'clarify_search_path_filter':'Resolved search path',
    };
    return map[toolName] || `Called ${toolName}`;
}

// ── UI helpers ────────────────────────────────────────────────────────
function setMcpBadge(status, label) {
    mcpBadge.textContent = label;
    mcpBadge.className = 'badge badge-' + status;
}

function showSetup() {
    setupOverlay.classList.remove('hidden');
}

function hideSetup() {
    setupOverlay.classList.add('hidden');
}

function toggleSettings() {
    const isOpening = settingsPanel.classList.contains('hidden');
    settingsPanel.classList.toggle('hidden');
    // Hide/show chat content so settings takes the full area
    chatContainer.classList.toggle('hidden', isOpening);
    document.getElementById('input-area').classList.toggle('hidden', isOpening);
    document.getElementById('rate-limit-bar').classList.toggle('hidden', isOpening);
    document.getElementById('donate-bar').classList.toggle('hidden', isOpening);
    if (isOpening) refreshActivatedProviders();
}

function clearWelcome() {
    const welcome = messagesDiv.querySelector('.welcome-message');
    if (welcome) welcome.remove();
}

// ── Message rendering ─────────────────────────────────────────────────
function addUserMessage(text) {
    clearWelcome();
    const el = document.createElement('div');
    el.className = 'message message-user';
    el.innerHTML = `
        <div class="message-avatar">You</div>
        <div class="message-body">
            <div class="message-content">${escapeHtml(text)}</div>
        </div>`;
    messagesDiv.appendChild(el);
    scrollToBottom();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Show follow-up suggestion chips after an assistant response.
 */
function showFollowUps(suggestions) {
    // Remove any previous follow-up chips
    const old = messagesDiv.querySelector('.follow-ups');
    if (old) old.remove();

    const container = document.createElement('div');
    container.className = 'follow-ups';

    for (const text of suggestions) {
        const chip = document.createElement('button');
        chip.className = 'follow-up-chip';
        chip.textContent = text;
        chip.addEventListener('click', () => {
            // Remove chips once one is clicked
            container.remove();
            messageInput.value = text;
            autoResize();
            sendMessage();
        });
        container.appendChild(chip);
    }

    messagesDiv.appendChild(container);
    scrollToBottom();
}

/**
 * Create an assistant message bubble and return an object to stream into it.
 */
function createAssistantMessage() {
    clearWelcome();
    const el = document.createElement('div');
    el.className = 'message message-assistant';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    const toolsDiv = document.createElement('div');
    toolsDiv.className = 'tool-indicators';

    // Thinking indicator – shown immediately, hidden on first content
    const thinkingDiv = document.createElement('div');
    thinkingDiv.className = 'thinking-indicator';
    thinkingDiv.innerHTML = `<div class="thinking-dots"><span></span><span></span><span></span></div><span class="thinking-label">Thinking…</span>`;

    const bodyDiv = document.createElement('div');
    bodyDiv.className = 'message-body';
    bodyDiv.appendChild(thinkingDiv);
    bodyDiv.appendChild(toolsDiv);
    bodyDiv.appendChild(contentDiv);

    el.innerHTML = `<div class="message-avatar"><svg viewBox="0 0 100 120" width="24" height="24" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="5" width="10" height="110" rx="5" fill="#8B6914"/><rect x="82" y="5" width="10" height="110" rx="5" fill="#8B6914"/><rect x="18" y="12" width="64" height="96" rx="3" fill="#FFF8E7"/><line x1="28" y1="30" x2="72" y2="30" stroke="#8B6914" stroke-width="1.5"/><line x1="28" y1="45" x2="72" y2="45" stroke="#8B6914" stroke-width="1.5"/><line x1="28" y1="60" x2="72" y2="60" stroke="#8B6914" stroke-width="1.5"/><line x1="28" y1="75" x2="72" y2="75" stroke="#8B6914" stroke-width="1.5"/><line x1="28" y1="90" x2="60" y2="90" stroke="#8B6914" stroke-width="1.5"/></svg></div>`;
    el.appendChild(bodyDiv);
    messagesDiv.appendChild(el);
    scrollToBottom();

    let rawText = '';
    let thinkingVisible = true;

    function hideThinking() {
        if (thinkingVisible) {
            thinkingDiv.remove();
            thinkingVisible = false;
        }
    }

    return {
        appendChunk(chunk) {
            hideThinking();
            rawText += chunk;
            contentDiv.innerHTML = renderMarkdown(rawText);
            renderPendingMermaid(contentDiv);
            scrollToBottom();
        },
        addToolIndicator(toolName) {
            // Replace "Thinking…" with tool-specific status once tools start
            hideThinking();
            const indicator = document.createElement('div');
            indicator.className = 'tool-indicator';
            indicator.dataset.tool = toolName;
            // Show user-friendly description based on tool name
            const friendlyLabel = describeToolCall(toolName);
            indicator.innerHTML = `<div class="spinner"></div> <span>${escapeHtml(friendlyLabel)}</span>`;
            toolsDiv.appendChild(indicator);
            scrollToBottom();
            return indicator;
        },
        markToolDone(toolName) {
            const indicator = toolsDiv.querySelector(`[data-tool="${CSS.escape(toolName)}"]`);
            if (indicator) {
                const friendlyLabel = describeToolDone(toolName);
                indicator.innerHTML = `<span class="tool-done">✓</span> <span>${escapeHtml(friendlyLabel)}</span>`;
            }
        },
        showError(msg, retryable) {
            let html = `<div class="error-message">`;
            html += `<span class="error-text">${escapeHtml(msg)}</span>`;
            if (retryable) {
                html += `<button class="retry-btn">Try again</button>`;
            }
            html += `</div>`;
            contentDiv.innerHTML = html;
            // Wire up retry button with proper event listener (inline onclick blocked by CSP)
            const retryBtn = contentDiv.querySelector('.retry-btn');
            if (retryBtn) {
                retryBtn.addEventListener('click', () => {
                    if (lastUserMessage && !isStreaming) {
                        messageInput.value = lastUserMessage;
                        autoResize();
                        sendMessage();
                    }
                });
            }
            scrollToBottom();
        },
        finalize() {
            // Re-render final markdown to pick up any partial flush
            if (rawText) {
                contentDiv.innerHTML = renderMarkdown(rawText);
                renderPendingMermaid(contentDiv);
            }
            scrollToBottom();
        }
    };
}

// ── Send message flow ─────────────────────────────────────────────────
let currentAssistantMsg = /** @type {ReturnType<typeof createAssistantMessage>|null} */ (null);let lastUserMessage = '';
// ── Response length selector ──────────────────────────────────────────
let responseLength = 'concise';
document.querySelectorAll('.length-option').forEach((btn) => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.length-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        responseLength = /** @type {HTMLElement} */ (btn).dataset.length || 'balanced';
    });
});

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || isStreaming) return;

    isStreaming = true;
    sendBtn.disabled = true;
    messageInput.value = '';
    autoResize();

    // Remove previous follow-up chips
    const oldFollowUps = messagesDiv.querySelector('.follow-ups');
    if (oldFollowUps) oldFollowUps.remove();

    addUserMessage(text);
    lastUserMessage = text;
    currentAssistantMsg = createAssistantMessage();

    try {
        const result = await api.sendMessage(text, responseLength);
        if (result && result.chatId) {
            currentChatId = result.chatId;
            if (sidebarOpen) refreshChatList();
        }
        if (result && result.error) {
            const retryable = result.retryable || false;
            if (currentAssistantMsg) {
                currentAssistantMsg.showError(result.error, retryable);
            } else {
                const errBubble = createAssistantMessage();
                errBubble.showError(result.error, retryable);
            }
            isStreaming = false;
            sendBtn.disabled = false;
            currentAssistantMsg = null;
        }
        // Streaming callbacks handle the rest
    } catch (err) {
        console.error('sendMessage error:', err);
        const msg = err.message || String(err);
        if (currentAssistantMsg) {
            currentAssistantMsg.showError(msg);
        } else {
            const errBubble = createAssistantMessage();
            errBubble.showError(msg);
        }
        isStreaming = false;
        sendBtn.disabled = false;
        currentAssistantMsg = null;
    }
}

// ── Streaming event listeners ─────────────────────────────────────────

api.onChatStream((data) => {
    if (currentAssistantMsg) {
        currentAssistantMsg.appendChunk(data.chunk);
    }
});

api.onChatStreamEnd((data) => {
    if (currentAssistantMsg) {
        currentAssistantMsg.finalize();
        currentAssistantMsg = null;
    }
    isStreaming = false;
    sendBtn.disabled = !messageInput.value.trim();

    // Show follow-up suggestions if they arrived with the stream end
    const followUps = data && data.followUps;
    if (followUps && followUps.length > 0) {
        showFollowUps(followUps);
    }
});

// Follow-up suggestions may also arrive separately (fallback)
api.onFollowUps((data) => {
    if (!isStreaming && data && data.followUps && data.followUps.length > 0) {
        showFollowUps(data.followUps);
    }
});

api.onToolStatus((data) => {
    if (!currentAssistantMsg) return;
    if (data.status === 'calling') {
        currentAssistantMsg.addToolIndicator(data.toolName);
    } else if (data.status === 'done') {
        currentAssistantMsg.markToolDone(data.toolName);
    }
});

api.onMcpStatus((data) => {
    if (data.connected) {
        setMcpBadge('connected', 'Connected');
    } else {
        setMcpBadge('error', 'Disconnected');
    }
});

// ── Rate limit status bar ─────────────────────────────────────────────
const rateLimitText = /** @type {HTMLSpanElement} */ (document.getElementById('rate-limit-text'));
const rateLimitFill = /** @type {HTMLDivElement} */ (document.getElementById('rate-limit-fill'));

function updateRateLimitBar(stats) {
    const { used, limit, resetsInSeconds } = stats;
    const pct = Math.min(100, Math.round((used / limit) * 100));

    // Show current model name in the bar
    const providerInfo = providers.find(p => p.id === activeProviderId);
    const modelInfo = providerInfo?.models.find(m => m.id === activeModelId);
    const modelLabel = modelInfo?.name || providerInfo?.name || '';

    let resetText = '';
    if (used > 0 && resetsInSeconds > 0) {
        resetText = ` \u00b7 resets in ${resetsInSeconds}s`;
    }
    rateLimitText.textContent = `${modelLabel} \u00b7 ${used} / ${limit} RPM${resetText}`;

    rateLimitFill.style.width = pct + '%';
    rateLimitFill.classList.remove('warning', 'critical');
    if (pct >= 90) {
        rateLimitFill.classList.add('critical');
    } else if (pct >= 60) {
        rateLimitFill.classList.add('warning');
    }
}

api.onUsageUpdate((data) => {
    updateRateLimitBar(data);
});

// Refresh the rate limit bar periodically (countdown timer)
setInterval(async () => {
    try {
        const stats = await api.getUsageStats();
        updateRateLimitBar(stats);
    } catch { /* ignore */ }
}, 5000);

// ── Auto-resize textarea ──────────────────────────────────────────────
function autoResize() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + 'px';
}

// ── Event wiring ──────────────────────────────────────────────────────
messageInput.addEventListener('input', () => {
    autoResize();
    sendBtn.disabled = !messageInput.value.trim() || isStreaming;
});

messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

sendBtn.addEventListener('click', sendMessage);

clearBtn.addEventListener('click', () => resetToWelcome());

async function resetToWelcome() {
    await api.clearChat();
    currentChatId = null;
    messagesDiv.innerHTML = `
        <div class="welcome-message">
            <h2>Welcome to Sefaria Chat</h2>
            <p>Ask about Jewish texts, explore the library, or dive into Torah topics.</p>
            <div class="suggested-prompts">
                <button class="prompt-card" data-prompt="What does the Torah say about justice?">What does the Torah say about justice?</button>
                <button class="prompt-card" data-prompt="Summarize the story of Joseph in Genesis">Summarize the story of Joseph in Genesis</button>
                <button class="prompt-card" data-prompt="What are the key themes in Pirkei Avot?">What are the key themes in Pirkei Avot?</button>
                <button class="prompt-card" data-prompt="Compare how Rashi and Ramban interpret the first verse of Genesis">Compare how Rashi and Ramban interpret the first verse of Genesis</button>
            </div>
        </div>`;
    wirePromptCards();
}

settingsBtn.addEventListener('click', toggleSettings);

// Close settings page
const settingsCloseBtn = /** @type {HTMLButtonElement} */ (document.getElementById('settings-close-btn'));
settingsCloseBtn.addEventListener('click', () => {
    if (!settingsPanel.classList.contains('hidden')) {
        toggleSettings();
    }
});

// Print chat conversation
const printBtn = /** @type {HTMLButtonElement} */ (document.getElementById('print-btn'));
printBtn.addEventListener('click', () => {
    // Build a standalone HTML document with the chat messages for printing
    const msgs = messagesDiv.cloneNode(true);
    // Remove non-printable elements
    msgs.querySelectorAll('.follow-ups, .tool-indicators, .thinking-indicator').forEach(el => el.remove());
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sefaria Chat</title>
<style>
  body { font-family: 'Segoe UI', sans-serif; max-width: 720px; margin: 0 auto; padding: 24px; color: #333; }
  .message { margin-bottom: 20px; }
  .message-user .message-content { background: #18345d; color: #fff; padding: 10px 14px; border-radius: 12px; display: inline-block; }
  .message-assistant .message-content { background: #f0ede6; padding: 12px 16px; border-radius: 12px; }
  .message-avatar { font-weight: 600; margin-bottom: 4px; font-size: 13px; color: #666; }
  .message-assistant .message-avatar svg { display: none; }
  a { color: #18345d; }
  pre { background: #f5f5f5; padding: 10px; border-radius: 6px; overflow-x: auto; }
  code { font-size: 0.9em; }
  blockquote { border-left: 3px solid #ccb479; padding-left: 12px; margin-left: 0; color: #555; }
  h1,h2,h3 { color: #18345d; }
  .welcome-message, .follow-ups, .tool-indicators { display: none; }
</style></head><body>${msgs.innerHTML}</body></html>`;
    api.printChat(html);
});

reconnectBtn.addEventListener('click', async () => {
    setMcpBadge('connecting', 'Reconnecting…');
    await api.reconnectMcp();
});

// Setup save
setupSaveBtn.addEventListener('click', async () => {
    const providerId = setupProvider.value;
    const providerInfo = providers.find(p => p.id === providerId);
    const needsKey = providerInfo?.requiresKey !== false;
    const key = setupApiKey.value.trim();
    if (needsKey && !key) return;
    const modelId = providerInfo?.defaultModel || '';
    await api.saveProviderConfig({ providerId, modelId, apiKey: key || undefined });
    activeProviderId = providerId;
    activeModelId = modelId;
    hideSetup();
    // Refresh model picker after initial setup
    await refreshModelPicker();
});

setupApiKey.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') setupSaveBtn.click();
});

// Update setup overlay when provider dropdown changes
setupProvider.addEventListener('change', () => {
    const p = providers.find(pr => pr.id === setupProvider.value);
    if (p) {
        const needsKey = p.requiresKey !== false;
        setupApiKey.placeholder = needsKey ? p.keyPlaceholder : 'No API key needed';
        setupApiKey.disabled = !needsKey;
        setupApiKey.style.display = needsKey ? '' : 'none';
        setupKeyLink.href = p.keyHelpUrl;
        setupKeyLink.textContent = needsKey ? p.keyHelpLabel : `${p.keyHelpLabel} — no API key required`;
        setupSaveBtn.textContent = needsKey ? 'Get Started' : 'Use ' + p.name;
    }
});

// Settings save
settingsSave.addEventListener('click', async () => {
    const providerId = settingsProvider.value;
    const modelId = settingsModel.value;
    const key = settingsApiKey.value.trim();
    await api.saveProviderConfig({ providerId, modelId, apiKey: key || undefined });
    activeProviderId = providerId;
    activeModelId = modelId;
    settingsApiKey.value = '';
    // Don't close settings — let user close manually
    // Refresh the model picker (new keys may have been added)
    await refreshModelPicker();
    // Refresh activated providers list
    await refreshActivatedProviders();
    // Refresh rate limit bar with new provider limits
    try {
        const stats = await api.getUsageStats();
        updateRateLimitBar(stats);
    } catch { /* ignore */ }
});

// Populate model dropdown when provider changes in settings
settingsProvider.addEventListener('change', () => {
    const p = providers.find(pr => pr.id === settingsProvider.value);
    populateModelDropdown(settingsModel, p);
    updateSettingsKeyHint(p);
});

/**
 * Populate the compact model picker in the footer with only providers that have API keys configured.
 */
async function refreshModelPicker() {
    try {
        const configured = await api.getConfiguredProviders();

        // For Ollama, try to detect installed models and replace the default list
        const ollamaInfo = configured.find(p => p.id === 'ollama');
        if (ollamaInfo) {
            try {
                const detection = await api.detectOllama();
                if (detection.available && detection.models.length > 0) {
                    ollamaInfo.models = detection.models;
                    ollamaInfo.hasKey = true; // Ollama is reachable → mark as configured
                    if (!ollamaInfo.models.find(m => m.id === ollamaInfo.defaultModel)) {
                        ollamaInfo.defaultModel = ollamaInfo.models[0].id;
                    }
                    // Also update the providers array for settings dropdowns
                    const provEntry = providers.find(p => p.id === 'ollama');
                    if (provEntry) { provEntry.models = detection.models; }
                }
            } catch { /* Ollama not running, that's fine */ }
        }

        modelPicker.innerHTML = '';
        for (const p of configured) {
            if (!p.hasKey) continue;
            const group = document.createElement('optgroup');
            group.label = p.name;
            for (const m of p.models) {
                const opt = document.createElement('option');
                opt.value = `${p.id}::${m.id}`;
                opt.textContent = m.name;
                if (p.id === activeProviderId && m.id === activeModelId) {
                    opt.selected = true;
                }
                group.appendChild(opt);
            }
            modelPicker.appendChild(group);
        }
        // Hide picker if there's nothing to show (0 or 1 model total)
        const totalOptions = modelPicker.querySelectorAll('option').length;
        modelPicker.closest('.model-picker').style.display = totalOptions <= 1 ? 'none' : '';
    } catch { /* ignore */ }
}

modelPicker.addEventListener('change', async () => {
    const val = modelPicker.value; // "providerId::modelId"
    const [providerId, modelId] = val.split('::');
    if (!providerId || !modelId) return;
    if (providerId === activeProviderId && modelId === activeModelId) return;

    const result = await api.switchProvider(providerId, modelId);
    if (result.error) {
        console.warn('Switch provider error:', result.error);
        // Revert selection
        modelPicker.value = `${activeProviderId}::${activeModelId}`;
        return;
    }
    activeProviderId = providerId;
    activeModelId = modelId;

    // Refresh rate limit bar with new provider stats
    try {
        const stats = await api.getUsageStats();
        updateRateLimitBar(stats);
    } catch { /* ignore */ }
});

/** @param {HTMLSelectElement} select @param {typeof providers[0]} [providerInfo] */
function populateModelDropdown(select, providerInfo) {
    select.innerHTML = '';
    if (!providerInfo) return;
    for (const m of providerInfo.models) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        if (m.id === (activeModelId || providerInfo.defaultModel)) opt.selected = true;
        select.appendChild(opt);
    }
}

/** @param {typeof providers[0]} [providerInfo] */
function updateSettingsKeyHint(providerInfo) {
    if (!providerInfo) { settingsKeyHint.innerHTML = ''; return; }
    const needsKey = providerInfo.requiresKey !== false;
    settingsApiKey.placeholder = needsKey ? providerInfo.keyPlaceholder : 'No API key needed';
    settingsApiKey.disabled = !needsKey;
    if (needsKey) {
        settingsKeyHint.innerHTML = `Get a key from <a href="${providerInfo.keyHelpUrl}" target="_blank">${providerInfo.keyHelpLabel}</a>. Leave blank to keep the existing key.`;
    } else {
        settingsKeyHint.innerHTML = `<a href="${providerInfo.keyHelpUrl}" target="_blank">${providerInfo.keyHelpLabel}</a> — runs locally, no API key required.`;
    }
}

// Suggested prompt cards & clear
function wirePromptCards() {
    document.querySelectorAll('.prompt-card[data-prompt]').forEach((card) => {
        card.addEventListener('click', () => {
            const prompt = /** @type {HTMLElement} */(card).dataset.prompt || '';
            messageInput.value = prompt;
            autoResize();
            sendMessage();
        });
    });
}
wirePromptCards();

// ── History sidebar ───────────────────────────────────────────────────
function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    if (sidebarOpen) {
        historySidebar.classList.remove('hidden');
        refreshChatList();
    } else {
        historySidebar.classList.add('hidden');
    }
}

async function refreshChatList() {
    const chats = await api.listChats();
    if (!chats || chats.length === 0) {
        historyList.innerHTML = '<div class="history-empty">No saved chats yet.<br>Start a conversation!</div>';
        return;
    }
    historyList.innerHTML = '';
    for (const c of chats) {
        const item = document.createElement('div');
        item.className = 'history-item' + (c.id === currentChatId ? ' active' : '');
        item.dataset.chatId = c.id;

        const dateStr = new Date(c.updatedAt).toLocaleDateString(undefined, {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        item.innerHTML = `
            <div class="history-item-text">
                <div class="history-item-title">${escapeHtml(c.title)}</div>
                <div class="history-item-date">${dateStr}</div>
            </div>
            <button class="history-item-delete" title="Delete chat">×</button>`;

        item.querySelector('.history-item-delete').addEventListener('click', async (e) => {
            e.stopPropagation();
            await api.deleteChat(c.id);
            if (currentChatId === c.id) {
                await resetToWelcome();
            }
            refreshChatList();
        });

        item.addEventListener('click', () => loadChat(c.id));
        historyList.appendChild(item);
    }
}

async function loadChat(chatId) {
    const data = await api.loadChat(chatId);
    if (!data) return;
    currentChatId = chatId;

    // Rebuild message UI
    messagesDiv.innerHTML = '';
    if (data.messages) {
        for (const m of data.messages) {
            const text = m.text || m.content || '';
            if (m.role === 'user') {
                addUserMessage(text);
            } else if (m.role === 'assistant') {
                const bubble = createAssistantMessage();
                bubble.appendChunk(text);
                bubble.finalize();
            }
        }
    }

    // Highlight active item
    historyList.querySelectorAll('.history-item').forEach((el) => {
        el.classList.toggle('active', el.dataset.chatId === chatId);
    });

    // Close sidebar after loading
    if (sidebarOpen) toggleSidebar();
}

historyBtn.addEventListener('click', toggleSidebar);
closeSidebarBtn.addEventListener('click', toggleSidebar);

newChatBtn.addEventListener('click', async () => {
    await api.newChat();
    await resetToWelcome();
    if (sidebarOpen) refreshChatList();
    messageInput.focus();
});

// ── Embedded webview pane ─────────────────────────────────────────────
const webviewPanel   = /** @type {HTMLDivElement} */ (document.getElementById('webview-panel'));
const webviewContent = /** @type {any} */           (document.getElementById('webview-content'));
const webviewTitle   = /** @type {HTMLSpanElement} */ (document.getElementById('webview-title'));
const webviewClose   = /** @type {HTMLButtonElement} */ (document.getElementById('webview-close'));
const webviewBack    = /** @type {HTMLButtonElement} */ (document.getElementById('webview-back'));
const webviewForward = /** @type {HTMLButtonElement} */ (document.getElementById('webview-forward'));
const webviewExternal = /** @type {HTMLButtonElement} */ (document.getElementById('webview-external'));
const splitHandle    = /** @type {HTMLDivElement} */ (document.getElementById('split-handle'));
const appDiv         = /** @type {HTMLDivElement} */ (document.getElementById('app'));

let currentWebviewUrl = '';
let webviewOpen = false;

function openWebviewPane(url) {
    currentWebviewUrl = url;
    webviewContent.src = url;
    webviewTitle.textContent = 'Loading\u2026';
    webviewPanel.classList.remove('hidden');
    splitHandle.classList.remove('hidden');
    if (!webviewOpen) {
        webviewOpen = true;
        api.resizeForWebview(true);
    }
}

function closeWebviewPane() {
    webviewPanel.classList.add('hidden');
    splitHandle.classList.add('hidden');
    webviewContent.src = 'about:blank';
    currentWebviewUrl = '';
    // Reset flex sizing
    appDiv.style.flex = '';
    appDiv.style.width = '';
    webviewPanel.style.width = '';
    if (webviewOpen) {
        webviewOpen = false;
        api.resizeForWebview(false);
    }
}

webviewClose.addEventListener('click', closeWebviewPane);

webviewBack.addEventListener('click', () => {
    if (webviewContent.canGoBack && webviewContent.canGoBack()) {
        webviewContent.goBack();
    }
});

webviewForward.addEventListener('click', () => {
    if (webviewContent.canGoForward && webviewContent.canGoForward()) {
        webviewContent.goForward();
    }
});

webviewExternal.addEventListener('click', () => {
    if (currentWebviewUrl) {
        window.open(currentWebviewUrl, '_blank');
    }
});

const webviewPrint = /** @type {HTMLButtonElement} */ (document.getElementById('webview-print'));
webviewPrint.addEventListener('click', () => {
    if (webviewContent.print) {
        webviewContent.print();
    }
});

// Update title bar when webview navigates
if (webviewContent.addEventListener) {
    webviewContent.addEventListener('did-start-loading', () => {
        webviewTitle.textContent = 'Loading\u2026';
    });
    webviewContent.addEventListener('did-stop-loading', () => {
        const title = webviewContent.getTitle ? webviewContent.getTitle() : '';
        webviewTitle.textContent = title || webviewContent.getURL?.() || '';
        currentWebviewUrl = webviewContent.getURL?.() || currentWebviewUrl;
    });
    webviewContent.addEventListener('page-title-updated', (e) => {
        webviewTitle.textContent = e.title || '';
    });
}

// Intercept link clicks anywhere in the document (capture phase)
document.addEventListener('click', (e) => {
    const link = /** @type {HTMLElement} */ (e.target).closest('a[href]');
    if (link) {
        const href = link.getAttribute('href');
        if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
            e.preventDefault();
            e.stopPropagation();
            openWebviewPane(href);
        }
    }
}, true);

// Also listen for URLs sent from the main process
api.onOpenUrl((url) => {
    openWebviewPane(url);
});

// Close pane with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !webviewPanel.classList.contains('hidden')) {
        closeWebviewPane();
    }
});

// ── Draggable splitter ────────────────────────────────────────────────
splitHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    splitHandle.classList.add('dragging');

    // Add overlay to prevent webview from capturing mouse events
    const overlay = document.createElement('div');
    overlay.className = 'drag-overlay';
    document.body.appendChild(overlay);

    function onMouseMove(/** @type {MouseEvent} */ ev) {
        const container = /** @type {HTMLElement} */ (splitHandle.parentElement);
        const rect = container.getBoundingClientRect();
        const totalWidth = rect.width;
        const x = ev.clientX - rect.left;
        const handleWidth = 6;
        const minApp = 300;
        const minWeb = 200;
        const maxApp = totalWidth - handleWidth - minWeb;
        const appWidth = Math.max(minApp, Math.min(x - handleWidth / 2, maxApp));
        const webWidth = totalWidth - appWidth - handleWidth;

        appDiv.style.flex = 'none';
        appDiv.style.width = appWidth + 'px';
        webviewPanel.style.flex = 'none';
        webviewPanel.style.width = webWidth + 'px';
    }

    function onMouseUp() {
        splitHandle.classList.remove('dragging');
        overlay.remove();
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
});

// ── Auto-update UI ────────────────────────────────────────────────────
const updateBar = /** @type {HTMLDivElement} */ (document.getElementById('update-bar'));
const updateText = /** @type {HTMLSpanElement} */ (document.getElementById('update-text'));
const updateAction = /** @type {HTMLButtonElement} */ (document.getElementById('update-action'));
const updateDismiss = /** @type {HTMLButtonElement} */ (document.getElementById('update-dismiss'));

api.onUpdateStatus((data) => {
    if (data.status === 'downloading') {
        updateBar.classList.remove('hidden');
        const pct = data.percent != null ? ` (${data.percent}%)` : '';
        updateText.textContent = `Downloading update${data.version ? ' v' + data.version : ''}${pct}\u2026`;
        updateAction.style.display = 'none';
    } else if (data.status === 'ready') {
        updateBar.classList.remove('hidden');
        updateText.textContent = `Update${data.version ? ' v' + data.version : ''} ready`;
        updateAction.style.display = '';
        updateAction.textContent = 'Restart to update';
    }
});

updateAction.addEventListener('click', () => {
    api.installUpdate();
});

updateDismiss.addEventListener('click', () => {
    updateBar.classList.add('hidden');
});

// ── Check for updates button in Settings ──────────────────────────────
const checkUpdatesBtn = /** @type {HTMLButtonElement} */ (document.getElementById('check-updates-btn'));
const updateCheckStatus = /** @type {HTMLSpanElement} */ (document.getElementById('update-check-status'));

checkUpdatesBtn.addEventListener('click', async () => {
    checkUpdatesBtn.disabled = true;
    updateCheckStatus.textContent = 'Checking…';
    updateCheckStatus.className = 'update-check-status';
    try {
        const result = await api.checkForUpdates();
        if (result.version) {
            updateCheckStatus.textContent = `Update v${result.version} available!`;
            updateCheckStatus.className = 'update-check-status';
        } else {
            updateCheckStatus.textContent = 'You\u2019re up to date.';
            updateCheckStatus.className = 'update-check-status success';
        }
    } catch {
        updateCheckStatus.textContent = 'Could not check for updates.';
        updateCheckStatus.className = 'update-check-status';
    }
    checkUpdatesBtn.disabled = false;
});

// ── Activated providers display ───────────────────────────────────────
async function refreshActivatedProviders() {
    const container = document.getElementById('activated-providers');
    if (!container) return;
    try {
        const configured = await api.getConfiguredProviders();
        container.innerHTML = '';
        for (const p of configured) {
            const isActive = p.id === activeProviderId;
            const hasKey = p.hasKey;
            const item = document.createElement('div');
            item.className = 'provider-status-item' + (isActive ? ' active' : '');

            const iconClass = hasKey ? 'configured' : 'not-configured';
            const iconSymbol = hasKey ? '\u2713' : '\u2014';
            const badgeClass = hasKey ? 'configured' : 'not-configured';
            const badgeText = hasKey ? (isActive ? 'Active' : 'Ready') : 'Not configured';
            const detail = hasKey
                ? (p.requiresKey === false ? 'Local \u2014 no key needed' : 'API key saved')
                : 'Add an API key to activate';

            item.innerHTML = `
                <div class="provider-status-icon ${iconClass}">${iconSymbol}</div>
                <div class="provider-status-info">
                    <div class="provider-status-name">${escapeHtml(p.name)}</div>
                    <div class="provider-status-detail">${escapeHtml(detail)}</div>
                </div>
                <span class="provider-status-badge ${badgeClass}">${escapeHtml(badgeText)}</span>`;
            container.appendChild(item);
        }
    } catch { /* ignore */ }
}

// ── Initialization ────────────────────────────────────────────────────
(async function init() {
    // Load available providers
    try {
        providers = await api.getProviders();
    } catch {
        providers = [];
    }

    // Populate setup provider dropdown
    setupProvider.innerHTML = '';
    for (const p of providers) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        setupProvider.appendChild(opt);
    }

    // Populate settings provider dropdown
    settingsProvider.innerHTML = '';
    for (const p of providers) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        settingsProvider.appendChild(opt);
    }

    // Load current config
    try {
        const config = await api.getProviderConfig();
        activeProviderId = config.providerId || 'gemini';
        activeModelId = config.modelId || '';

        // Pre-select current provider in dropdowns
        setupProvider.value = activeProviderId;
        settingsProvider.value = activeProviderId;

        const currentProvider = providers.find(p => p.id === activeProviderId);

        // Update setup overlay placeholder/link
        if (currentProvider) {
            const needsKey = currentProvider.requiresKey !== false;
            setupApiKey.placeholder = needsKey ? currentProvider.keyPlaceholder : 'No API key needed';
            setupApiKey.disabled = !needsKey;
            setupApiKey.style.display = needsKey ? '' : 'none';
            setupKeyLink.href = currentProvider.keyHelpUrl;
            setupKeyLink.textContent = needsKey ? currentProvider.keyHelpLabel : `${currentProvider.keyHelpLabel} — no API key required`;
            setupSaveBtn.textContent = needsKey ? 'Get Started' : 'Use ' + currentProvider.name;
        }

        // Populate settings model dropdown
        populateModelDropdown(settingsModel, currentProvider);
        updateSettingsKeyHint(currentProvider);

        if (!config.hasKey) {
            // For keyless providers like Ollama, check if they're available
            const currentProv = providers.find(p => p.id === activeProviderId);
            if (currentProv && currentProv.requiresKey === false) {
                // Don't show setup — keyless provider is configured
            } else {
                showSetup();
            }
        }
    } catch {
        showSetup();
    }

    const status = await api.getMcpStatus();
    if (status.connected) {
        setMcpBadge('connected', 'Connected');
    }

    // Populate the model picker in the footer
    await refreshModelPicker();

    // Initial rate limit bar
    try {
        const stats = await api.getUsageStats();
        updateRateLimitBar(stats);
    } catch { /* ignore */ }

    // Show app version in settings
    try {
        const ver = await api.getAppVersion();
        document.getElementById('app-version').textContent = ver;
    } catch { /* ignore */ }
})();
