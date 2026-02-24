import { render } from 'preact'
import { Buffer } from 'buffer'
import './index.css'
import { App } from './app.tsx'

if (!(globalThis as any).Buffer) {
    (globalThis as any).Buffer = Buffer;
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then(
            (registration) => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            },
            (err) => {
                console.log('ServiceWorker registration failed: ', err);
            }
        );
    });
}

render(<App />, document.getElementById('app')!)
