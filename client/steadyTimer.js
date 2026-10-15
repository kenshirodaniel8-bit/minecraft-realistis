// setInterval that keeps its pace when the tab is in the background.
// Browsers slow timers in hidden tabs down to once a second (or less), which
// would freeze the game for everyone in a room this browser hosts; timers in
// a worker are not slowed down like that. Falls back to setInterval.
export function steadyInterval(fn, ms) {
  try {
    const src = `const t = setInterval(() => postMessage(0), ${Number(ms)}); onmessage = () => { clearInterval(t); close(); };`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = () => fn();
    return () => worker.postMessage('stop');
  } catch {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }
}
