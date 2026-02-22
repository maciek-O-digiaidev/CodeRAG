/**
 * HTML template for the CodeRAG Search Panel webview.
 *
 * Returns a complete HTML document styled with VS Code theme variables,
 * containing a search input, filter dropdowns, results list, search history,
 * and saved searches sections. Communicates with the extension host via
 * the VS Code webview postMessage API.
 */

/**
 * Generate the HTML content for the search panel webview.
 *
 * @param nonce - CSP nonce for inline scripts
 * @param languages - Available language filters
 * @param chunkTypes - Available chunk type filters
 */
export function getSearchPanelHtml(
  nonce: string,
  languages: readonly string[],
  chunkTypes: readonly string[],
): string {
  const languageOptions = languages
    .map((lang) => `<option value="${escapeHtml(lang)}">${escapeHtml(lang)}</option>`)
    .join('\n');

  const chunkTypeOptions = chunkTypes
    .map((ct) => `<option value="${escapeHtml(ct)}">${escapeHtml(ct)}</option>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <title>CodeRAG Search</title>
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
      background-color: var(--vscode-sideBar-background);
      padding: 8px;
    }

    .search-container {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 12px;
    }

    .search-input-row {
      display: flex;
      gap: 4px;
    }

    .search-input {
      flex: 1;
      padding: 4px 8px;
      border: 1px solid var(--vscode-input-border, transparent);
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 2px;
      outline: none;
      font-size: var(--vscode-font-size);
      font-family: var(--vscode-font-family);
    }

    .search-input:focus {
      border-color: var(--vscode-focusBorder);
    }

    .search-input::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }

    .search-btn {
      padding: 4px 10px;
      border: none;
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 2px;
      cursor: pointer;
      font-size: var(--vscode-font-size);
      font-family: var(--vscode-font-family);
      white-space: nowrap;
    }

    .search-btn:hover {
      background-color: var(--vscode-button-hoverBackground);
    }

    .search-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .filter-row {
      display: flex;
      gap: 4px;
    }

    .filter-select {
      flex: 1;
      padding: 3px 6px;
      border: 1px solid var(--vscode-dropdown-border, transparent);
      background-color: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border-radius: 2px;
      font-size: calc(var(--vscode-font-size) - 1px);
      font-family: var(--vscode-font-family);
    }

    .results-container {
      margin-bottom: 12px;
    }

    .results-header {
      font-size: calc(var(--vscode-font-size) - 1px);
      color: var(--vscode-descriptionForeground);
      margin-bottom: 6px;
      padding: 2px 0;
    }

    .result-item {
      padding: 6px 8px;
      margin-bottom: 4px;
      border-radius: 3px;
      cursor: pointer;
      border: 1px solid transparent;
      background-color: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
    }

    .result-item:hover {
      background-color: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-list-focusOutline, transparent);
    }

    .result-file {
      font-size: var(--vscode-font-size);
      color: var(--vscode-textLink-foreground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .result-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: calc(var(--vscode-font-size) - 2px);
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }

    .score-badge {
      display: inline-block;
      padding: 1px 5px;
      border-radius: 8px;
      background-color: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-size: calc(var(--vscode-font-size) - 2px);
      font-weight: 600;
    }

    .result-snippet {
      font-size: calc(var(--vscode-font-size) - 1px);
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
      white-space: pre-wrap;
      overflow: hidden;
      max-height: 60px;
      line-height: 1.4;
    }

    .section {
      margin-bottom: 12px;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      padding: 4px 0;
      user-select: none;
      font-size: calc(var(--vscode-font-size) - 1px);
      color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .section-header .chevron {
      transition: transform 0.15s;
      font-size: 10px;
    }

    .section-header.collapsed .chevron {
      transform: rotate(-90deg);
    }

    .section-body {
      padding-top: 4px;
    }

    .section-body.hidden {
      display: none;
    }

    .history-item, .saved-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 3px 6px;
      border-radius: 2px;
      cursor: pointer;
      font-size: calc(var(--vscode-font-size) - 1px);
      color: var(--vscode-foreground);
    }

    .history-item:hover, .saved-item:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    .history-item .query-text, .saved-item .query-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .delete-btn {
      background: none;
      border: none;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      padding: 0 2px;
      font-size: 14px;
      line-height: 1;
      opacity: 0;
      transition: opacity 0.1s;
    }

    .history-item:hover .delete-btn,
    .saved-item:hover .delete-btn {
      opacity: 1;
    }

    .delete-btn:hover {
      color: var(--vscode-errorForeground);
    }

    .save-search-row {
      display: flex;
      gap: 4px;
      margin-top: 4px;
    }

    .save-input {
      flex: 1;
      padding: 2px 6px;
      border: 1px solid var(--vscode-input-border, transparent);
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 2px;
      font-size: calc(var(--vscode-font-size) - 1px);
      font-family: var(--vscode-font-family);
    }

    .save-btn {
      padding: 2px 8px;
      border: none;
      background-color: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      border-radius: 2px;
      cursor: pointer;
      font-size: calc(var(--vscode-font-size) - 1px);
      font-family: var(--vscode-font-family);
    }

    .empty-state {
      font-size: calc(var(--vscode-font-size) - 1px);
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      padding: 4px 0;
    }

    .loading {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 0;
      color: var(--vscode-descriptionForeground);
      font-size: var(--vscode-font-size);
    }

    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid var(--vscode-descriptionForeground);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .error-msg {
      color: var(--vscode-errorForeground);
      font-size: calc(var(--vscode-font-size) - 1px);
      padding: 4px 0;
    }
  </style>
</head>
<body>
  <div class="search-container">
    <div class="search-input-row">
      <input
        type="text"
        class="search-input"
        id="searchInput"
        placeholder="Search codebase..."
        autofocus
      />
      <button class="search-btn" id="searchBtn">Search</button>
    </div>
    <div class="filter-row">
      <select class="filter-select" id="languageFilter">
        <option value="">All languages</option>
        ${languageOptions}
      </select>
      <select class="filter-select" id="chunkTypeFilter">
        <option value="">All types</option>
        ${chunkTypeOptions}
      </select>
    </div>
  </div>

  <div class="results-container" id="resultsContainer">
    <!-- Results populated dynamically -->
  </div>

  <div class="section" id="saveSection" style="display: none;">
    <div class="save-search-row">
      <input type="text" class="save-input" id="saveNameInput" placeholder="Name this search..." />
      <button class="save-btn" id="saveBtn">Save</button>
    </div>
  </div>

  <div class="section">
    <div class="section-header" id="historyHeader">
      <span>Search History</span>
      <span class="chevron">&#9660;</span>
    </div>
    <div class="section-body" id="historyBody">
      <div class="empty-state" id="historyEmpty">No recent searches</div>
      <div id="historyList"></div>
    </div>
  </div>

  <div class="section">
    <div class="section-header" id="savedHeader">
      <span>Saved Searches</span>
      <span class="chevron">&#9660;</span>
    </div>
    <div class="section-body" id="savedBody">
      <div class="empty-state" id="savedEmpty">No saved searches</div>
      <div id="savedList"></div>
    </div>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();

      const searchInput = document.getElementById('searchInput');
      const searchBtn = document.getElementById('searchBtn');
      const languageFilter = document.getElementById('languageFilter');
      const chunkTypeFilter = document.getElementById('chunkTypeFilter');
      const resultsContainer = document.getElementById('resultsContainer');
      const saveSection = document.getElementById('saveSection');
      const saveNameInput = document.getElementById('saveNameInput');
      const saveBtn = document.getElementById('saveBtn');
      const historyHeader = document.getElementById('historyHeader');
      const historyBody = document.getElementById('historyBody');
      const historyList = document.getElementById('historyList');
      const historyEmpty = document.getElementById('historyEmpty');
      const savedHeader = document.getElementById('savedHeader');
      const savedBody = document.getElementById('savedBody');
      const savedList = document.getElementById('savedList');
      const savedEmpty = document.getElementById('savedEmpty');

      let lastQuery = '';

      // -----------------------------------------------------------------------
      // Search
      // -----------------------------------------------------------------------

      function doSearch() {
        const query = searchInput.value.trim();
        if (!query) return;

        lastQuery = query;
        const filters = {};
        const lang = languageFilter.value;
        const ct = chunkTypeFilter.value;
        if (lang) filters.language = lang;
        if (ct) filters.chunkType = ct;

        searchBtn.disabled = true;
        resultsContainer.innerHTML = '<div class="loading"><div class="spinner"></div>Searching...</div>';
        saveSection.style.display = 'none';

        vscode.postMessage({ type: 'search', query: query, filters: filters });
      }

      searchBtn.addEventListener('click', doSearch);
      searchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') doSearch();
      });

      // -----------------------------------------------------------------------
      // Results
      // -----------------------------------------------------------------------

      function renderResults(items, query) {
        searchBtn.disabled = false;

        if (!items || items.length === 0) {
          resultsContainer.innerHTML = '<div class="empty-state">No results found</div>';
          saveSection.style.display = 'none';
          return;
        }

        let html = '<div class="results-header">' + items.length + ' result(s) for "' + escapeHtmlJs(query) + '"</div>';

        items.forEach(function(item, index) {
          const fileName = item.filePath.split('/').pop() || item.filePath;
          const snippet = (item.nlSummary || item.content || '').substring(0, 150);
          html += '<div class="result-item" data-index="' + index + '">'
            + '<div class="result-file">' + escapeHtmlJs(fileName) + '</div>'
            + '<div class="result-meta">'
            + '<span>L' + item.startLine + '-' + item.endLine + '</span>'
            + '<span>' + escapeHtmlJs(item.chunkType) + '</span>'
            + '<span>' + escapeHtmlJs(item.language) + '</span>'
            + '<span class="score-badge">' + item.score.toFixed(3) + '</span>'
            + '</div>'
            + '<div class="result-snippet">' + escapeHtmlJs(snippet) + '</div>'
            + '</div>';
        });

        resultsContainer.innerHTML = html;
        saveSection.style.display = 'block';

        // Attach click handlers
        var resultItems = resultsContainer.querySelectorAll('.result-item');
        resultItems.forEach(function(el) {
          el.addEventListener('click', function() {
            var idx = parseInt(el.getAttribute('data-index'), 10);
            var item = items[idx];
            if (item) {
              vscode.postMessage({
                type: 'openResult',
                filePath: item.filePath,
                startLine: item.startLine,
                endLine: item.endLine
              });
            }
          });
        });
      }

      function renderError(message) {
        searchBtn.disabled = false;
        resultsContainer.innerHTML = '<div class="error-msg">Error: ' + escapeHtmlJs(message) + '</div>';
        saveSection.style.display = 'none';
      }

      // -----------------------------------------------------------------------
      // Save search
      // -----------------------------------------------------------------------

      saveBtn.addEventListener('click', function() {
        var name = saveNameInput.value.trim();
        if (!name || !lastQuery) return;
        vscode.postMessage({ type: 'saveSearch', name: name, query: lastQuery });
        saveNameInput.value = '';
      });

      // -----------------------------------------------------------------------
      // History
      // -----------------------------------------------------------------------

      function renderHistory(items) {
        if (!items || items.length === 0) {
          historyEmpty.style.display = 'block';
          historyList.innerHTML = '';
          return;
        }

        historyEmpty.style.display = 'none';
        var html = '';
        items.forEach(function(q) {
          html += '<div class="history-item">'
            + '<span class="query-text" title="' + escapeHtmlJs(q) + '">' + escapeHtmlJs(q) + '</span>'
            + '<button class="delete-btn" data-query="' + escapeHtmlJs(q) + '">&times;</button>'
            + '</div>';
        });
        historyList.innerHTML = html;

        // Click on query text to re-search
        historyList.querySelectorAll('.query-text').forEach(function(el) {
          el.addEventListener('click', function() {
            searchInput.value = el.textContent;
            doSearch();
          });
        });

        // Click delete
        historyList.querySelectorAll('.delete-btn').forEach(function(el) {
          el.addEventListener('click', function(e) {
            e.stopPropagation();
            vscode.postMessage({ type: 'deleteHistory', query: el.getAttribute('data-query') });
          });
        });
      }

      // -----------------------------------------------------------------------
      // Saved searches
      // -----------------------------------------------------------------------

      function renderSavedSearches(items) {
        if (!items || items.length === 0) {
          savedEmpty.style.display = 'block';
          savedList.innerHTML = '';
          return;
        }

        savedEmpty.style.display = 'none';
        var html = '';
        items.forEach(function(item) {
          html += '<div class="saved-item">'
            + '<span class="query-text" title="' + escapeHtmlJs(item.query) + '">' + escapeHtmlJs(item.name) + '</span>'
            + '<button class="delete-btn" data-name="' + escapeHtmlJs(item.name) + '">&times;</button>'
            + '</div>';
        });
        savedList.innerHTML = html;

        // Click on name to run saved search
        savedList.querySelectorAll('.query-text').forEach(function(el, idx) {
          el.addEventListener('click', function() {
            var item = items[idx];
            if (item) {
              searchInput.value = item.query;
              doSearch();
            }
          });
        });

        // Click delete
        savedList.querySelectorAll('.delete-btn').forEach(function(el) {
          el.addEventListener('click', function(e) {
            e.stopPropagation();
            vscode.postMessage({ type: 'deleteSaved', name: el.getAttribute('data-name') });
          });
        });
      }

      // -----------------------------------------------------------------------
      // Collapsible sections
      // -----------------------------------------------------------------------

      function toggleSection(header, body) {
        header.addEventListener('click', function() {
          header.classList.toggle('collapsed');
          body.classList.toggle('hidden');
        });
      }

      toggleSection(historyHeader, historyBody);
      toggleSection(savedHeader, savedBody);

      // -----------------------------------------------------------------------
      // Message handler
      // -----------------------------------------------------------------------

      window.addEventListener('message', function(event) {
        var msg = event.data;
        switch (msg.type) {
          case 'results':
            renderResults(msg.items, msg.query);
            break;
          case 'error':
            renderError(msg.message);
            break;
          case 'history':
            renderHistory(msg.items);
            break;
          case 'savedSearches':
            renderSavedSearches(msg.items);
            break;
        }
      });

      // -----------------------------------------------------------------------
      // Utility
      // -----------------------------------------------------------------------

      function escapeHtmlJs(str) {
        if (!str) return '';
        return str
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      // Request initial data
      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
}

/** Escape HTML special characters for safe interpolation into templates. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
