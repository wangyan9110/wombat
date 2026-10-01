import { t } from '@wombat/client/locale';
import { BoxRenderable, TextRenderable, InputRenderable, SelectRenderable, ScrollBoxRenderable, RGBA, TextAttributes, type Renderable, type CliRenderer, type KeyEvent } from '@opentui/core';
import type { TerminalTheme } from '../themes/index.js';
import { terminalText } from '../display-text.js';
import type { FormSpec, FormAnswer, FormField } from './form-model.js';

/** Form composition only. Native inputs own editing, selects own selection, and ScrollBox owns scrolling. */
export class NativeForm {
  private values: Record<string, string>;
  private changed = new Set<string>();
  private controls: Array<{ id: string; node: Renderable; field?: BoxRenderable }> = [];
  private columns: Array<{ column: BoxRenderable; index: number; input: InputRenderable | SelectRenderable; select: boolean }> = [];
  private focusIndex = 0;
  private open?: { node: SelectRenderable; field: FormField; previous: number };
  private resolve?: (answer: FormAnswer) => void;
  private disposed = false;
  private scroll: ScrollBoxRenderable;
  constructor(private renderer: CliRenderer, area: BoxRenderable, private spec: FormSpec, private theme: TerminalTheme, private color: boolean) {
    this.values = { ...spec.values };
    this.scroll = new ScrollBoxRenderable(renderer, { id: 'form-fields', flexGrow: 1, flexShrink: 1, minHeight: 1, scrollX: false, scrollY: true });
    this.scroll.verticalScrollBar.visible = false; this.scroll.horizontalScrollBar.visible = false; area.add(this.scroll);
    if (spec.heading) this.text(this.scroll, spec.heading, theme.accent, 'filter-heading');
    this.fields(spec.fields);
    if (spec.advancedFields) {
      this.action(this.scroll, 'advanced', t("tui.components.native-form.value_more_filters", { p0: spec.advancedOpen ? '⌄' : '›' }), () => this.finish('toggle'), false);
      if (spec.advancedOpen) this.fields(spec.advancedFields);
    }
    if (spec.error) this.text(this.scroll, spec.error, this.theme.disclosureSummary, 'form-error');
    const actions = this.box(this.scroll, { id: 'form-actions', flexDirection: 'row', gap: 2, marginTop: 1 });
    this.action(actions, 'apply', t("tui.components.native-form.apply"), () => this.finish('apply'), false);
    this.action(actions, 'cancel', t("tui.components.native-form.cancel"), () => this.finish('cancel'), false);
    const footer = this.box(area, { id: 'footer', border: ['top'], borderColor: this.color ? theme.border : undefined });
    this.text(footer, t("tui.components.native-form.tab_move_ctrl_s_apply_esc"), theme.footerForeground, 'form-help');
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
    const node = this.box(parent, { id: `form-${id}`, border: outline ? true : [], borderStyle: outline ? 'rounded' : 'single', paddingX: outline ? 1 : 0, height: outline ? 3 : 1, focusable: true,
      ...(this.color ? { borderColor: outline ? this.theme.controlBorder : this.theme.background, focusedBorderColor: this.theme.selectedBorder } : { borderColor: RGBA.defaultForeground(), focusedBorderColor: RGBA.defaultForeground() }),
      onKeyDown: key => { if (key.name === 'return' || key.name === 'space') { key.preventDefault(); activate(); } },
      onMouseUp: event => { if (event.button === 0) { this.focus(this.controls.findIndex(control => control.id === id)); activate(); } } });
    const caption = this.text(node, label, this.theme.activeTabForeground);
    node.on('focused', () => { caption.fg = this.color ? this.theme.focus : RGBA.defaultForeground(); caption.attributes = this.color ? TextAttributes.UNDERLINE : TextAttributes.INVERSE; });
    node.on('blurred', () => { if (caption.isDestroyed) return; caption.fg = this.color ? this.theme.activeTabForeground : RGBA.defaultForeground(); caption.attributes = 0; });
    this.controls.push({ id, node });
  }
  private fields(fields: FormField[]): void {
    const grid = this.box(this.scroll, { flexDirection: 'row', flexWrap: 'wrap', gap: 1, width: '100%', maxWidth: 70 });
    for (const [index, field] of fields.entries()) {
      const column = this.box(grid, { id: `field-${field.id}`, flexShrink: 0 });
      this.text(column, field.label, this.theme.fieldLabel);
      const shell = this.box(column, { border: true, height: 'auto', flexDirection: 'row', paddingX: 1, ...(this.color ? { borderColor: this.theme.fieldBorder, backgroundColor: this.theme.fieldBackground } : { borderColor: RGBA.defaultForeground(), backgroundColor: RGBA.defaultBackground() }) });
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
        const marker = this.text(shell, '⌄', this.theme.fieldLabel, `select-marker-${field.id}`);
        marker.width = 2;
        marker.onMouseUp = event => { if (event.button === 0) { event.stopPropagation(); this.focus(this.controls.findIndex(control => control.id === field.id)); if (this.open?.node === select) this.closeSelect(); else this.expandSelect(select, field); } };
        this.columns.push({ column, index, input: select, select: true });
        select.on('itemSelected', () => this.commitSelect());
        select.on('selectionChanged', () => { if (this.open?.node === select) this.revealOption(select); });
        this.controls.push({ id: field.id, node: select, field: column });
      } else {
        const input = new InputRenderable(this.renderer, { id: `input-${field.id}`, width: '100%', value: this.values[field.id] ?? '', placeholder: field.placeholder ?? '', ...paint,
          onMouseDown: () => this.focus(this.controls.findIndex(control => control.id === field.id)) });
        shell.add(input);
        this.columns.push({ column, index, input, select: false });
        input.on('input', () => { this.values[field.id] = input.value; this.changed.add(field.id); });
        input.on('enter', () => this.focus(this.focusIndex + 1));
        this.controls.push({ id: field.id, node: input, field: column });
      }
    }
  }
  resize(): void {
    const compact = this.renderer.width < 68;
    const available = Math.min(70, Math.min(120, this.renderer.width) - (compact ? 2 : 4));
    for (const { column, index, input, select } of this.columns) {
      const width = compact ? available : index % 2 === 0 ? Math.ceil((available - 1) / 2) : Math.floor((available - 1) / 2);
      column.width = width;
      input.width = Math.max(1, width - 4 - (select ? 2 : 0));
    }
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
    for (const item of this.controls) if (item.field && this.color) (item.node.parent as BoxRenderable).borderColor = item === control ? this.theme.focus : this.theme.fieldBorder;
    if (!this.color) for (const item of this.controls) if (!item.field) for (const child of item.node.getChildren())
      if (child instanceof TextRenderable) child.attributes = item === control ? TextAttributes.INVERSE : 0;
    if (control.field) this.scroll.scrollChildIntoView(control.field.id);
    else this.scroll.scrollChildIntoView(control.node.id);
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
      if (key.name === 'l' || key.name === 't') { handled(); this.finish(key.name === 'l' ? 'language' : 'theme'); return; }
      if (key.name === 'a') { handled(); this.finish('apply'); }
      else if (key.name === '1' || key.name === '2') { handled(); this.finish(key.name === '1' ? 'usage-tab' : 'threads-tab'); }
    }
  }
}
