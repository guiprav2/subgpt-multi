import complete, { listModels } from '../other/complete.js';
import { joinRoom } from 'https://esm.sh/trystero/torrent';
import { marked } from 'https://esm.sh/marked';

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
  state = {
    options: {},
    models: [],
    get model() { return this.options.model || this.models[0]?.id },
    get tags() { return [...new Set(this.threads.flatMap(x => x.tags || []))] },
    threads: [],
    tmp: {},
    get displayedThreads() {
      let ret = [];
      if (this.tmp.panel === 'threads') ret = this.threads.filter(x => !x.archived);
      if (this.tmp.panel === 'archives') ret = this.threads.filter(x => x.archived);
      ret = ret.filter(x => !this.options.filter?.length || (x.tags?.length && this.options.filter.every(y => x.tags.find(z => z.toLowerCase() === y.toLowerCase()))));
      if (!this.options.showErotica) ret = ret.filter(x => !x.tags?.includes?.('erotica'));
      return ret;
    },
    get displayedLogs() { return this.thread?.logs || [] },
    vectors: rid => [...Object.values(this.state.tmp.tryrooms?.[rid]?.peerVectors || {})],
  }
  actions = {
    init: async () => {
      this.state.options = JSON.parse(localStorage.getItem('subgpt:options') || 'null') || { id: crypto.randomUUID(), model: null, filter: [], autotag: true };
      this.state.threads = JSON.parse(localStorage.getItem('subgpt:threads') || '[]');
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
    newThread: () => this.state.thread = { id: crypto.randomUUID() },
    openThread: x => this.state.thread = x,
    scroll: debounce(x => {
      let p = x.parentElement;
      if ([...p.children].at(-1) !== x) return;
      x.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, 200),
    cloneThread: async () => {
      let { thread } = this.state;
      let [btn, name] = await showModal('PromptDialog', { title: `Clone Thread`, placeholder: `New thread name`, value: thread.name, allowEmpty: false });
      if (btn !== 'ok') return;
      thread = { name: null, ...thread, name };
      this.state.threads.unshift(thread);
      this.state.thread = thread;
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
      thread.tags ??= [];
      thread.tags.push(x);
      await post('main.persist');
    },
    rmTag: async x => {
      let { thread } = this.state;
      let i = thread.tags.indexOf(x);
      i >= 0 && thread.tags.splice(i, 1);
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
      tryroom.peerVectors = {};
      tryroom.onPeerJoin(async peer => await post('main.peerJoin', x, peer));
      tryroom.onPeerLeave(async peer => await post('main.peerLeave', x, peer));
      let [sendVector, getVector] = tryroom.makeAction('vector');
      tryroom.sendVector = sendVector;
      getVector(async (vec, peer) => await post('main.recvVector', x, peer, vec));
    },
    leaveTryRoom: x => {
      this.state.tmp.tryrooms[x].leave();
      delete this.state.tmp.tryrooms[x];
    },
    peerJoin: async (rid, peer) => { this.state.tmp.tryrooms[rid].peerVectors[peer] = { id: peer }, await post('main.sendVector', rid, peer) },
    peerLeave: (rid, peer) => { delete this.state.tmp.tryrooms[rid].peerVectors[peer] },
    sendVector: (rid, peer) => {
      let tryroom = this.state.tmp.tryrooms[rid];
      tryroom.sendVector({ id: this.state.options.id, displayName: this.state.options.displayName });
    },
    recvVector: (rid, peer, vec) => this.state.tmp.tryrooms[rid].peerVectors[peer] = { id: null, ...vec, id: peer },
    rmRoom: async (ev, x) => {
      ev?.stopPropagation?.();
      // FIXME: Disconnect
      for (let y of this.state.threads) {
        let i = y.rooms?.indexOf?.(x.id) ?? -1;
        i >= 0 && y.rooms.splice(i, 1);
      }
      let i = this.state.options.rooms.indexOf(x);
      i >= 0 && this.state.options.rooms.splice(i, 1);
      await post('main.persist');
    },
    shareThread: async (ev, x) => {
      ev?.stopPropagation?.();
      let [btn, ...rooms] = await showModal('ShareThreadDialog', { thread: x });
      if (btn !== 'ok') return;
      x.rooms = rooms;
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
      thread.logs ??= [];
      thread.logs.push({ id: crypto.randomUUID(), role: 'user', content: msg });
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
        let logs = !this.state.options.unary ? [...this.state.displayedLogs] : [{ role: 'user', content: this.state.displayedLogs.map(x => x.content).join('\n\n') }];
        for (let x of thread.tags?.filter?.(x => x.startsWith('pull:')) || []) {
          let prime = this.state.threads.filter(y => !y.archived && y.tags?.includes?.(x.slice('pull:'.length)));
          logs.unshift(...prime.flatMap(x => x.logs));
        }
        let apiKey = this.state.model.startsWith('oai:') ? this.state.options.oaiKey : this.state.options.xaiKey;
        let res = await complete(logs, { simple: true, model: this.state.model, apiKey });
        if (!res.role) { console.error('Bad response:', res); console.info('Sent logs:', logs); return }
        thread.logs.push({ id: null, ...res, id: crypto.randomUUID() });
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
          thread.tags ??= [];
          for (let x of addRes.content.split(',').map(x => x.trim().toLowerCase().replace(/^pull:/, '').replaceAll(/[ _]+/g, '-'))) !thread.tags.includes(x) && thread.tags.push(x);
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
            let i = thread.tags.indexOf(x);
            i >= 0 && thread.tags.splice(i, 1);
          }
        }
        */
      } finally {
        await post('main.persist');
        threadtmp.busy = false;
      }
    },
    toggleGameModeLog: async x => {
      if (!x.gameMode) x.gameMode = true;
      else delete x.gameMode;
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
      let i = thread.logs.indexOf(x);
      i >= 0 && thread.logs.splice(i, 1);
      await post('main.persist');
    },
    toggleArchived: async (ev, x) => {
      ev?.stopPropagation?.();
      x.archived = !x.archived;
      if (x.archived) delete x.rooms;
      if (x.archived && this.state.thread === x) this.state.thread = null;
      if (!this.state.threads.some(x => x.archived)) this.state.tmp.panel = 'threads';
      await post('main.persist');
    },
    rm: async (ev, x) => {
      ev?.stopPropagation?.();
      let i = this.state.threads.indexOf(x);
      i >= 0 && this.state.threads.splice(i, 1);
      if (this.state.thread === x) this.state.thread = null;
      await post('main.persist');
    },
    persist: () => {
      localStorage.setItem('subgpt:options', JSON.stringify(this.state.options));
      localStorage.setItem('subgpt:threads', JSON.stringify(this.state.threads));
    },
  };
}
