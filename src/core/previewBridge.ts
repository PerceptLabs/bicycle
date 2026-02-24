const BRIDGE_MARKER = 'data-nanobuild-bridge';

function buildBridgeScript() {
    return `<script ${BRIDGE_MARKER}="1">
(() => {
  const toText = (value) => {
    try {
      if (typeof value === 'string') return value;
      if (value instanceof Error) return value.name + ': ' + value.message + '\\n' + (value.stack || '');
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const post = (type, payload) => {
    window.parent?.postMessage({ source: 'nanobuild-preview', type, payload }, '*');
  };

  const levels = ['log', 'info', 'warn', 'error'];
  levels.forEach((level) => {
    const original = console[level];
    console[level] = (...args) => {
      try {
        post('console', { level, args: args.map(toText) });
      } catch {}
      return original.apply(console, args);
    };
  });

  window.addEventListener('error', (event) => {
    post('runtime-error', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error && event.error.stack ? String(event.error.stack) : ''
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    post('unhandled-rejection', { reason: toText(event.reason) });
  });

  post('ready', { href: location.href });

  const emitRenderStatus = () => {
    try {
      const root = document.getElementById('app');
      const rootTextLength = (root?.textContent || '').trim().length;
      const rootChildCount = root?.children?.length || 0;
      const rootHasContent = Boolean(root) && (rootChildCount > 0 || rootTextLength > 0);

      const body = document.body;
      const bodyElements = body ? Array.from(body.children) : [];
      const meaningfulBodyElements = bodyElements.filter((el) => {
        if (el.tagName === 'SCRIPT') return false;
        if (el.id === 'app') {
          const appText = (el.textContent || '').trim().length;
          const appChildren = el.children?.length || 0;
          return appChildren > 0 || appText > 0;
        }
        return true;
      });
      const bodyTextLength = (body?.textContent || '').trim().length;
      const bodyHasContent = meaningfulBodyElements.length > 0 || bodyTextLength > 0;

      const ok = rootHasContent || bodyHasContent;
      post('render-ok', {
        href: location.href,
        ok,
        rootChildCount,
        rootTextLength,
        bodyChildCount: meaningfulBodyElements.length,
        bodyTextLength
      });
    } catch (error) {
      post('render-ok', {
        href: location.href,
        ok: false,
        rootChildCount: 0,
        rootTextLength: 0,
        bodyChildCount: 0,
        bodyTextLength: 0,
        error: toText(error)
      });
    }
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(emitRenderStatus);
  });
  setTimeout(emitRenderStatus, 600);
  setTimeout(emitRenderStatus, 1400);
})();
</script>`;
}

export function injectPreviewBridge(html: string): string {
    if (!html || html.includes(BRIDGE_MARKER)) return html;
    const bridge = buildBridgeScript();

    if (/<\/head>/i.test(html)) {
        return html.replace(/<\/head>/i, `${bridge}\n</head>`);
    }

    if (/<body[^>]*>/i.test(html)) {
        return html.replace(/<body[^>]*>/i, (match) => `${match}\n${bridge}`);
    }

    return `${bridge}\n${html}`;
}
