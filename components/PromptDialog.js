export default class PromptDialog {
  constructor(props) { this.props = props; this.props.allowEmpty ??= true }
  get valid() { return this.props.allowEmpty || this.props.value?.trim?.() }
  keyDown = ev => {
    this.dirty = true;
    this.error = false;
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    ev.target.closest('form').querySelector('[value="ok"]').click();
  };
  submit = ev => {
    ev.preventDefault();
    if (!this.valid) return this.error = `Value cannot be empty.`;
    this.root.parentElement.returnDetail = this.props.value;
    this.root.parentElement.close(ev.submitter.value);
  };
};