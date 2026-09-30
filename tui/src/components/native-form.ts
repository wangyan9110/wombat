import { BoxRenderable, TextRenderable, InputRenderable, SelectRenderable, ScrollBoxRenderable, RGBA, TextAttributes, type Renderable, type CliRenderer, type KeyEvent } from '@opentui/core';
import type { TerminalTheme } from '../themes/index.js';
import { terminalText } from '../display-text.js';
import type { FormSpec, FormAnswer, FormField } from './form-model.js';

/** Form composition only. Native inputs own editing, selects own selection, and ScrollBox owns scrolling. */
export class NativeForm {
  private values: Record<string, string>;
  private changed = new Set<string>();
  private controls: Array<{ id: string; node: Renderable; field?: BoxRenderable }> = [];
  private columns: BoxRenderable[] = [];
  private focusIndex = 0;
  private open?: { node: SelectRenderable; field: FormField; previous: number };
  private resolve?: (answer: FormAnswer) => void;
  private disposed = false;
  private scroll: ScrollBoxRenderable;
  constructor(private renderer: CliRenderer, area: BoxRenderable, private spec: FormSpec, private theme: TerminalTheme, private color: boolean) {
    this.values = { ...spec.values };
    this.scroll = new ScrollBoxRenderable(renderer, { id: 'form-fields', flexGrow: 1, flexShrink: 1, minHeight: 1, scrollX: false, scrollY: true });
    this.scroll.verticalScrollBar.visible = false; this.scroll.horizontalScrollBar.visible = false; area.add(this.scroll);
    this.fields(spec.fields);
    if (spec.advancedFields) {
      this.action(this.scroll, 'advanced', `${spec.advancedOpen ? '⌄' : '›'} 其他筛选`, () => this.finish('toggle'), false);
      if (spec.advancedOpen) this.fields(spec.advancedFields);
    }
    if (spec.error) this.text(area, spec.error, this.theme.disclosureSummary, 'form-error');
    const actions = this.box(area, { id: 'form-actions', flexDirection: 'row', gap: 2 });
    this.action(actions, 'apply', '应用', () => this.finish('apply'), false);
    this.action(actions, 'cancel', '取消', () => this.finish('cancel'), false);
    this.text(area, 'Tab 切换 · Ctrl+S 应用 · Esc 取消', theme.footerForeground, 'form-help');
    this.resize();
    this.focus(Math.max(0, this.controls.findIndex(control => control.id === spec.focusId)));
  }
  run(): Promise<FormAnswer> { return new Promise(resolve => { this.resolve = resolve; }); }
  dispose(): void { this.disposed = true; this.open = undefined; this.resolve = undefined; }
  finish(action: FormAnswer['action']): void {
    const resolve = this.resolve; this.resolve = undefined;
    resolve?.({ action, values: { ...this.values }, changed: [...this.changed], focusId: this.controls[this.focusIndex]?.id });
  }
  private box(parent: BoxRenderable, options: ConstructorParameters<typeof BoxRenderable>[1]): BoxRenderable {
    const node = new BoxRenderable(this.renderer, { flexShrink: 0, ...options }); parent.add(node); return node;
  }
  private text(parent: BoxRenderable, value: string, fg: string, id?: string): TextRenderable {
    const node = new TextRenderable(this.renderer, { id, content: terminalText(value), wrapMode: 'word', flexShrink: 0, selectable: false, fg: this.color ? fg : RGBA.defaultForeground() }); parent.add(node); return node;
  }
  private action(parent: BoxRenderable, id: string, label: string, activate: () => void, outline = true): void {
    const node = this.box(parent, { id: `form-${id}`, border: outline ? true : ['bottom'], borderStyle: outline ? 'rounded' : 'single', paddingX: outline ? 1 : 0, height: outline ? 3 : 2, focusable: true,
      ...(this.color ? { borderColor: outline ? this.theme.controlBorder : this.theme.background, focusedBorderColor: this.theme.selectedBorder } : { borderColor: RGBA.defaultForeground(), focusedBorderColor: RGBA.defaultForeground() }),
      onKeyDown: key => { if (key.name === 'return' || key.name === 'space') { key.preventDefault(); activate(); } },
      onMouseUp: event => { if (event.button === 0) { this.focus(this.controls.findIndex(control => control.id === id)); activate(); } } });
    this.text(node, label, this.theme.activeTabForeground);
    this.controls.push({ id, node });
  }
  private fields(fields: FormField[]): void {
    const grid = this.box(this.scroll, { flexDirection: 'row', flexWrap: 'wrap', gap: 1, width: '100%', maxWidth: 70 });
    for (const field of fields) {
      const column = this.box(grid, { id: `field-${field.id}`, width: '48%', flexShrink: 0 }); this.columns.push(column);
      this.text(column, field.label, this.theme.fieldLabel);
      const shell = this.box(column, { border: true, height: 'auto', paddingX: 1, ...(this.color ? { borderColor: this.theme.fieldBorder, backgroundColor: this.theme.fieldBackground } : { borderColor: RGBA.defaultForeground(), backgroundColor: RGBA.defaultBackground() }) });
      const paint = this.color ? { backgroundColor: this.theme.fieldBackground, focusedBackgroundColor: this.theme.fieldBackground, textColor: this.theme.fieldForeground } : { backgroundColor: RGBA.defaultBackground(), focusedBackgroundColor: RGBA.defaultBackground(), textColor: RGBA.defaultForeground() };
      if (field.options) {
        const options = field.options.map(option => ({ name: terminalText(option.label), value: option.value, description: '' }));
        const selected = Math.max(0, options.findIndex(option => option.value === this.values[field.id]));
        const select = new SelectRenderable(this.renderer, { id: `input-${field.id}`, width: '100%', height: 1, options, selectedIndex: selected, showDescription: false, showSelectionIndicator: !this.color, ...paint,
          ...(this.color ? { focusedTextColor: this.theme.fieldForeground, selectedTextColor: this.theme.fieldForeground, selectedBackgroundColor: this.theme.fieldBackground } : { focusedTextColor: RGBA.defaultForeground(), selectedTextColor: RGBA.defaultForeground(), selectedBackgroundColor: RGBA.defaultBackground() }),
          onMouseUp: event => {
            if (event.button !== 0) return;
            event.stopPropagation(); this.focus(this.controls.findIndex(control => control.id === field.id));
            if (this.open?.node === select) {
              const index = event.y - select.y;
              if (index >= 0 && index < options.length) { select.setSelectedIndex(index); this.commitSelect(); }
            } else this.expandSelect(select, field);
          } });
        shell.add(select);
        select.on('itemSelected', () => this.commitSelect());
        select.on('selectionChanged', () => { if (this.open?.node === select) this.revealOption(select); });
        this.controls.push({ id: field.id, node: select, field: column });
      } else {
        const input = new InputRenderable(this.renderer, { id: `input-${field.id}`, width: '100%', value: this.values[field.id] ?? '', placeholder: field.placeholder ?? '', ...paint,
          onMouseDown: () => this.focus(this.controls.findIndex(control => control.id === field.id)) });
        shell.add(input);
        input.on('input', () => { this.values[field.id] = input.value; this.changed.add(field.id); });
        input.on('enter', () => this.focus(this.focusIndex + 1));
        this.controls.push({ id: field.id, node: input, field: column });
      }
    }
  }
  resize(): void {
    const dense = this.renderer.height < 20;
    for (const id of ['form-heading', 'form-navigation']) {
      const node = this.renderer.root.findDescendantById(id) as BoxRenderable | undefined;
      if (node) node.border = dense ? [] : ['bottom'];
    }
    for (const [id, entry] of [['usage-tab', 'usage'], ['threads-tab', 'threads']]) {
      const tab = this.renderer.root.findDescendantById(id) as BoxRenderable | undefined;
      if (tab) {
        tab.marginBottom = dense ? 0 : -1;
        if (this.color) tab.borderColor = this.spec.activeTab === entry ? this.theme.activeTabBorder : dense ? this.theme.background : this.theme.border;
      }
    }
    for (const column of this.columns) column.width = this.renderer.width < 68 ? '100%' : '48%';
    this.renderer.requestRender();
    this.renderer.once('frame', () => {
      if (this.disposed) return;
      const node = this.controls[this.focusIndex];
      if (this.open) this.revealOption(this.open.node);
      else if (node?.field) this.scroll.scrollChildIntoView(node.field.id);
    });
  }
  private focus(index: number): void {
    this.focusIndex = (index + this.controls.length) % this.controls.length;
    if (this.open && this.open.node !== this.controls[this.focusIndex].node) this.closeSelect();
    const control = this.controls[this.focusIndex]; control.node.focus();
    for (const item of this.controls) if (item.field && this.color) (item.node.parent as BoxRenderable).borderColor = item === control ? this.theme.selectedBorder : this.theme.fieldBorder;
    if (!this.color) for (const item of this.controls) if (!item.field) for (const child of item.node.getChildren())
      if (child instanceof TextRenderable) child.attributes = item === control ? TextAttributes.INVERSE : 0;
    if (control.field) this.scroll.scrollChildIntoView(control.field.id);
    else if (control.id === 'advanced') this.scroll.scrollChildIntoView(control.node.id);
    this.renderer.requestRender();
  }
  private expandSelect(node: SelectRenderable, field: FormField): void {
    this.open = { node, field, previous: node.getSelectedIndex() };
    node.height = field.options!.length;
    if (this.color) { node.selectedBackgroundColor = this.theme.selectedBackground; node.selectedTextColor = this.theme.selectedForeground; }
    this.renderer.once('frame', () => { if (this.open?.node === node) this.revealOption(node); });
    this.renderer.requestRender();
  }
  private revealOption(node: SelectRenderable): void {
    const y = node.y + node.getSelectedIndex(), viewport = this.scroll.viewport;
    if (y < viewport.y) this.scroll.scrollBy(y - viewport.y);
    else if (y >= viewport.y + viewport.height) this.scroll.scrollBy(y - viewport.y - viewport.height + 1);
  }
  private closeSelect(): void {
    if (!this.open) return;
    const { node, previous } = this.open; this.open = undefined;
    node.setSelectedIndex(previous); node.height = 1;
    if (this.color) { node.selectedBackgroundColor = this.theme.fieldBackground; node.selectedTextColor = this.theme.fieldForeground; }
    this.renderer.requestRender();
  }
  private commitSelect(): void {
    if (!this.open) return;
    const { node, field } = this.open;
    this.values[field.id] = node.getSelectedOption()!.value as string; this.changed.add(field.id);
    this.finish('change');
  }
  key(key: KeyEvent): void {
    const handled = () => { key.preventDefault(); key.stopPropagation(); };
    if (key.name === 'escape') { handled(); if (this.open) this.closeSelect(); else this.finish('cancel'); return; }
    if (key.ctrl && key.name === 's') { handled(); this.finish('apply'); return; }
    if (key.name === 'tab') { handled(); this.closeSelect(); this.focus(this.focusIndex + (key.shift ? -1 : 1)); return; }
    const current = this.controls[this.focusIndex];
    if (current.node instanceof SelectRenderable && !this.open && key.name === 'return') {
      handled(); const field = [...this.spec.fields, ...(this.spec.advancedFields ?? [])].find(field => field.id === current.id)!;
      this.expandSelect(current.node, field); return;
    }
    if (!this.open && ['up', 'down'].includes(key.name)) { handled(); this.focus(this.focusIndex + (key.name === 'up' ? -1 : 1)); return; }
    if (!this.open && !(current.node instanceof InputRenderable) && !key.ctrl && !key.meta) {
      if (key.name === 'a') { handled(); this.finish('apply'); }
      else if (key.name === '1' || key.name === '2') { handled(); this.finish(key.name === '1' ? 'usage-tab' : 'threads-tab'); }
    }
  }
}
