importScripts('https://unpkg.com/@isomorphic-git/lightning-fs@4.6.0/dist/lightning-fs.min.js');

const fs = new LightningFS('workspace');
const pfs = fs.promises;

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (url.pathname.startsWith('/preview/')) {
        event.respondWith(handlePreviewRequest(url.pathname));
    }
});

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

function getMimeType(filename) {
    const ext = filename.slice((filename.lastIndexOf(".") - 1 >>> 0) + 2);
    return mimeTypes['.' + ext] || 'text/plain';
}

async function handlePreviewRequest(pathname) {
    const parts = pathname.split('/').filter(Boolean); // ["preview", ...]
    const maybeProject = parts[1] || 'default';

    let projectId = 'default';
    let filePath = '/index.html';

    if (parts.length >= 3) {
        projectId = decodeURIComponent(maybeProject);
        filePath = `/${parts.slice(2).join('/') || 'index.html'}`;
    } else if (parts.length === 2) {
        if (maybeProject.includes('.')) {
            // Legacy route: /preview/index.html
            projectId = 'default';
            filePath = `/${maybeProject}`;
        } else {
            // Project route without explicit file: /preview/<projectId>
            projectId = decodeURIComponent(maybeProject);
            filePath = '/index.html';
        }
    }

    let vfsPath = `/projects/${projectId}${filePath}`;

    try {
        let content;
        try {
            content = await pfs.readFile(vfsPath);
        } catch (primaryErr) {
            // Legacy fallback for earlier root-based workspaces.
            if (projectId === 'default') {
                const legacyPath = filePath;
                content = await pfs.readFile(legacyPath);
                vfsPath = legacyPath;
            } else {
                throw primaryErr;
            }
        }
        const mimeType = getMimeType(vfsPath);

        return new Response(content, {
            status: 200,
            headers: {
                'Content-Type': mimeType,
                'Cache-Control': 'no-cache'
            }
        });
    } catch (error) {
        if (filePath === '/index.html') {
            const fallBackHtml = `<!DOCTYPE html><html><body><h1>No index.html found in workspace</h1></body></html>`;
            return new Response(fallBackHtml, {
                status: 200,
                headers: { 'Content-Type': 'text/html' }
            });
        }
        return new Response('File not found in Virtual File System: ' + vfsPath, { status: 404 });
    }
}

self.addEventListener('message', async (event) => {
    if (event.data && event.data.type === 'RELOAD_PREVIEW') {
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach(client => {
            // Find the iframe client based on URL if needed, or simply send to all
            client.postMessage({ type: 'RELOAD' });
        });
    }
});
