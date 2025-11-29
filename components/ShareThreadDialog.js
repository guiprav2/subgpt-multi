export default class ShareThreadDialog {
  constructor(props) { this.props = props; this.rooms = [...props.thread.rooms || []] }
  toggle(x) {
  	let i = this.rooms.indexOf(x);
    if (i < 0) this.rooms.push(x);
    else this.rooms.splice(i, 1);
    d.update();
  }
  submit = ev => {
    ev.preventDefault();
    this.root.parentElement.returnDetail = ev.submitter.value === 'ok' && this.rooms;
    this.root.parentElement.close(ev.submitter.value);
  };
};
