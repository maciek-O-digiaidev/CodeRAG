/**
 * HTML template for the CodeRAG First-Run Configuration Dialog.
 *
 * Multi-step wizard with four steps:
 *   1. Welcome + project detection
 *   2. Embedding provider selection
 *   3. AI agent detection + MCP auto-config opt-in
 *   4. Summary + start indexing option
 */

/**
 * Generate the HTML content for the first-run dialog webview panel.
 *
 * @param nonce - CSP nonce for inline scripts and styles
 */
export function getFirstRunDialogHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <title>CodeRAG Setup</title>
  <style nonce="${nonce}">
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      display: flex;
      justify-content: center;
      padding: 24px;
    }

    .wizard {
      max-width: 600px;
      width: 100%;
    }

    .wizard-header {
      text-align: center;
      margin-bottom: 24px;
    }

    .wizard-header h1 {
      font-size: 1.5em;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .wizard-header p {
      color: var(--vscode-descriptionForeground);
    }

    .step {
      display: none;
    }

    .step.active {
      display: block;
    }

    .step-indicator {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-bottom: 20px;
    }

    .step-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background-color: var(--vscode-input-border, #555);
    }

    .step-dot.active {
      background-color: var(--vscode-button-background);
    }

    .step-dot.completed {
      background-color: var(--vscode-charts-green, #4caf50);
    }

    .step-title {
      font-size: 1.2em;
      font-weight: 600;
      margin-bottom: 12px;
    }

    .step-description {
      color: var(--vscode-descriptionForeground);
      margin-bottom: 16px;
      line-height: 1.5;
    }

    .info-box {
      background-color: var(--vscode-textBlockQuote-background, rgba(255,255,255,0.05));
      border-left: 3px solid var(--vscode-textLink-foreground);
      padding: 10px 14px;
      border-radius: 3px;
      margin-bottom: 16px;
      font-size: calc(var(--vscode-font-size) - 1px);
    }

    .info-box .label {
      font-weight: 600;
      margin-bottom: 4px;
    }

    .info-box .value {
      color: var(--vscode-descriptionForeground);
    }

    .option-group {
      margin-bottom: 16px;
    }

    .option-group label {
      display: block;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .radio-option, .checkbox-option {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 8px 12px;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      margin-bottom: 6px;
      cursor: pointer;
      transition: background-color 0.15s;
    }

    .radio-option:hover, .checkbox-option:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    .radio-option.selected, .checkbox-option.selected {
      border-color: var(--vscode-focusBorder);
      background-color: var(--vscode-list-activeSelectionBackground, rgba(255,255,255,0.08));
    }

    .radio-option input, .checkbox-option input {
      margin-top: 3px;
      accent-color: var(--vscode-button-background);
    }

    .option-content {
      flex: 1;
    }

    .option-content .name {
      font-weight: 600;
    }

    .option-content .desc {
      font-size: calc(var(--vscode-font-size) - 1px);
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }

    .agent-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      margin-bottom: 6px;
    }

    .agent-item.installed {
      border-color: var(--vscode-charts-green, #4caf50);
    }

    .agent-item.not-installed {
      opacity: 0.7;
    }

    .agent-info {
      flex: 1;
    }

    .agent-name {
      font-weight: 600;
    }

    .agent-version {
      font-size: calc(var(--vscode-font-size) - 1px);
      color: var(--vscode-descriptionForeground);
    }

    .agent-status {
      font-size: calc(var(--vscode-font-size) - 1px);
    }

    .agent-status.found {
      color: var(--vscode-charts-green, #4caf50);
    }

    .agent-status.missing {
      color: var(--vscode-descriptionForeground);
    }

    .install-link {
      font-size: calc(var(--vscode-font-size) - 1px);
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
      cursor: pointer;
    }

    .install-link:hover {
      text-decoration: underline;
    }

    .agent-checkbox {
      accent-color: var(--vscode-button-background);
    }

    .button-row {
      display: flex;
      justify-content: space-between;
      margin-top: 24px;
      gap: 8px;
    }

    .btn {
      padding: 6px 16px;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: var(--vscode-font-size);
      font-family: var(--vscode-font-family);
    }

    .btn-primary {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .btn-primary:hover {
      background-color: var(--vscode-button-hoverBackground);
    }

    .btn-secondary {
      background-color: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      border: 1px solid var(--vscode-input-border, #555);
    }

    .btn-secondary:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .loading-spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid var(--vscode-descriptionForeground);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 8px;
      vertical-align: middle;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .summary-section {
      margin-bottom: 12px;
    }

    .summary-section h3 {
      font-size: var(--vscode-font-size);
      font-weight: 600;
      margin-bottom: 4px;
    }

    .summary-section .value {
      color: var(--vscode-descriptionForeground);
      font-size: calc(var(--vscode-font-size) - 1px);
    }

    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 16px;
      padding: 8px 12px;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
    }

    .checkbox-row label {
      cursor: pointer;
    }

    #agentsLoading {
      display: none;
      padding: 12px 0;
      color: var(--vscode-descriptionForeground);
    }

    #agentsList {
      display: none;
    }
  </style>
</head>
<body>
  <div class="wizard">
    <div class="wizard-header">
      <h1>CodeRAG Setup</h1>
      <p>Configure your codebase context engine</p>
    </div>

    <div class="step-indicator">
      <div class="step-dot active" id="dot-0"></div>
      <div class="step-dot" id="dot-1"></div>
      <div class="step-dot" id="dot-2"></div>
      <div class="step-dot" id="dot-3"></div>
    </div>

    <!-- Step 1: Welcome -->
    <div class="step active" id="step-0">
      <div class="step-title">Welcome to CodeRAG</div>
      <div class="step-description">
        CodeRAG creates a semantic search index of your codebase,
        making it available to AI coding agents via MCP (Model Context Protocol).
      </div>
      <div class="info-box" id="workspaceInfo">
        <div class="label">Detecting workspace...</div>
        <div class="value"><span class="loading-spinner"></span>Please wait</div>
      </div>
      <div class="button-row">
        <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="nextBtn0">Next</button>
      </div>
    </div>

    <!-- Step 2: Embedding Provider -->
    <div class="step" id="step-1">
      <div class="step-title">Embedding Provider</div>
      <div class="step-description">
        Choose how CodeRAG generates vector embeddings for your code.
        Local (Ollama) keeps everything on your machine. API providers offer
        potentially better quality but send code to external servers.
      </div>
      <div class="option-group">
        <div class="radio-option selected" data-value="ollama">
          <input type="radio" name="embedding" value="ollama" checked />
          <div class="option-content">
            <div class="name">Ollama (Local)</div>
            <div class="desc">Uses nomic-embed-text model. Free, private, requires Ollama installed.</div>
          </div>
        </div>
        <div class="radio-option" data-value="voyage">
          <input type="radio" name="embedding" value="voyage" />
          <div class="option-content">
            <div class="name">Voyage AI</div>
            <div class="desc">Uses voyage-code-3 model. Optimized for code. Requires API key.</div>
          </div>
        </div>
        <div class="radio-option" data-value="openai">
          <input type="radio" name="embedding" value="openai" />
          <div class="option-content">
            <div class="name">OpenAI</div>
            <div class="desc">Uses text-embedding-3-small model. Requires API key.</div>
          </div>
        </div>
      </div>
      <div class="button-row">
        <button class="btn btn-secondary" id="backBtn1">Back</button>
        <button class="btn btn-primary" id="nextBtn1">Next</button>
      </div>
    </div>

    <!-- Step 3: Agent Detection -->
    <div class="step" id="step-2">
      <div class="step-title">AI Agent Configuration</div>
      <div class="step-description">
        CodeRAG can automatically configure its MCP server for each detected AI agent.
        Select which agents should have access to your code search.
      </div>
      <div id="agentsLoading">
        <span class="loading-spinner"></span>Detecting installed AI agents...
      </div>
      <div id="agentsList"></div>
      <div class="button-row">
        <button class="btn btn-secondary" id="backBtn2">Back</button>
        <button class="btn btn-primary" id="nextBtn2">Next</button>
      </div>
    </div>

    <!-- Step 4: Summary -->
    <div class="step" id="step-3">
      <div class="step-title">Configuration Summary</div>
      <div class="step-description">
        Review your choices and finalize the setup.
      </div>
      <div id="summaryContent"></div>
      <div class="checkbox-row">
        <input type="checkbox" id="startIndexing" checked />
        <label for="startIndexing">Start indexing immediately after setup</label>
      </div>
      <div class="button-row">
        <button class="btn btn-secondary" id="backBtn3">Back</button>
        <button class="btn btn-primary" id="finishBtn">Finish Setup</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    (function() {
      var vscode = acquireVsCodeApi();

      var currentStep = 0;
      var totalSteps = 4;
      var embeddingProvider = 'ollama';
      var agentConfigs = {};
      var detectedAgents = [];
      var workspaceInfo = null;

      // -----------------------------------------------------------------------
      // Navigation
      // -----------------------------------------------------------------------

      function goToStep(step) {
        if (step < 0 || step >= totalSteps) return;

        // Hide current step
        var currentEl = document.getElementById('step-' + currentStep);
        if (currentEl) currentEl.classList.remove('active');

        // Show target step
        var targetEl = document.getElementById('step-' + step);
        if (targetEl) targetEl.classList.add('active');

        // Update dots
        for (var i = 0; i < totalSteps; i++) {
          var dot = document.getElementById('dot-' + i);
          if (!dot) continue;
          dot.classList.remove('active', 'completed');
          if (i < step) dot.classList.add('completed');
          if (i === step) dot.classList.add('active');
        }

        currentStep = step;

        // Trigger side effects on step entry
        if (step === 2) {
          triggerAgentDetection();
        }
        if (step === 3) {
          renderSummary();
        }
      }

      // -----------------------------------------------------------------------
      // Step 1: Welcome
      // -----------------------------------------------------------------------

      function renderWorkspaceInfo(info) {
        workspaceInfo = info;
        var box = document.getElementById('workspaceInfo');
        if (!box) return;

        var detectedItems = [];
        if (info.hasPackageJson) detectedItems.push('Node.js / TypeScript');
        if (info.hasCargoToml) detectedItems.push('Rust');
        if (info.hasGoMod) detectedItems.push('Go');
        if (info.hasPyprojectToml) detectedItems.push('Python');

        var configStatus = info.hasCoderagYaml
          ? 'Existing .coderag.yaml found'
          : 'No .coderag.yaml found (will create one)';

        box.innerHTML = '<div class="label">Workspace: ' + escapeHtml(info.workspaceName) + '</div>'
          + '<div class="value">'
          + (detectedItems.length > 0
            ? 'Detected: ' + escapeHtml(detectedItems.join(', '))
            : 'No specific project type detected')
          + '</div>'
          + '<div class="value" style="margin-top: 4px;">' + escapeHtml(configStatus) + '</div>';
      }

      // -----------------------------------------------------------------------
      // Step 2: Embedding Provider
      // -----------------------------------------------------------------------

      var radioOptions = document.querySelectorAll('.radio-option');
      radioOptions.forEach(function(el) {
        el.addEventListener('click', function() {
          radioOptions.forEach(function(opt) { opt.classList.remove('selected'); });
          el.classList.add('selected');
          var radio = el.querySelector('input[type="radio"]');
          if (radio) {
            radio.checked = true;
            embeddingProvider = radio.value;
          }
        });
      });

      // -----------------------------------------------------------------------
      // Step 3: Agent Detection
      // -----------------------------------------------------------------------

      function triggerAgentDetection() {
        if (detectedAgents.length > 0) return; // Already detected

        var loadingEl = document.getElementById('agentsLoading');
        var listEl = document.getElementById('agentsList');
        if (loadingEl) loadingEl.style.display = 'block';
        if (listEl) listEl.style.display = 'none';

        vscode.postMessage({ type: 'detect-agents' });
      }

      function renderAgents(agents) {
        detectedAgents = agents;

        var loadingEl = document.getElementById('agentsLoading');
        var listEl = document.getElementById('agentsList');
        if (loadingEl) loadingEl.style.display = 'none';
        if (listEl) listEl.style.display = 'block';

        var html = '';
        agents.forEach(function(agent) {
          var isInstalled = agent.installed;
          var statusClass = isInstalled ? 'found' : 'missing';
          var statusText = isInstalled
            ? 'Installed' + (agent.version ? ' v' + escapeHtml(agent.version) : '')
            : 'Not found';

          // Default: enable MCP config for installed agents with config paths
          var canConfigure = isInstalled && agent.mcpConfigPath;
          if (canConfigure && agentConfigs[agent.id] === undefined) {
            agentConfigs[agent.id] = true;
          }

          html += '<div class="agent-item ' + (isInstalled ? 'installed' : 'not-installed') + '">';

          if (canConfigure) {
            var checked = agentConfigs[agent.id] ? 'checked' : '';
            html += '<input type="checkbox" class="agent-checkbox" data-agent="'
              + escapeHtml(agent.id) + '" ' + checked + ' />';
          }

          html += '<div class="agent-info">'
            + '<div class="agent-name">' + escapeHtml(agent.name) + '</div>'
            + '<div class="agent-status ' + statusClass + '">' + statusText + '</div>'
            + '</div>';

          if (!isInstalled) {
            html += '<span class="install-link" data-url="' + escapeHtml(agent.installUrl) + '">Install</span>';
          }

          html += '</div>';
        });

        if (!listEl) return;
        listEl.innerHTML = html;

        // Attach checkbox handlers
        listEl.querySelectorAll('.agent-checkbox').forEach(function(cb) {
          cb.addEventListener('change', function() {
            var agentId = cb.getAttribute('data-agent');
            agentConfigs[agentId] = cb.checked;
          });
        });

        // Attach install link handlers (open in browser)
        listEl.querySelectorAll('.install-link').forEach(function(link) {
          link.addEventListener('click', function() {
            var url = link.getAttribute('data-url');
            // Note: Links in webview can't directly open URLs; this is purely informational.
            // In a real implementation, we would postMessage to the extension to open the URL.
          });
        });
      }

      // -----------------------------------------------------------------------
      // Step 4: Summary
      // -----------------------------------------------------------------------

      function renderSummary() {
        var el = document.getElementById('summaryContent');
        if (!el) return;

        var providerNames = {
          ollama: 'Ollama (Local) - nomic-embed-text',
          voyage: 'Voyage AI - voyage-code-3',
          openai: 'OpenAI - text-embedding-3-small'
        };

        var selectedAgents = [];
        Object.keys(agentConfigs).forEach(function(key) {
          if (agentConfigs[key]) {
            var agent = detectedAgents.find(function(a) { return a.id === key; });
            if (agent) selectedAgents.push(agent.name);
          }
        });

        var html = '<div class="summary-section">'
          + '<h3>Embedding Provider</h3>'
          + '<div class="value">' + escapeHtml(providerNames[embeddingProvider] || embeddingProvider) + '</div>'
          + '</div>';

        html += '<div class="summary-section">'
          + '<h3>MCP Auto-Configuration</h3>'
          + '<div class="value">'
          + (selectedAgents.length > 0
            ? escapeHtml(selectedAgents.join(', '))
            : 'No agents selected')
          + '</div>'
          + '</div>';

        if (workspaceInfo) {
          html += '<div class="summary-section">'
            + '<h3>Configuration File</h3>'
            + '<div class="value">.coderag.yaml' + (workspaceInfo.hasCoderagYaml ? ' (will update)' : ' (will create)') + '</div>'
            + '</div>';
        }

        el.innerHTML = html;
      }

      // -----------------------------------------------------------------------
      // Button handlers
      // -----------------------------------------------------------------------

      document.getElementById('cancelBtn').addEventListener('click', function() {
        vscode.postMessage({ type: 'cancel' });
      });

      document.getElementById('nextBtn0').addEventListener('click', function() { goToStep(1); });
      document.getElementById('backBtn1').addEventListener('click', function() { goToStep(0); });
      document.getElementById('nextBtn1').addEventListener('click', function() { goToStep(2); });
      document.getElementById('backBtn2').addEventListener('click', function() { goToStep(1); });
      document.getElementById('nextBtn2').addEventListener('click', function() { goToStep(3); });
      document.getElementById('backBtn3').addEventListener('click', function() { goToStep(2); });

      document.getElementById('finishBtn').addEventListener('click', function() {
        var startIndexing = document.getElementById('startIndexing').checked;
        vscode.postMessage({
          type: 'complete',
          config: {
            embeddingProvider: embeddingProvider,
            agentConfigs: agentConfigs,
            startIndexing: startIndexing
          }
        });
      });

      // -----------------------------------------------------------------------
      // Message handler
      // -----------------------------------------------------------------------

      window.addEventListener('message', function(event) {
        var msg = event.data;
        switch (msg.type) {
          case 'workspace-info':
            renderWorkspaceInfo(msg.data);
            break;
          case 'agents-detected':
            renderAgents(msg.agents);
            break;
        }
      });

      // -----------------------------------------------------------------------
      // Utility
      // -----------------------------------------------------------------------

      function escapeHtml(str) {
        if (!str) return '';
        return str
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      // Notify extension we're ready
      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
}
