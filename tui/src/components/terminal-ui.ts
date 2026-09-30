import { BoxRenderable, ScrollBoxRenderable, TextRenderable, InputRenderable, StyledText, RGBA, TextAttributes, createCliRenderer, type CliRenderer, type KeyEvent } from '@opentui/core';
import { terminalTheme, nextTerminalTheme, type TerminalTheme } from '../themes/index.js';
import { terminalText } from '../display-text.js';
import type { Frame, Choice, RowPaint, TableCell } from './view-model.js';
import { NativeForm } from './native-form.js';
import type { FormSpec, FormAnswer } from './form-model.js';
import { loadingContent, OperationCancelled, type LoadingSpec, type LoadingState } from './loading-model.js';

export interface Answer { id: string; selected: number; viewportStart: number }

/** A retained OpenTUI component tree. Layout, clipping, mouse routing and scrolling belong to OpenTUI. */
export class TerminalUI {
  private controller = new AbortController();
  readonly signal = this.controller.signal;
  private theme: TerminalTheme;
  private tree?: BoxRenderable;
  private scroll?: ScrollBoxRenderable;
  private notes?: ScrollBoxRenderable;
  private frame?: Frame;
  private selected = 0;
  private pending?: (answer: Answer) => void;
  private inputPending?: (value: string | null) => void;
  private editor?: InputRenderable;
  private activeForm?: NativeForm;
  private rowNodes: BoxRenderable[] = [];
  private selectionPaint: Array<() => void> = [];
  private textSources = new Map<TextRenderable, { content: string; paint: RowPaint }>();
  private disposed = false;
  private loadingState?: LoadingState;
  private cancelOperation?: () => void;
  private terminationCode = 130;
  get exitCode(): number { return this.terminationCode; }
  private redrawVersion = 0;
  private readonly interrupt = () => { this.controller.abort(); this.finish('quit'); this.inputPending?.(null); this.activeForm?.finish('cancel'); };
  constructor(readonly renderer: CliRenderer, theme = terminalTheme(), private readonly color = process.env.NO_COLOR === undefined) {
    this.theme = theme;
    renderer.keyInput.on('keypress', this.key);
    renderer.on('resize', this.resize);
    process.on('SIGINT', this.interrupt);
    process.on('SIGTERM', this.interrupt);
  }
  private readonly resize = () => { if (this.activeForm) this.activeForm.resize(); else if (this.loadingState) this.drawLoading(); else if (this.frame && !this.editor) this.draw(true); };
  choose(frame: Frame): Promise<Answer> {
    if (this.signal.aborted) return Promise.resolve({ id: 'quit', selected: 0, viewportStart: 0 });
    this.loadingState = undefined;
    this.frame = frame;
    this.selected = frame.selected ?? 0;
    return new Promise(resolve => { this.pending = resolve; this.draw(true, frame.viewportStart ?? 0); });
  }
  /** Wake only the current list; callers stop polling before opening editors/forms. */
  get isFollowingTop(): boolean { return this.selected === 0 && (this.scroll?.scrollTop ?? 0) === 0; }
  invalidate(): void { if (this.pending && !this.editor && !this.activeForm && !this.loadingState) this.finish('live-update'); }
  private finish(id: string): void {
    const resolve = this.pending;
    this.pending = undefined;
    resolve?.({ id, selected: this.selected, viewportStart: this.scroll?.scrollTop ?? 0 });
  }
  private resolved(): Frame {
    return { ...this.frame!, ...this.frame?.layout?.(this.renderer.width) };
  }
  private readonly key = (key: KeyEvent) => {
    if (key.ctrl && key.name === 'c') { key.preventDefault(); this.interrupt(); return; }
    if (this.loadingState) {
      if (['escape', 'b', 'x'].includes(key.name)) { key.preventDefault(); this.cancelOperation?.(); }
      else if (['q', '0'].includes(key.name)) { key.preventDefault(); this.terminationCode = 0; this.interrupt(); }
      else if (key.name === 't') { this.theme = nextTerminalTheme(this.theme); this.drawLoading(); }
      return;
    }
    if (this.activeForm) { this.activeForm.key(key); return; }
    if (this.editor) {
      if (key.name === 'escape') { key.preventDefault(); this.inputPending?.(null); }
      return;
    }
    if (!this.pending || !this.frame) return;
    const frame = this.resolved();
    const finish = (id: string) => { key.preventDefault(); this.finish(id); };
    const move = (next: number) => { key.preventDefault(); this.redrawVersion++; this.selected = Math.max(0, Math.min(frame.choices.length - 1, next)); this.selectionPaint.forEach(paint => paint()); const row = this.rowNodes[this.selected]; if (row) this.scroll?.scrollChildIntoView(row.id); this.renderer.requestRender(); };
    if (key.name === 't' && !key.ctrl) { this.theme = nextTerminalTheme(this.theme); this.draw(false); }
    else if (frame.disclosure && ['up', 'down', 'pageup', 'pagedown'].includes(key.name)) { key.preventDefault(); this.notes?.scrollBy(['up', 'pageup'].includes(key.name) ? -1 : 1, key.name.startsWith('page') ? 'viewport' : 'step'); }
    else if (frame.pageNavigation && ['up','down','home','end'].includes(key.name)) finish('cursor:' + key.name);
    else if (key.name === 'up') move(this.selected - 1);
    else if (key.name === 'down') move(this.selected + 1);
    else if (key.name === 'home') move(0);
    else if (key.name === 'end') move(frame.choices.length - 1);
    else if (key.name === 'return' && frame.choices[this.selected]) finish(frame.choices[this.selected].id);
    else if (key.name === 'escape' || key.name === 'b') finish('back');
    else if (key.name === 'tab') finish('tab');
    else if (key.name === 'pageup') finish('previous');
    else if (key.name === 'pagedown') finish('next');
    else if (key.name === 'q' || key.name === '0') finish('quit');
    else if (frame.shortcuts?.[key.sequence]) finish(frame.shortcuts[key.sequence]);
  };
  private styledContent(content: string, paint: RowPaint): StyledText {
    const safe = terminalText(content), theme = this.theme;
    const points = [...new Set([0, safe.length, ...(paint.spans ?? []).flatMap(s => [Math.min(s.start, safe.length), Math.min(s.end, safe.length)])])].sort((a, b) => a - b);
    const chunks = points.slice(0, -1).map((start, i) => {
      const end = points[i + 1];
      const style: RowPaint = Object.assign({}, paint, ...(paint.spans ?? []).filter(s => s.start <= start && s.end >= end));
      return { __isChunk: true as const, text: safe.slice(start, end), ...(style.link ? { link: { url: style.link } } : {}), ...(this.color ? { fg: RGBA.fromHex(theme[style.tone ?? 'foreground']), ...(style.background ? { bg: RGBA.fromHex(theme[style.background]) } : {}) } : {}), attributes: (style.bold ? TextAttributes.BOLD : 0) | (style.underline ? TextAttributes.UNDERLINE : 0) | (style.inverse ? TextAttributes.INVERSE : 0) };
    });
    return new StyledText(chunks);
  }
  private text(parent: BoxRenderable, content: string, paint: RowPaint = {}, id?: string): TextRenderable {
    const node = new TextRenderable(this.renderer, { id, content: this.styledContent(content, paint), wrapMode: 'word', flexShrink: 0, selectable: false });
    this.textSources.set(node, { content, paint });
    parent.add(node);
    return node;
  }
  private title(parent: BoxRenderable, content: string): void {
    const branded = content === 'Wombat' || content.startsWith('Wombat / ');
    const title = this.text(parent, content, { tone: 'pageTitle', bold: true, spans: branded ? [
      { start: 0, end: 6, tone: 'brand' },
      ...(content.startsWith('Wombat / ') ? [{ start: 7, end: 8, tone: 'titleDivider' as const, bold: false }] : []),
    ] : [] }, 'title');
    title.width = '100%'; title.height = 1; title.wrapMode = 'none'; title.truncate = true;
  }
  private box(parent: BoxRenderable, options: ConstructorParameters<typeof BoxRenderable>[1]): BoxRenderable {
    const node = new BoxRenderable(this.renderer, { flexShrink: 0, ...options });
    parent.add(node); return node;
  }
  private button(parent: BoxRenderable, label: string, id: string, active: boolean, outline = false, activate = () => this.finish(id), joinBottomRule = false): void {
    const theme = this.theme;
    let pressed = false;
    const button = this.box(parent, { id, height: outline ? 3 : 2, width: 'auto', border: outline ? true : ['bottom'], borderStyle: outline ? 'rounded' : 'single', marginBottom: joinBottomRule ? -1 : 0,
      ...(this.color ? { borderColor: active ? outline ? theme.selectedBorder : theme.activeTabBorder : outline ? theme.controlBorder : joinBottomRule ? theme.border : theme.background, backgroundColor: theme.background, focusedBorderColor: theme.accent } : {}),
      focusable: true, onMouseDown: event => { pressed = event.button === 0; }, onMouseUp: event => { if (pressed && event.button === 0) { pressed = false; event.stopPropagation(); activate(); } }, onKeyDown: key => { if (key.name === 'return') activate(); } });
    const surface = outline ? this.box(button, { paddingX: 1, ...(this.color ? { backgroundColor: active ? theme.selectedBackground : theme.background } : {}) }) : button;
    this.text(surface, label, { tone: active ? outline ? 'activeControlForeground' : 'activeTabForeground' : outline ? 'controlForeground' : 'muted', underline: active && !this.color });
  }
  private table(parent: BoxRenderable, cells: TableCell[], paint: RowPaint = {}): void {
    const grid = this.box(parent, { id: `${parent.id}-grid`, width: '100%', flexDirection: 'row', gap: 1 });
    for (const [index, cell] of cells.entries()) {
      const column = this.box(grid, { id: `${parent.id}-column-${index}`, width: cell.grow ? 0 : cell.width, flexGrow: cell.grow ?? 0, flexBasis: cell.grow ? cell.growBasis : undefined, flexShrink: cell.grow ? 1 : 0, minWidth: cell.minWidth ?? 0, paddingLeft: cell.inset ?? 0 });
      const text = this.text(column, cell.text, { ...paint, ...(cell.tone ? { tone: cell.tone } : {}), ...(cell.bold != null ? { bold: cell.bold } : {}) });
      text.textAlign = cell.align ?? 'left';
    }
  }
  private headline(parent: BoxRenderable, value: { label: string; amount: string }, narrow: boolean, kind?: Choice['kind']): void {
    const head = this.box(parent, { flexDirection: narrow ? 'column' : 'row', gap: narrow ? 0 : 2 });
    const label = this.box(head, { flexGrow: 1, flexShrink: 1, minWidth: 0 });
    this.text(label, value.label, { tone: kind === 'measurement' ? 'operationName' : kind === 'model' ? 'modelForeground' : kind === 'subtotal' ? 'subtotalForeground' : 'heading', bold: !['measurement', 'model'].includes(kind ?? '') });
    const amount = this.box(head, { flexShrink: 0, maxWidth: narrow ? '100%' : '55%' });
    this.text(amount, value.amount, { tone: kind === 'model' ? 'tablePartForeground' : kind === 'subtotal' ? 'subtotalForeground' : 'number', bold: kind !== 'model' });
  }
  private operation(parent: BoxRenderable, value: NonNullable<Choice['operation']>): void {
    const narrow = this.renderer.width < 68;
    const row = this.box(parent, { flexDirection: narrow ? 'column' : 'row', gap: narrow ? 0 : 1 });
    const clock = this.box(row, { width: narrow ? '100%' : 12, flexShrink: 0 });
    this.text(clock, value.time, { tone: 'operationTime' });
    const name = this.box(row, { flexGrow: 1, flexShrink: 1, minWidth: 0 });
    this.text(name, value.name, { tone: 'operationName' });
    const result = this.box(row, { maxWidth: narrow ? '100%' : '45%', flexShrink: 1 });
    this.text(result, value.result, { tone: 'operationResult' });
  }
  private clear(): void { this.redrawVersion++; this.tree?.destroyRecursively(); this.tree = undefined; this.rowNodes = []; this.selectionPaint = []; this.textSources.clear(); this.scroll = undefined; this.notes = undefined; }
  private base(): BoxRenderable {
    this.clear();
    const root = new BoxRenderable(this.renderer, { id: 'wombat', width: '100%', height: '100%', alignItems: 'center', ...(this.color ? { backgroundColor: this.theme.background } : {}) });
    this.renderer.root.add(root); this.tree = root;
    return this.box(root, { id: 'content', width: '100%', maxWidth: 120, height: '100%', paddingX: this.renderer.width >= 68 ? 2 : 1, paddingTop: this.renderer.height < 30 ? 0 : 1, flexDirection: 'column' });
  }
  private draw(reveal: boolean, initialScroll?: number): void {
    if (this.disposed || !this.frame) return;
    const saved = initialScroll ?? this.scroll?.scrollTop ?? 0;
    const frame = this.resolved(), theme = this.theme, dense = this.renderer.height < 20, short = this.renderer.height < 30;
    this.selected = Math.max(0, Math.min(frame.pageNavigation ? frame.selected ?? this.selected : this.selected, frame.choices.length - 1));
    const area = this.base();
    const heading = this.box(area, { id: 'heading', border: dense ? [] : ['bottom'], borderColor: this.color ? theme.border : undefined });
    this.title(heading, frame.title);
    for (const line of dense && frame.nav ? frame.compactIntro ?? [] : frame.intro) this.text(heading, line, { tone: 'muted' });
    if (frame.nav) {
      const nav = this.box(area, { id: 'navigation', flexDirection: 'row', gap: 3, border: dense ? [] : ['bottom'], borderColor: this.color ? theme.border : undefined, marginTop: 0 });
      this.button(nav, '1 用量', 'usage-tab', frame.activeTab === '1 用量', false, undefined, !dense);
      this.button(nav, '2 对话', 'threads-tab', frame.activeTab === '2 对话', false, undefined, !dense);
    }
    if (!dense) for (const [index, line] of (frame.context ?? []).entries()) this.text(area, line.text, { tone: line.summary ? 'summaryForeground' : 'contextForeground' }, `context-${index}`);
    if (frame.controlOptions) {
      const controls = this.box(area, { id: 'period-sort', flexDirection: 'row', gap: 1, height: 3, marginTop: short ? 0 : 1 });
      frame.controlOptions.forEach((label, i) => this.button(controls, label, `${label.startsWith('按') ? 'group' : 'sort'}:${i}`, label === frame.activeControl?.trim(), true));
    }
    if ((frame.tableCells || frame.tableHeader) && !dense) {
      const header = this.box(area, { id: 'table-header', paddingLeft: 2, paddingRight: 1, border: ['bottom'], borderColor: this.color ? theme.border : undefined, marginTop: short ? 0 : 1 });
      if (frame.tableCells) this.table(header, frame.tableCells, { tone: 'muted' }); else this.text(header, frame.tableHeader!, { tone: 'muted' });
    }
    const scroll = new ScrollBoxRenderable(this.renderer, { id: 'records', flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 1, scrollX: false, scrollY: true, viewportCulling: true, contentOptions: { flexDirection: 'column' }, verticalScrollbarOptions: { visible: false } });
    area.add(scroll); scroll.verticalScrollBar.visible = false; scroll.horizontalScrollBar.visible = false; this.scroll = scroll;
    const keyFor = (choice: Choice | undefined) => choice?.reportGroup ? `date:${choice.reportGroup}` : choice?.turnGroup ? `turn:${choice.turnGroup}` : undefined;
    const selectedGroup = keyFor(frame.choices[this.selected]);
    let group: BoxRenderable | undefined, groupId: string | undefined;
    for (const [index, choice] of frame.choices.entries()) {
      const key = keyFor(choice);
      if (!key || groupId !== key) {
        groupId = key;
        group = key ? this.box(scroll, { id: `${choice.turnGroup ? 'turn' : 'date'}-${index}`, border: ['left'], marginBottom: choice.turnGroup && !dense ? 1 : 0, borderColor: this.color ? (selectedGroup === groupId ? choice.turnGroup ? theme.activeTabBorder : theme.selectedBorder : choice.turnGroup ? theme.turnBorder : theme.background) : undefined }) : undefined;
        if (group) {
          const current = group, id = groupId;
          this.selectionPaint.push(() => { current.borderColor = this.color ? keyFor(frame.choices[this.selected]) === id ? choice.turnGroup ? theme.activeTabBorder : theme.selectedBorder : choice.turnGroup ? theme.turnBorder : theme.background : '#888888'; });
        }
      }
      const focused = index === this.selected;
      const background = (selected: boolean) => selected && (choice.kind === 'thread' || choice.kind === 'price') ? theme.selectedThreadBackground : selected && !['turn', 'operation', 'detail', 'control', 'measurement'].includes(choice.kind ?? '') ? theme.selectedBackground : choice.kind === 'subtotal' ? theme.subtotalBackground : choice.kind === 'detail' || choice.kind === 'measurement' && choice.expanded ? theme.detailBackground : theme.background;
      const bg = background(focused);
      if (choice.recordStart) this.box(group ?? scroll, { id: `record-rule-${index}`, height: 1, marginX: 1, border: ['top'], borderColor: this.color ? choice.kind === 'price' ? theme.priceBorder : theme.recordBorder : undefined });
      let pressed = false, hovered = false;
      let paintRow = () => {};
      const recordFocus = Boolean(choice.turnGroup && choice.kind !== 'turn');
      const row = this.box(group ?? scroll, { id: `row-${index}`, paddingY: choice.reportGroup && ['subtotal', 'model'].includes(choice.kind ?? '') && !short ? 1 : 0, paddingLeft: choice.reportGroup ? choice.kind === 'model' && !choice.cells ? 2 : 1 : choice.turnGroup ? choice.kind === 'detail' ? 3 : 1 : 1 + (choice.depth ?? 0) * 2, paddingRight: 1, marginBottom: choice.gapAfter && !dense && !choice.turnGroup ? 1 : 0,
        ...(this.color && bg ? { backgroundColor: bg } : {}),
        border: !key || recordFocus ? ['left'] : [],
        borderColor: this.color ? focused ? theme.selectedBorder : choice.depth ? theme.border : theme.background : undefined,
        onMouseOver: () => { hovered = true; paintRow(); }, onMouseOut: () => { hovered = false; paintRow(); },
        onMouseDown: event => { pressed = event.button === 0; }, onMouseUp: event => { if (pressed && event.button === 0) { pressed = false; event.stopPropagation(); this.selected = index; this.finish(choice.id); } } });
      this.rowNodes.push(row);
      if (choice.controls) {
        const controls = this.box(row, { flexDirection: 'row', gap: 2 });
        for (const control of choice.controls) this.button(controls, control.label, control.id, control.active);
      }
      if (choice.metrics) {
        const parts = this.box(row, { id: `breakdown-${index}`, flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, rowGap: 0 });
        for (const [partIndex, metric] of choice.metrics.entries()) {
          const part = this.box(parts, { id: `breakdown-${index}-${partIndex}`, flexDirection: 'row', flexWrap: 'wrap', columnGap: 1, maxWidth: '100%' });
          this.text(part, metric.label, { tone: 'breakdownForeground' });
          const values = this.box(part, { flexDirection: 'row', flexWrap: 'wrap', columnGap: 1, maxWidth: '100%' });
          const value = this.text(values, metric.value, { tone: 'breakdownForeground' }); value.wrapMode = 'none';
          if (metric.amount) { const amount = this.text(values, metric.amount, { tone: 'breakdownForeground' }); amount.wrapMode = 'none'; }
        }
      }
      if (choice.cells) this.table(row, choice.cells, { tone: choice.kind === 'subtotal' ? 'subtotalForeground' : choice.kind === 'model' ? 'modelForeground' : 'foreground', bold: choice.kind === 'subtotal' });
      if (choice.headline) this.headline(row, choice.headline, this.renderer.width < 68, choice.kind);
      if (choice.operation) this.operation(row, choice.operation);
      choice.lines.forEach((line, i) => this.text(row, line, { tone: choice.kind === 'subtotal' ? 'subtotalForeground' : choice.kind === 'model' ? 'modelForeground' : 'foreground', bold: choice.kind === 'subtotal', ...choice.paint?.[i] }));
      if (choice.pricePairs) {
        for (let i = 0; i < choice.pricePairs.length; i += 2) {
          const pairs = this.box(row, { flexDirection: 'row', gap: 1 });
          for (const [offset, pair] of choice.pricePairs.slice(i, i + 2).entries()) {
            const cell = this.box(pairs, { id: `price-pair-${index}-${i + offset}`, width: 0, flexBasis: 0, flexGrow: 1, minWidth: 0, flexDirection: 'row', gap: 1 });
            const label = this.text(cell, pair.label, { tone: 'muted' }); label.flexShrink = 1; label.minWidth = 0; label.flexGrow = 1;
            const value = this.text(cell, pair.value, { tone: 'priceNumber' }); value.wrapMode = 'none';
          }
        }
      }
      if (choice.priceDetail) {
        const detail = this.box(row, { id: `price-detail-${index}`, border: ['left'], paddingX: 1, marginTop: 1,
          ...(this.color ? { backgroundColor: theme.disclosureBackground, borderColor: theme.disclosureBorder } : {}) });
        for (const line of choice.priceDetail.lines) this.text(detail, line, { tone: 'contextForeground' });
        const source = choice.priceDetail.source;
        const link = /^https:\/\/[^\s\x00-\x1f\x7f]+$/.test(source) ? source : undefined;
        this.text(detail, link ? '查看官方模型价格 ↗' : source, { tone: 'priceSource', underline: Boolean(link), link }, `price-source-${index}`);
      }
      if (choice.bar != null && !dense) {
        const fraction = Math.max(0, Math.min(1, choice.bar));
        const bar = this.box(row, { id: `meter-${index}`, height: 1, width: '100%', flexDirection: 'row' });
        if (fraction > 0) this.box(bar, { id: `meter-${index}-fill`, height: 1, width: `${fraction * 100}%`, border: ['bottom'], borderStyle: 'single', borderColor: this.color ? theme.meterForeground : '#888888' });
        if (fraction < 1) this.box(bar, { id: `meter-${index}-track`, height: 1, flexGrow: 1, border: ['bottom'], borderStyle: 'single', borderColor: this.color ? theme.meterBackground : '#555555' });
      }
      paintRow = () => {
        const isSelected = this.selected === index;
        if (this.color) {
          row.backgroundColor = hovered && !isSelected && (choice.reportGroup || choice.kind === 'thread' || choice.kind === 'price') ? theme.hoverBackground : background(isSelected);
          if (!key || recordFocus) row.borderColor = isSelected ? recordFocus ? theme.accent : choice.kind === 'price' ? theme.activeTabBorder : theme.selectedBorder : recordFocus ? theme.background : choice.depth ? theme.border : theme.background;
        }
        for (const child of row.getChildren()) if (child instanceof TextRenderable) child.attributes = (choice.kind === 'subtotal' ? TextAttributes.BOLD : 0) | (!this.color && isSelected ? TextAttributes.INVERSE : 0);
        if (choice.reportGroup && ['model', 'subtotal'].includes(choice.kind ?? '') || !this.color) {
          const repaint = (parent: BoxRenderable) => {
            for (const child of parent.getChildren()) {
              if (child instanceof TextRenderable) {
                const source = this.textSources.get(child);
                if (source) child.content = this.styledContent(source.content, { ...source.paint, inverse: !this.color && isSelected });
              } else if (child instanceof BoxRenderable) repaint(child);
            }
          };
          repaint(row);
        }
      };
      this.selectionPaint.push(paintRow);
      if (choice.separatorAfter) this.box(group ?? scroll, { height: 1, border: ['bottom'], borderColor: this.color ? theme.border : undefined });
    }
    if (!frame.choices.length) for (const line of frame.empty ?? ['暂无记录']) this.text(scroll, line, { tone: 'muted' });
    if ((frame.totalCells || frame.total) && !dense) {
      const total = this.box(area, { id: 'total', paddingLeft: 2, paddingRight: 1, border: ['top'], borderColor: this.color ? theme.border : undefined });
      if (frame.totalCells) this.table(total, frame.totalCells, { tone: 'pageTitle', bold: true }); else this.text(total, frame.total!, { tone: 'pageTitle', bold: true });
    }
    if (frame.actions && !dense) {
      const actions = this.box(area, { id: 'actions', flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginTop: short ? 0 : 1 });
      for (const label of frame.actions.split(' · ')) {
        const key = label[0].toLowerCase(), id = key === 't' ? 'theme' : key === 'b' ? 'back' : frame.shortcuts?.[key];
        const action = this.text(actions, label, { tone: 'actionForeground' });
        action.onMouseUp = event => { if (event.button !== 0) return; if (id === 'theme') { this.theme = nextTerminalTheme(theme); this.draw(false); } else if (id) this.finish(id); };
      }
    }
    const footer = this.box(area, { id: 'footer', height: frame.disclosure ? '55%' : undefined, flexShrink: frame.disclosure ? 1 : 0, minHeight: frame.disclosure ? dense ? 4 : 3 : undefined, border: ['top'], borderColor: this.color ? theme.border : undefined, marginTop: short ? 0 : 1 });
    if (frame.status) this.text(footer, frame.status, { tone: 'muted' });
    for (const line of (dense ? frame.compactFooter ?? '↑↓ 选择 · Enter 查看 · Tab 切换\nF 筛选 · ? 说明 · Q 退出' : frame.footer).split('\n')) {
      const links = this.box(footer, { flexDirection: 'row', flexWrap: 'wrap', gap: 1 });
      for (const label of line.split(' · ')) {
        const key = label.split(' ')[0].toLowerCase();
        const link = this.text(links, key === '?' ? `${frame.disclosure ? '⌄' : '›'} ${label}` : label, { tone: key === '?' ? 'disclosureSummary' : 'footerForeground' }, key === '?' ? 'footer-explain' : undefined);
        const id = ({ '?': 'explain', q: 'quit', esc: 'back', tab: 'tab', f: 'filters' } as Record<string, string>)[key] ?? frame.shortcuts?.[key];
        if (id) link.onMouseUp = event => { if (event.button === 0) this.finish(id); };
      }
    }
    if (frame.disclosure) {
      const panel = this.box(footer, { id: 'disclosure-panel', border: ['left'], paddingX: 1, flexShrink: 1, minHeight: 1,
        ...(this.color ? { backgroundColor: theme.disclosureBackground, borderColor: theme.disclosureBorder } : {}) });
      const notes = new ScrollBoxRenderable(this.renderer, { id: 'notes', height: 'auto', flexShrink: 1, minHeight: 1, scrollX: false, scrollY: true });
      panel.add(notes); notes.verticalScrollBar.visible = false; notes.horizontalScrollBar.visible = false; this.notes = notes;
      for (const line of frame.disclosure) this.text(notes, line, { tone: 'disclosureForeground' });
      if (frame.disclosureAction) {
        const action = this.text(notes, frame.disclosureAction.label, { tone: 'priceSource', underline: true }, 'disclosure-action');
        action.onMouseUp = event => { if (event.button === 0) this.finish(frame.disclosureAction!.id); };
      }
    }
    this.selectionPaint.forEach(paint => paint());
    const version = this.redrawVersion;
    this.renderer.once('frame', () => {
      if (this.disposed || version !== this.redrawVersion || this.scroll !== scroll) return;
      if (this.notes) {
        // Use native wrapped child bounds: short notes stay compact, long notes are
        // constrained by the footer's native percentage height and ScrollBox clipping.
        const content = this.notes.content;
        const contentHeight = content.getChildren().reduce((bottom, child) => Math.max(bottom, child.y + child.height - content.y), 1);
        const availableHeight = Math.max(1, footer.y + footer.height - this.notes.y);
        const visibleHeight = Math.min(contentHeight, availableHeight);
        this.notes.height = visibleHeight;
        footer.height = Math.min(footer.height, this.notes.y - footer.y + visibleHeight);
      }
      scroll.scrollTo(saved);
      if (reveal) this.renderer.once('frame', () => {
        if (this.disposed || version !== this.redrawVersion || this.scroll !== scroll) return;
        const row = this.rowNodes[this.selected];
        if (row) scroll.scrollChildIntoView(frame.choices[this.selected]?.metrics ? `breakdown-${this.selected}-0` : row.id);
        const next = frame.choices[this.selected + 1];
        if (next?.kind === 'detail') scroll.scrollChildIntoView(next.metrics ? `breakdown-${this.selected + 1}-0` : this.rowNodes[this.selected + 1].id);
        queueMicrotask(() => { if (!this.disposed && version === this.redrawVersion) this.renderer.requestRender(); });
      });
      this.renderer.requestRender();
    });
    this.renderer.requestRender();
  }

