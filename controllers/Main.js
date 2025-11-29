import complete, { listModels } from '../other/complete.js';
import { joinRoom } from 'https://esm.sh/trystero/torrent';
import { marked } from 'https://esm.sh/marked';
import { ThreadDoc, THREAD_KEYS_KEY } from '../other/threadStore.js';

const DISPLAY_NAMES_KEY = 'subgpt:displayNames';

let encodeBinary = bytes => {
  if (!bytes?.length) return '';
  let chunk = 0x8000;
  let str = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    str += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(str);
};
let decodeBinary = str => {
  if (!str) return new Uint8Array();
  let bin = atob(str);
  let out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
let parseRoomKey = rid => {
  try { return JSON.parse(rid) }
  catch { return []; }
};

globalThis.hueify = x => {
  let hash = 0;
  for (let i = 0; i < x.length; i++) hash = (hash * 31 + x.charCodeAt(i)) | 0;
  if (hash < 0) hash = ~hash + 1;
  let hues = ["slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"];
  return hues[hash % hues.length];
};

globalThis.markdown = x => marked.parse(x);
function debounce(fn, wait = 200) { let t; return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait) } }

export default class Main {
  threadSubs = new WeakMap();
  threadRoomCache = new WeakMap();
  state = {
    options: {},
    models: [],
    get model() { return this.options.model || this.models[0]?.id },
    get tags() { return [...new Set(this.threads.flatMap(x => x.tags || []))] },
    threads: [],
    tmp: {},
    lastDisplayNames: {},
    get displayedThreads() {
      let ret = [];
      if (this.tmp.panel === 'threads') ret = this.threads.filter(x => !x.archived);
      if (this.tmp.panel === 'archives') ret = this.threads.filter(x => x.archived);
      ret = ret.filter(x => !this.options.filter?.length || (x.tags?.length && this.options.filter.every(y => x.tags.find(z => z.toLowerCase() === y.toLowerCase()))));
      if (!this.options.showErotica) ret = ret.filter(x => !x.tags?.includes?.('erotica'));
      return ret;
    },
    get displayedLogs() { return this.thread?.logs || [] },
    vectors: rid => [...Object.values(this.state.tmp.tryrooms?.[rid]?.peerMetadata || {})],
  }
  attachThread(thread) {
    if (!thread || this.threadSubs.has(thread)) return thread;
    let offChange = thread.onChange(() => d.update());
    let offUpdate = thread.onDocUpdate((update, origin) => this.handleThreadDocUpdate(thread, update, origin));
    this.threadSubs.set(thread, () => {
      offChange?.();
      offUpdate?.();
    });
    return thread;
  }
  detachThread(thread) {
    if (!thread) return;
    let off = this.threadSubs.get(thread);
    off?.();
    this.threadSubs.delete(thread);
  }
  makeThread(id) {
    return this.attachThread(new ThreadDoc(id));
  }
  getThreadById(id, createIfMissing = true) {
    if (!id) return null;
    let thread = this.state.threads.find(x => x.id === id);
    if (!thread && createIfMissing) {
      thread = this.makeThread(id);
      this.state.threads.push(thread);
    }
    return thread;
  }
  handleThreadDocUpdate(thread, update, origin) {
    let prevRooms = this.threadRoomCache.get(thread) || [];
    let nextRooms = thread.rooms?.slice?.() || [];
    this.threadRoomCache.set(thread, nextRooms);
    if (!update?.length || origin === 'room-sync') return;
    let targets = new Set([...prevRooms, ...nextRooms]);
    this.broadcastThreadUpdate(thread, update, targets);
  }
  broadcastThreadUpdate(thread, update, targetRooms) {
    let rooms = targetRooms instanceof Set ? targetRooms : new Set(thread?.rooms || []);
    if (!rooms.size || !update?.length) return;
    let payload = { threadId: thread.id, update: encodeBinary(update) };
    for (let [rid, tryroom] of Object.entries(this.state.tmp.tryrooms || {})) {
      if (!tryroom?.sendThreadUpdate) continue;
      let [roomId] = parseRoomKey(rid);
      if (!roomId || !rooms.has(roomId)) continue;
      tryroom.sendThreadUpdate(payload);
    }
  }
  rememberDisplayName(id, name) {
    if (!id || !name) return;
    if (this.state.lastDisplayNames[id] === name) return;
    this.state.lastDisplayNames = { ...this.state.lastDisplayNames, [id]: name };
    localStorage.setItem(DISPLAY_NAMES_KEY, JSON.stringify(this.state.lastDisplayNames));
  }
  actions = {
    init: async () => {
      this.state.options = JSON.parse(localStorage.getItem('subgpt:options') || 'null') || { id: crypto.randomUUID(), model: null, filter: [], autotag: true };
      this.state.lastDisplayNames = JSON.parse(localStorage.getItem(DISPLAY_NAMES_KEY) || 'null') || {};
      let ids = JSON.parse(localStorage.getItem(THREAD_KEYS_KEY) || '[]');
      this.state.threads = ids.map(id => this.makeThread(id));
      await Promise.all(this.state.threads.map(x => x.whenReady));
      this.rememberDisplayName(this.state.options.id, this.state.options.displayName);
      await post('main.persist');
      this.state.tmp.panel = this.state.options.oaiKey || this.state.options.xaiKey ? 'threads' : 'settings';
      await post('main.listModels');
    },
    listModels: async () => {
      this.state.models = [];
      this.state.tmp.loadingModels = true;
      d.update();
      try { this.state.models = await listModels({ oaiKey: this.state.options.oaiKey, xaiKey: this.state.options.xaiKey }) }
      finally { this.state.tmp.loadingModels = false }
    },
    newThread: () => this.state.thread = this.makeThread(),
    openThread: x => this.state.thread = x,
    scroll: debounce(x => {
      let p = x.parentElement;
      if ([...p.children].at(-1) !== x) return;
      x.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, 200),
    cloneThread: async () => {
      let { thread } = this.state;
      if (!thread) return;
      let [btn, name] = await showModal('PromptDialog', { title: `Clone Thread`, placeholder: `New thread name`, value: thread.name, allowEmpty: false });
      if (btn !== 'ok') return;
      let clone = await ThreadDoc.fromSnapshot({ ...thread.snapshot(), name });
      this.attachThread(clone);
      this.state.threads.unshift(clone);
      this.state.thread = clone;
      await post('main.persist');
    },
    toggleShowFilter: () => this.state.tmp.showFilter = !this.state.tmp.showFilter,
    toggleFilterInput: () => this.state.tmp.showFilterInput = !this.state.tmp.showFilterInput,
    toggleTagInput: () => this.state.tmp.showTagInput = !this.state.tmp.showTagInput,
    filterKeyUp: async ev => {
      if (ev.key === 'Escape') {
        ev.target.value = '';
        ev.target.blur();
        this.state.tmp.tagSuggestions = [];
        !this.state.options.filter.length && (this.state.tmp.showFilter = false);
        return;
      }
      let x = ev.target.value.trim();
      if (ev.key === 'Enter') {
        if (!x) { this.state.tagSuggestions = this.state.tags; return }
        await post('main.filter', x);
        return;
      }
      this.state.tmp.tagSuggestions = this.state.tags.filter(y => y.toLowerCase().includes(x.toLowerCase()) && this.state.options.filter.indexOf(y) === -1);
    },
    filter: async x => {
      if (!this.state.tags.includes(x) || this.state.options.filter.includes(x)) return;
      this.state.tmp.tagSuggestions = [];
      document.querySelector('#taginput').value = '';
      this.state.options.filter.push(x);
      await post('main.persist');
    },
    rmFilter: async x => {
      let input = document.querySelector('#taginput');
      input && (input.value = '');
      this.state.showFilterInput = false;
      this.state.options.filter = this.state.options.filter.filter(y => y !== x);
      !this.state.options.filter.length && (this.state.showFilter = false);
      await post('main.persist');
    },
    renameThread: async () => {
      let { thread } = this.state;
      let [btn, name] = await showModal('PromptDialog', { title: `Rename Thread`, placeholder: `New thread name`, value: thread.name, allowEmpty: false });
      if (btn !== 'ok') return;
      thread.name = name;
      await post('main.persist');
    },
    tagKeyUp: async ev => {
      if (ev.key === 'Escape') return await post('main.toggleTagInput');
      if (ev.key !== 'Enter') {
        this.state.tmp.tagSuggestions = ev.target.value.trim() ? this.state.tags.filter(x => x.toLowerCase().includes(ev.target.value.trim().toLowerCase())) : [];
        return;
      }
      await post('main.addTag', ev.target.value);
      ev.target.value = '';
    },
    addTag: async x => {
      let { thread } = this.state;
      thread?.addTag(x);
      await post('main.persist');
    },
    rmTag: async x => {
      let { thread } = this.state;
      thread?.removeTag(x);
      await post('main.persist');
    },
    newRoom: async () => {
      let [btn, name] = await showModal('PromptDialog', { title: `Create Room`, placeholder: `Room name`, allowEmpty: false });
      if (btn !== 'ok') return;
      await post('main.joinTryRoom', JSON.stringify([crypto.randomUUID(), name]));
    },
    joinRoom: async () => {
      let [btn, x] = await showModal('PromptDialog', { title: `Join Room`, placeholder: `Room ID`, allowEmpty: false });
      if (btn !== 'ok') return;
      await post('main.joinTryRoom', x);
    },
    copyRoomId: async (ev, x) => {
      ev?.stopPropagation?.();
      await navigator.clipboard.writeText(JSON.stringify([x.id, x.name]));
    },
    toggleRoom: async x => {
      this.state.tmp.tryrooms ??= {};
      let tryroom = this.state.tmp.tryrooms[JSON.stringify([x.id, x.name])];
      await post(!tryroom ? 'main.joinTryRoom' : 'main.leaveTryRoom', JSON.stringify([x.id, x.name]));
      await post('main.persist');
    },
    joinTryRoom: async x => {
      let [rid, name] = JSON.parse(x);
      this.state.options.rooms ??= [];
      if (!this.state.options.rooms.some(y => y.id === rid)) { this.state.options.rooms.push({ id: rid, name }); await post('main.persist') }
      this.state.tmp.tryrooms ??= {};
      let tryroom = this.state.tmp.tryrooms[x] = joinRoom({ appId: 'subgpt' }, x);
      tryroom.peerMetadata = {};
      tryroom.onPeerJoin(async peer => await post('main.peerJoin', x, peer));
      tryroom.onPeerLeave(async peer => await post('main.peerLeave', x, peer));
      let [sendMetadata, getMetadata] = tryroom.makeAction('meta');
      tryroom.sendMetadata = sendMetadata;
      getMetadata(async (meta, peer) => await post('main.recvMetadata', x, peer, meta));
      let [sendThreadVector, getThreadVector] = tryroom.makeAction('tvec');
      tryroom.sendThreadVector = sendThreadVector;
      getThreadVector(async (payload, peer) => await post('main.recvThreadVector', x, peer, payload));
      let [sendThreadUpdate, getThreadUpdate] = tryroom.makeAction('tup');
      tryroom.sendThreadUpdate = sendThreadUpdate;
      getThreadUpdate(async (payload, peer) => await post('main.recvThreadUpdate', x, peer, payload));
      await post('main.announceRoomState', x);
    },
    leaveTryRoom: x => {
      this.state.tmp.tryrooms[x].leave();
      delete this.state.tmp.tryrooms[x];
    },
    peerJoin: async (rid, peer) => {
      let tryroom = this.state.tmp.tryrooms[rid];
      tryroom.peerMetadata[peer] = { id: peer };
      await post('main.sendMetadata', rid, peer);
      await post('main.sendThreadVectors', rid, peer);
    },
    peerLeave: (rid, peer) => { delete this.state.tmp.tryrooms[rid].peerMetadata[peer] },
    announceRoomState: async rid => {
      await post('main.sendMetadata', rid);
      await post('main.sendThreadVectors', rid);
    },
    sendMetadata: (rid, peer) => {
      let tryroom = this.state.tmp.tryrooms[rid];
      this.rememberDisplayName(this.state.options.id, this.state.options.displayName);
      tryroom?.sendMetadata?.({ id: this.state.options.id, displayName: this.state.options.displayName }, peer);
    },
    recvMetadata: (rid, peer, meta) => {
      let tryroom = this.state.tmp.tryrooms[rid];
      if (!tryroom) return;
      let pid = meta?.id || peer;
      tryroom.peerMetadata[peer] = { id: pid, ...meta };
      meta?.displayName && this.rememberDisplayName(pid, meta.displayName);
    },
    sendThreadVectors: async (rid, peer) => {
      let tryroom = this.state.tmp.tryrooms[rid];
      if (!tryroom?.sendThreadVector) return;
      let [roomId] = parseRoomKey(rid);
      if (!roomId) return;
      for (let thread of this.state.threads) {
        if (!thread.rooms?.includes?.(roomId)) continue;
        await thread.whenReady;
        let vector = encodeBinary(thread.encodeStateVector());
        tryroom.sendThreadVector({ threadId: thread.id, vector });
      }
    },
    recvThreadVector: async (rid, peer, payload = {}) => {
      let { threadId, vector } = payload;
      if (!threadId || !vector) return;
      let thread = this.getThreadById(threadId);
      await thread.whenReady;
      let update = thread.encodeStateAsUpdate(decodeBinary(vector));
      if (!update?.length) return;
      let tryroom = this.state.tmp.tryrooms[rid];
      tryroom?.sendThreadUpdate?.({ threadId, update: encodeBinary(update) });
    },
    recvThreadUpdate: async (rid, peer, payload = {}) => {
      let { threadId, update } = payload;
      if (!threadId || !update) return;
      let thread = this.getThreadById(threadId);
      await thread.whenReady;
      let hadContent = thread.logs.length > 0;
      thread.applyUpdate(decodeBinary(update), 'room-sync');
      let tryroom = this.state.tmp.tryrooms[rid];
      if (!hadContent && tryroom?.sendThreadVector) {
        let vector = encodeBinary(thread.encodeStateVector());
        tryroom.sendThreadVector({ threadId, vector });
      }
      await post('main.persist');
    },
    rmRoom: async (ev, x) => {
      ev?.stopPropagation?.();
      // FIXME: Disconnect
      for (let y of this.state.threads) {
        y.removeRoom(x.id);
      }
      let i = this.state.options.rooms.indexOf(x);
      i >= 0 && this.state.options.rooms.splice(i, 1);
      await post('main.persist');
    },
    shareThread: async (ev, x) => {
      ev?.stopPropagation?.();
      let [btn, ...rooms] = await showModal('ShareThreadDialog', { thread: x });
      if (btn !== 'ok') return;
      x.setRooms(rooms);
      await post('main.persist');
    },
    toggleArchives: (ev, x) => {
      if (x != null) return this.state.tmp.panel = x ? 'archives' : 'threads';
      if (this.state.tmp.panel !== 'archives') this.state.tmp.panel = 'archives';
      else this.state.tmp.panel = 'threads';
    },
    toggleRooms: (ev, x) => {
      if (x != null) return this.state.tmp.panel = x ? 'rooms' : 'threads';
      if (this.state.tmp.panel !== 'rooms') this.state.tmp.panel = 'rooms';
      else this.state.tmp.panel = 'threads';
    },
    toggleSettings: (ev, x) => {
      if (!this.state.options.oaiKey && !this.state.options.xaiKey) return this.state.tmp.panel = 'settings';
      if (x != null) return this.state.tmp.panel = x ? 'settings' : 'threads';
      if (this.state.tmp.panel !== 'settings') this.state.tmp.panel = 'settings';
      else this.state.tmp.panel = 'threads';
    },
    toggleAutoTagging: async ev => { this.state.options.autotag = ev.target.value; await post('main.persist') },
    toggleUnaryMessaging: async ev => { this.state.options.unary = ev.target.value; await post('main.persist') },
    toggleShowErotica: async ev => { this.state.options.showErotica = ev.target.value; await post('main.persist') },
    toggleErotica: async ev => { this.state.options.erotica = ev.target.value; await post('main.persist') },
    toggleRoleMapping: async ev => { this.state.options.rolemap = ev.target.value; await post('main.persist') },
    msgKeyDown: ev => ev.key === 'Enter' && !ev.shiftKey && ev.preventDefault(),
    msgKeyUp: async ev => {
      if (ev.key !== 'Enter' || ev.shiftKey) return;
      let { thread } = this.state;
      this.state.tmp.threads ??= new Map();
      if (!this.state.tmp.threads.get(thread)) this.state.tmp.threads.set(thread, {});
      let threadtmp = this.state.tmp.threads.get(thread);
      if (threadtmp.busy) return;
      let msg = ev.target.value.trim();
      ev.target.value = '';
      if (msg.trim() === '/play') return showModal('GameModeDialog');
      thread?.addLog({ id: crypto.randomUUID(), author: this.state.options.id, role: 'user', content: msg });
      d.update();
      await post('main.complete');
    },
    toggleShowModels: () => this.state.tmp.showModels = !this.state.tmp.showModels,
    changeModel: async x => { this.state.options.model = x; this.state.tmp.showModels = false; await post('main.persist') },
    complete: async () => {
      let { thread } = this.state;
      this.state.tmp.threads ??= new Map();
      if (!this.state.tmp.threads.get(thread)) this.state.tmp.threads.set(thread, {});
      let threadtmp = this.state.tmp.threads.get(thread);
      if (threadtmp.busy) throw new Error(`Thread busy`);
      try {
        threadtmp.busy = true;
        d.update();
        let logs = [...this.state.displayedLogs].map(x => ({ ...x, content: !x.author ? x.content : `[${this.state.lastDisplayNames[x.author]}] ${x.content}` }));
        logs = !this.state.options.unary ? [...logs] : [{ role: 'user', content: logs.map(x => x.content).join('\n\n') }];
        logs.unshift({ role: 'system', content: `You are a multi-user chat assistant. Logs will be prefixed with e.g. [Author Name] so you know who said what. Feel free to reply to them by name, but do not mark your responses with a similar [Bot Author] mark.` });
        for (let x of thread.tags?.filter?.(x => x.startsWith('pull:')) || []) {
          let prime = this.state.threads.filter(y => !y.archived && y.tags?.includes?.(x.slice('pull:'.length)));
          logs.unshift(...prime.flatMap(x => x.logs));
        }
        let apiKey = this.state.model.startsWith('oai:') ? this.state.options.oaiKey : this.state.options.xaiKey;
        let res = await complete(logs, { simple: true, model: this.state.model, apiKey });
        if (!res.role) { console.error('Bad response:', res); console.info('Sent logs:', logs); return }
        thread.addLog({ id: null, ...res, id: crypto.randomUUID() });
        if (thread.logs.length <= 2) {
          threadtmp.busy = false;
          !thread.name && await post('main.suggestThreadName');
          this.state.options.autotag && await post('main.suggestThreadTags');
        }
        if (!this.state.threads.includes(thread)) this.state.threads.unshift(thread);
        await post('main.persist');
      } finally {
        threadtmp.busy = false;
      }
    },
    suggestThreadName: async () => {
      let { thread } = this.state;
      this.state.tmp.threads ??= new Map();
      if (!this.state.tmp.threads.get(thread)) this.state.tmp.threads.set(thread, {});
      let threadtmp = this.state.tmp.threads.get(thread);
      if (threadtmp.busy) throw new Error(`Thread busy`);
      try {
        threadtmp.busy = true;
        d.update();
        let apiKey = this.state.model.startsWith('oai:') ? this.state.options.oaiKey : this.state.options.xaiKey;
        let res = await complete(
          [...this.state.displayedLogs, { role: 'user', content: `Suggest a short name for this thread. Respond with the bare name, nothing else.` }],
          { simple: true, model: this.state.model, apiKey },
        );
        thread.name = res.content;
        await post('main.persist');
      } finally {
        threadtmp.busy = false;
      }
    },
    suggestThreadTags: async () => {
      let { thread } = this.state;
      this.state.tmp.threads ??= new Map();
      if (!this.state.tmp.threads.get(thread)) this.state.tmp.threads.set(thread, {});
      let threadtmp = this.state.tmp.threads.get(thread);
      if (threadtmp.busy) throw new Error(`Thread busy`);
      try {
        threadtmp.busy = true;
        d.update();
        let apiKey = this.state.model.startsWith('oai:') ? this.state.options.oaiKey : this.state.options.xaiKey;
        let addRes = await complete(
          [...this.state.displayedLogs, {
            role: 'user',
            content: [
              `Suggest a comprehensive comma-separated list of tags ONLY for things mentioned in this thread.`,
              thread.tags?.length && `This is the current tag list: ${thread.tags.join(', ')}.`,
              `Don't repeat existiing tags.`,
              `If this is sexually charged, make sure to include the tag "erotica" FIRST.`,
              `Respond with the bare tags, nothing else.`,
              `If the existing list of tags captures everything, respond with a bare "[NONE]".`,
            ],
          }],
          { simple: true, model: this.state.model, apiKey },
        );
        console.log('addRes:', addRes.content);
        if (!addRes.content.includes('[NONE]')) {
          for (let x of addRes.content.split(',').map(x => x.trim().toLowerCase().replace(/^pull:/, '').replaceAll(/[ _]+/g, '-'))) thread.addTag(x);
        }
        d.update();
        /* FIXME:
        if (!thread.tags.length) return;
        let rmRes = await complete(
          [...this.state.displayedLogs, {
            role: 'user',
            content: [
              `Suggest a comprehensive comma-separated list of the following tags irrelevant to this thread (e.g. not explicitly mentioned anywhere outside the following list): ${thread.tags.join(', ')}`,
              `Respond with the bare tags, nothing else.`,
              `Only if all tags are relevant, respond with a bare "[NONE]".`,
            ],
          }],
          { simple: true, model: 'xai:grok-4-1-fast-reasoning', apiKey },
        );
        console.log('rmRes:', rmRes.content);
        if (!rmRes.content.includes('[NONE]')) {
          for (let x of rmRes.content.split(',').map(x => x.trim().toLowerCase().replaceAll(/[ _]+/g, '-'))) {
            thread.removeTag(x);
          }
        }
        */
      } finally {
        await post('main.persist');
        threadtmp.busy = false;
      }
    },
    toggleGameModeLog: async x => {
      x.gameMode = x.gameMode ? null : true;
      await post('main.persist');
    },
    editLog: x => {
      let { thread } = this.state;
      this.state.tmp.threads ??= new Map();
      if (!this.state.tmp.threads.get(thread)) this.state.tmp.threads.set(thread, {});
      let threadtmp = this.state.tmp.threads.get(thread);
      threadtmp.editing = x;
      threadtmp.editingContent = x.content;
      console.log(threadtmp);
    },
    saveLog: async x => {
      let { thread } = this.state;
      let threadtmp = this.state.tmp.threads.get(thread);
      x.content = threadtmp.editingContent;
      delete threadtmp.editing;
      delete threadtmp.editingContent;
      await post('main.persist');
    },
    revertLog: async x => {
      let { thread } = this.state;
      let threadtmp = this.state.tmp.threads.get(thread);
      delete threadtmp.editing;
      delete threadtmp.editingContent;
    },
    rmLog: async x => {
      let { thread } = this.state;
      thread?.removeLog(x);
      await post('main.persist');
    },
    toggleArchived: async (ev, x) => {
      ev?.stopPropagation?.();
      x.archived = !x.archived;
      if (x.archived) x.setRooms([]);
      if (x.archived && this.state.thread === x) this.state.thread = null;
      if (!this.state.threads.some(x => x.archived)) this.state.tmp.panel = 'threads';
      await post('main.persist');
    },
    rm: async (ev, x) => {
      ev?.stopPropagation?.();
      let i = this.state.threads.indexOf(x);
      if (i >= 0) {
        this.state.threads.splice(i, 1);
        this.detachThread(x);
        await x.deleteFromStorage();
      }
      if (this.state.thread === x) this.state.thread = null;
      await post('main.persist');
    },
    persist: () => {
      localStorage.setItem('subgpt:options', JSON.stringify(this.state.options));
      this.rememberDisplayName(this.state.options.id, this.state.options.displayName);
      localStorage.setItem(THREAD_KEYS_KEY, JSON.stringify(this.state.threads.map(x => x.id)));
      localStorage.removeItem('subgpt:threads');
      localStorage.setItem(DISPLAY_NAMES_KEY, JSON.stringify(this.state.lastDisplayNames));
    },
  };
}
