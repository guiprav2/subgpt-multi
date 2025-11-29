export default class Game {
  state = {
    get title() { return this.thread.name },
    bold: 0,
    italic: 0,
  };
  actions = {
    init: async () => {
      let { thread } = state.main;
      if (this.state.thread === thread) return;
      this.state.thread = thread;
      let logs = thread.logs.some(x => x.gameMode) ? thread.logs.filter(x => x.gameMode) : thread.logs;
      this.state.src = logs.filter(x => x.role === 'assistant').flatMap(x => x.content.split('\n')).map(x => (x.length >= 20 || !/page|paragraph/i.test(x)) ? x : `# ${x}`).filter(x => x.trim()).map(x => x.trim());
      console.log(this.state.src);
      this.state.i = this.state.j = 0;
      this.state.wait = true;
      d.update();
      await new Promise(pres => setTimeout(pres, 3000));
      this.state.wait = false;
      d.updateSync();
      await post('game.next');
    },
    next: async () => {
      let scrollarea = document.querySelector('#GameModeDialog .scrollarea');
      if (this.state.typewriting) return this.state.ff = !!scrollarea.textContent.trim() && !this.state.wait;
      let ln = d.el('div');
      let done;
      try {
        this.state.typewriting = true;
        scrollarea.querySelector('.next')?.remove?.();
        scrollarea.append(ln);
        let span = d.el('span', { class: 'mr-2' });
        ln.append(span);
        let lnt = '';
        let x = this.state.src[this.state.i];
        while (true) {
          let slice = x.slice(this.state.j);
          if (!this.state.j && slice.startsWith('#')) {
            this.state.i++;
            d.update();
            let clear = !!scrollarea.textContent.trim();
            x = this.state.src[this.state.i];
            this.state.j = 0;
            if (clear) {
              scrollarea.innerHTML = '';
              this.state.wait = true;
              d.update();
              await new Promise(pres => setTimeout(pres, 3000));
              this.state.wait = false;
              d.update();
            }
            x = this.state.src[this.state.i]
            this.state.j = 0;
            if (!x) return;
            if (clear) { ln = d.el('div'); scrollarea.append(ln); span = d.el('span', { class: 'mr-2' }); ln.append(span) }
            continue;
          }
          let y;
          if (!/^([_\*]{1,2})/.test(slice) && !slice.startsWith('"')) y = x[this.state.j++];
          else if (this.state.italic <= 0 && slice.startsWith('**')) { this.state.italic++; this.state.j += 2; y = '<i>' }
          else if (this.state.italic > 0 && slice.startsWith('**')) { this.state.italic--; this.state.j += 2; y = '</i>' }
          else if (this.state.bold <= 0 && slice.startsWith('*')) { this.state.bold++; this.state.j++; y = '<b>' }
          else if (this.state.bold > 0 && slice.startsWith('*')) { this.state.bold--; this.state.j++; y = '</b>' }
          else if (slice.startsWith('"')) { this.state.quotes = !this.state.quotes; this.state.j++; y = slice[0] }
          if (!y) {
            console.log('b1');
            if (!ln.textContent.trim()) ln.remove();
            done = true;
            break;
          }
          lnt += y;
          span.innerHTML = lnt;
          span.scrollIntoView({ block: 'end', behavior: 'smooth' });
          !this.state.ff && await new Promise(pres => setTimeout(pres, !/[,:—]/.test(y) ? 30 : 500));
          if (
            y === '.' &&
            this.state.bold <= 0 &&
            this.state.italic <= 0 &&
            (() => {
              let rest = x.slice(this.state.j).trimStart();
              if (this.state.quotes || /^[\.a-z]/.test(rest)) return false;
              if (this.state.quotes && rest.startsWith('"')) return false;
              if (this.state.quotes && /^"[-—]/.test(rest)) return false;
              return true;
            })()
          ) {
            console.log('b2');
            break;
          }
          if (done = this.state.j >= x.length) { console.log('b3'); break }
        }
      } finally {
        if (done) { console.log('adv'); this.state.i++; this.state.j = 0 }
        this.state.typewriting = this.state.ff = false;
        ln.append(d.el('span', { class: 'next animate-pulse nf nf-fa-chevron_down' }));
      }
    },
  };
}
