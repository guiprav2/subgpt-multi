import { Y, IndexeddbPersistence } from './y.js';

export const THREAD_KEYS_KEY = 'subgpt:threadKeys';
const THREAD_DB_PREFIX = 'subgpt:thread:';

let cloneValue = value => {
  if (value == null) return value;
  if (typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

class ThreadLog {
  constructor(map, notify) {
    let observer = () => notify();
    Object.defineProperties(this, {
      map: { value: map },
      notify: { value: notify },
      observer: { value: observer },
    });
    this.map.observe(this.observer);
    Object.defineProperties(this, {
      id: { get: () => this.map.get('id'), enumerable: true },
      role: {
        get: () => this.map.get('role'),
        set: value => { this.map.set('role', value); this.notify(); },
        enumerable: true,
      },
      author: {
        get: () => this.map.get('author'),
        set: value => { this.map.set('author', cloneValue(value)); this.notify(); },
        enumerable: true,
      },
      content: {
        get: () => this.map.get('content'),
        set: value => { this.map.set('content', cloneValue(value)); this.notify(); },
        enumerable: true,
      },
      gameMode: {
        get: () => this.map.get('gameMode'),
        set: value => {
          if (value == null) this.map.delete('gameMode');
          else this.map.set('gameMode', value);
          this.notify();
        },
        enumerable: true,
      },
      priming: {
        get: () => this.map.get('priming'),
        set: value => {
          if (value == null) this.map.delete('priming');
          else this.map.set('priming', cloneValue(value));
          this.notify();
        },
        enumerable: true,
      },
    });
  }
  destroy() {
    this.map.unobserve(this.observer);
  }
  toJSON() {
    return {
      id: this.id,
      role: this.role,
      content: cloneValue(this.content),
      gameMode: this.gameMode,
      priming: cloneValue(this.priming),
    };
  }
}

export class ThreadDoc {
  constructor(id = crypto.randomUUID()) {
    this.id = id;
    this.origin = { thread: id };
    this.doc = new Y.Doc({ guid: `subgpt-thread-${id}` });
    this.meta = this.doc.getMap('meta');
    this.tagsY = this.doc.getArray('tags');
    this.roomsY = this.doc.getArray('rooms');
    this.logsY = this.doc.getArray('logs');
    this._listeners = new Set();
    this.updateListeners = new Set();
    this._tags = [];
    this._rooms = [];
    this._logs = [];
    this.logMap = new Map();
    this.metaObserver = () => this.syncMeta();
    this.tagsObserver = () => this.syncTags();
    this.roomsObserver = () => this.syncRooms();
    this.logsObserver = () => this.syncLogs();
    this.meta.observe(this.metaObserver);
    this.tagsY.observe(this.tagsObserver);
    this.roomsY.observe(this.roomsObserver);
    this.logsY.observe(this.logsObserver);
    this.docUpdateHandler = (update, origin) => {
      for (let fn of this.updateListeners) fn(update, origin);
    };
    this.doc.on('update', this.docUpdateHandler);
    this.persistence = new IndexeddbPersistence(`${THREAD_DB_PREFIX}${id}`, this.doc);
    this.whenReady = this.persistence.whenSynced.then(() => {
      this.transact(() => this.meta.set('id', this.meta.get('id') || this.id));
      this.syncAll();
    });
    this.syncAll();
  }
  destroy() {
    this.meta.unobserve(this.metaObserver);
    this.tagsY.unobserve(this.tagsObserver);
    this.roomsY.unobserve(this.roomsObserver);
    this.logsY.unobserve(this.logsObserver);
    this.doc.off('update', this.docUpdateHandler);
    for (let log of this.logMap.values()) log.destroy();
    this.logMap.clear();
    this._listeners.clear();
    if (typeof this.persistence?.destroy === 'function') this.persistence.destroy();
  }
  async deleteFromStorage() {
    await this.persistence.clearData();
    this.destroy();
  }
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
  onDocUpdate(fn) {
    this.updateListeners.add(fn);
    return () => this.updateListeners.delete(fn);
  }
  emitChange() {
    for (let fn of this._listeners) fn(this);
  }
  transact(fn) {
    this.doc.transact(fn, this.origin);
  }
  syncAll() {
    this.syncMeta();
    this.syncTags();
    this.syncRooms();
    this.syncLogs();
  }
  syncMeta() {
    this._name = this.meta.get('name') || '';
    this._archived = !!this.meta.get('archived');
    this.emitChange();
  }
  syncTags() {
    this._tags = this.tagsY.toArray();
    this.emitChange();
  }
  syncRooms() {
    this._rooms = this.roomsY.toArray();
    this.emitChange();
  }
  syncLogs() {
    let maps = this.logsY.toArray();
    let seen = new Set();
    let logs = [];
    for (let map of maps) {
      if (!map.get('id')) map.set('id', crypto.randomUUID());
      let id = map.get('id');
      seen.add(id);
      let entry = this.logMap.get(id);
      if (!entry) {
        entry = new ThreadLog(map, () => this.emitChange());
        this.logMap.set(id, entry);
      }
      logs.push(entry);
    }
    for (let [id, entry] of [...this.logMap.entries()]) {
      if (!seen.has(id)) {
        entry.destroy();
        this.logMap.delete(id);
      }
    }
    this._logs = logs;
    this.emitChange();
  }
  get name() { return this._name; }
  set name(value) {
    this.transact(() => {
      if (value == null || value === '') this.meta.delete('name');
      else this.meta.set('name', value);
    });
  }
  get archived() { return this._archived; }
  set archived(value) {
    this.transact(() => {
      if (value) this.meta.set('archived', true);
      else this.meta.delete('archived');
    });
  }
  get tags() { return this._tags || []; }
  get rooms() { return this._rooms || []; }
  set rooms(list) { this.setRooms(list); }
  get logs() { return this._logs || []; }
  addTag(tag) {
    if (!tag || this.tags.includes(tag)) return;
    this.transact(() => this.tagsY.push([tag]));
  }
  removeTag(tag) {
    let idx = this.tags.indexOf(tag);
    if (idx >= 0) this.transact(() => this.tagsY.delete(idx, 1));
  }
  setTags(tags = []) {
    this.transact(() => {
      this.tagsY.delete(0, this.tagsY.length);
      this.tagsY.insert(0, tags.filter(Boolean));
    });
  }
  setRooms(rooms = []) {
    this.transact(() => {
      this.roomsY.delete(0, this.roomsY.length);
      this.roomsY.insert(0, rooms.filter(Boolean));
    });
  }
  removeRoom(roomId) {
    if (!roomId) return;
    let idx = this.rooms.indexOf(roomId);
    if (idx >= 0) this.transact(() => this.roomsY.delete(idx, 1));
  }
  createLogMap(entry) {
    let map = new Y.Map();
    for (let [key, value] of Object.entries(entry || {})) {
      if (value === undefined) continue;
      map.set(key, cloneValue(value));
    }
    if (!map.get('id')) map.set('id', crypto.randomUUID());
    return map;
  }
  addLog(entry) {
    let map = this.createLogMap(entry);
    this.transact(() => this.logsY.push([map]));
    return map.get('id');
  }
  replaceLogs(entries = []) {
    this.transact(() => {
      this.logsY.delete(0, this.logsY.length);
      this.logsY.insert(0, entries.map(entry => this.createLogMap(entry)));
    });
  }
  removeLog(log) {
    let id = typeof log === 'string' ? log : log?.id;
    if (!id) return;
    let idx = this.logs.findIndex(x => x.id === id);
    if (idx >= 0) this.transact(() => this.logsY.delete(idx, 1));
  }
  encodeStateVector() {
    return Y.encodeStateVector(this.doc);
  }
  encodeStateAsUpdate(vector) {
    return Y.encodeStateAsUpdate(this.doc, vector);
  }
  applyUpdate(update, origin = 'room-sync') {
    Y.applyUpdate(this.doc, update, origin);
  }
  snapshot() {
    return {
      name: this.name,
      tags: [...this.tags],
      rooms: [...this.rooms],
      archived: this.archived,
      logs: this.logs.map(log => log.toJSON()),
    };
  }
  static async fromSnapshot(snapshot = {}) {
    let thread = new ThreadDoc();
    await thread.whenReady;
    if (snapshot.name) thread.name = snapshot.name;
    thread.archived = !!snapshot.archived;
    thread.setTags(snapshot.tags || []);
    thread.setRooms(snapshot.rooms || []);
    thread.replaceLogs(snapshot.logs || []);
    return thread;
  }
}
