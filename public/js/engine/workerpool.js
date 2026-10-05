// Small promise-based worker pool. Each worker runs one task at a time so the
// caller can decide priorities at submission time (pull model).

export class WorkerPool {
  constructor(url, count) {
    this.workers = [];
    this.pending = new Map();
    this.nextId = 1;
    this.queue = [];
    this.destroyed = false;
    for (let i = 0; i < count; i++) {
      const w = new Worker(url, { type: 'module' });
      const slot = { worker: w, busy: false };
      w.onmessage = (e) => this._onMessage(slot, e.data);
      w.onerror = (e) => {
        console.error('Worker error', e.message || e);
        // Fail the task this worker was running so callers can recover.
        if (slot.taskId && this.pending.has(slot.taskId)) {
          const p = this.pending.get(slot.taskId);
          this.pending.delete(slot.taskId);
          slot.busy = false;
          slot.taskId = 0;
          p.reject(new Error(e.message || 'Worker crashed'));
          this._pump();
        }
      };
      this.workers.push(slot);
    }
  }

  get size() { return this.workers.length; }

  get idleCount() {
    let n = 0;
    for (const s of this.workers) if (!s.busy) n++;
    return Math.max(0, n - this.queue.length);
  }

  run(type, payload = {}, transfer = []) {
    if (this.destroyed) return Promise.reject(new Error('Worker pool destroyed'));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.queue.push({ id, msg: Object.assign({ type, id }, payload), transfer });
      this._pump();
    });
  }

  _pump() {
    for (const slot of this.workers) {
      if (this.queue.length === 0) return;
      if (slot.busy) continue;
      const task = this.queue.shift();
      slot.busy = true;
      slot.taskId = task.id;
      slot.worker.postMessage(task.msg, task.transfer);
    }
  }

  _onMessage(slot, data) {
    slot.busy = false;
    slot.taskId = 0;
    const p = this.pending.get(data.id);
    if (p) {
      this.pending.delete(data.id);
      if (data.ok) p.resolve(data.result);
      else p.reject(new Error(data.error));
    }
    this._pump();
  }

  destroy() {
    this.destroyed = true;
    for (const s of this.workers) s.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('Worker pool destroyed'));
    this.pending.clear();
    this.queue.length = 0;
  }
}