  loading(message: string): void {
    if (this.disposed || this.signal.aborted) return;
    this.loadingState = { spec: { kind: 'query', message }, cancelling: false };
    this.drawLoading();
  }
  async task<T>(spec: LoadingSpec, run: (options: { signal: AbortSignal; onProgress: (stage: string) => void }) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const signal = AbortSignal.any([this.signal, controller.signal]);
    const state: LoadingState = { spec, cancelling: false, expanded: false };
    this.loadingState = state;
    const expand = setTimeout(() => {
      if (this.loadingState !== state || this.disposed) return;
      state.expanded = true;
      this.drawLoading();
    }, 250);
    this.cancelOperation = () => {
      if (signal.aborted) return;
      state.cancelling = true;
      controller.abort();
      this.drawLoading();
    };
    this.drawLoading();
    try {
      if (signal.aborted) throw new OperationCancelled();
      const result = await run({ signal, onProgress: stage => {
        if (signal.aborted || this.loadingState !== state || this.disposed) return;
        state.stage = terminalText(stage); this.drawLoading();
      } });
      if (signal.aborted) throw new OperationCancelled();
      return result;
    } catch (error) {
      if (signal.aborted) throw new OperationCancelled();
      throw error;
    } finally {
      clearTimeout(expand);
      if (this.loadingState === state) { this.loadingState = undefined; this.cancelOperation = undefined; }
    }
  }
  private drawLoading(): void {
    if (this.disposed || !this.loadingState) return;
    this.frame = undefined;
    const state = this.loadingState, content = loadingContent(state), theme = this.theme;
    const narrow = this.renderer.width < 68, short = this.renderer.height < 30, dense = this.renderer.height < 20;
    const area = this.base();
    const header = this.box(area, { border: dense ? [] : ['bottom'], borderColor: this.color ? theme.border : undefined });
    this.title(header, 'Wombat / ' + (state.spec.activeTab === 'threads' ? '对话' : '用量'));
    if (!dense) this.text(header, '本机 Codex · ' + content.context, { tone: 'muted' });
    const nav = this.box(area, { id: 'loading-navigation', flexDirection: 'row', gap: 3, border: dense ? [] : ['bottom'], borderColor: this.color ? theme.border : undefined });
    for (const [tab, label] of [['usage', '1 用量'], ['threads', '2 对话']]) {
      const active = tab === (state.spec.activeTab ?? 'usage');
      const item = this.box(nav, { height: 2, border: ['bottom'], borderColor: this.color ? active ? theme.activeTabBorder : theme.background : undefined });
      this.text(item, label, { tone: active ? 'activeTabForeground' : 'muted', underline: active && !this.color });
    }
    const scroll = new ScrollBoxRenderable(this.renderer, { id: 'loading-scroll', flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 1, scrollX: false, scrollY: true, contentOptions: { alignItems: 'center' }, verticalScrollbarOptions: { visible: false } });
    area.add(scroll); scroll.verticalScrollBar.visible = false;
    const scene = this.box(scroll, { id: 'startup-scene', width: '100%', maxWidth: 90, marginTop: short ? 0 : 1, paddingTop: dense ? 0 : 1, border: ['top'], borderColor: this.color ? theme.startupBorder : undefined });
    const mast = this.box(scene, { flexDirection: 'row', justifyContent: 'space-between', gap: 1 });
    this.text(mast, content.context, { tone: 'brand', bold: true });
    if (!narrow) this.text(mast, '本机 · Codex', { tone: 'startupSource' });
    this.text(scene, content.heading, { tone: 'startupHeading', bold: true }, 'startup-heading');
    if (state.expanded && !narrow && !dense && content.description) this.text(scene, content.description, { tone: 'startupDescription' });
    if (state.expanded) {
      const track = this.box(scene, { id: 'startup-track', border: ['left'], borderColor: this.color ? theme.turnBorder : undefined, paddingLeft: 1, marginTop: dense ? 0 : 1 });
      for (const [i, stage] of content.stages.entries()) {
        const row = this.box(track, { id: `startup-stage-${i}`, flexDirection: 'row', gap: 1, border: dense ? [] : ['bottom'], borderColor: this.color ? theme.startupRule : undefined, paddingX: dense ? 0 : 1, ...(this.color ? { backgroundColor: theme.subtotalBackground } : {}) });
        this.text(row, '◆', { tone: 'startupActiveMarker' });
        const name = this.text(row, stage.name, { tone: 'startupActive' }); name.flexGrow = 1; name.flexShrink = 1; name.minWidth = 0;
        this.text(row, '正在进行', { tone: 'startupActiveState' });
      }
      if (content.detail) this.text(scene, content.detail, { tone: 'startupDescription' });
    }
    if (state.expanded && !dense) {
      const close = this.box(scene, { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 1, marginTop: 1 });
      if (!narrow && content.assurance) this.text(close, content.assurance, { tone: 'startupAssurance' });
      this.text(close, content.destination, { tone: 'startupDestination' });
    }
    const footer = this.box(area, { border: ['top'], borderColor: this.color ? theme.border : undefined, flexDirection: 'row', flexWrap: 'wrap', gap: 2 });
    const cancel = this.text(footer, 'X / Esc ' + content.cancel, { tone: 'actionForeground' }, 'loading-cancel');
    cancel.onMouseUp = event => { if (event.button === 0) this.cancelOperation?.(); };
    const quit = this.text(footer, 'Q 退出', { tone: 'footerForeground' });
    quit.onMouseUp = event => { if (event.button === 0) { this.terminationCode = 0; this.interrupt(); } };
    this.renderer.requestRender();
  }
  async form(spec: FormSpec): Promise<FormAnswer> {
    if (this.signal.aborted) return { action: 'cancel', values: spec.values, changed: [] };
    this.frame = undefined;
    const area = this.base();
    const heading = this.box(area, { id: 'form-heading', border: this.renderer.height < 20 ? [] : ['bottom'], borderColor: this.color ? this.theme.border : undefined });
    this.title(heading, spec.title);
    const nav = this.box(area, { id: 'form-navigation', flexDirection: 'row', gap: 3, border: this.renderer.height < 20 ? [] : ['bottom'], borderColor: this.color ? this.theme.border : undefined });
    this.button(nav, '1 用量', 'usage-tab', spec.activeTab === 'usage', false, () => this.activeForm?.finish('usage-tab'), this.renderer.height >= 20);
    this.button(nav, '2 对话', 'threads-tab', spec.activeTab === 'threads', false, () => this.activeForm?.finish('threads-tab'), this.renderer.height >= 20);
    const form = new NativeForm(this.renderer, area, spec, this.theme, this.color); this.activeForm = form;
    try { return await form.run(); }
    finally { form.dispose(); this.activeForm = undefined; }
  }
  async input(config: { title: string; value: string }): Promise<string | null> {
    if (this.signal.aborted) return null;
    const area = this.base();
    this.title(area, `Wombat / ${config.title}`);
    const panel = this.box(area, { border: true, borderStyle: 'rounded', borderColor: this.theme.selectedBorder, height: 3, marginTop: 1, paddingX: 1 });
    const editor = new InputRenderable(this.renderer, { id: 'input', value: config.value, width: '100%', ...(this.color ? { textColor: this.theme.foreground, backgroundColor: this.theme.background, focusedBackgroundColor: this.theme.selectedBackground } : {}) });
    panel.add(editor); this.editor = editor;
    this.text(area, 'Enter 确认 · Esc 取消 · Ctrl+U 清空', { tone: 'muted' });
    editor.focus();
    try { return await new Promise(resolve => { this.inputPending = resolve; editor.on('enter', () => resolve(terminalText(editor.value))); }); }
    finally { this.editor = undefined; this.inputPending = undefined; }
  }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true; this.controller.abort();
    this.activeForm?.finish('cancel');
    process.removeListener('SIGINT', this.interrupt); process.removeListener('SIGTERM', this.interrupt);
    this.renderer.keyInput.off('keypress', this.key); this.renderer.off('resize', this.resize);
    this.renderer.destroy();
  }
}
export async function createTerminalUI(): Promise<TerminalUI> {
  return new TerminalUI(await createCliRenderer({ exitOnCtrlC: false, exitSignals: [], useMouse: true, screenMode: 'alternate-screen', consoleMode: 'disabled', openConsoleOnError: false }));
}
