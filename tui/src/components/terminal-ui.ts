import { t, locale } from '@wombat/client/locale';
import { BoxRenderable, ScrollBoxRenderable, TextRenderable, InputRenderable, StyledText, RGBA, TextAttributes, TextBuffer, TextBufferView, BorderChars, createCliRenderer, type CliRenderer, type KeyEvent } from '@opentui/core';
import { terminalTheme, nextTerminalTheme, type TerminalTheme } from '../themes/index.js';
import { terminalText } from '../display-text.js';
import type { Frame, Choice, RowPaint, TableCell } from './view-model.js';
import { NativeForm } from './native-form.js';
import { brandMark } from './brand-mark.js';
import { visualStyles } from './visual-styles.generated.js';
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
  private distributionValueWidth = 9;
  private distributionShareWidth = 9;
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
  private loadingExpansion?: ReturnType<typeof setTimeout>;
  private loadingAnimation?: ReturnType<typeof setInterval>;
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
  private readonly resize = () => { if (this.activeForm) this.activeForm.resize(); else if (this.loadingState) this.drawLoading(); else if (this.frame && !this.editor) { if (this.pending && this.frame.requeryOnResize) this.finish('resize'); else this.draw(true); } };
  choose(frame: Frame): Promise<Answer> {
    if (this.signal.aborted) return Promise.resolve({ id: 'quit', selected: 0, viewportStart: 0 });
    this.stopLoadingTimers(); this.loadingState = undefined;
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
      else if (key.name === 'l') { locale.setLocale(locale.getSnapshot().locale === 'zh' ? 'en' : 'zh'); this.drawLoading(); }
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
    else if (frame.disclosure && ['up', 'down', 'pageup', 'pagedown'].includes(key.name)) { key.preventDefault(); this.scroll?.scrollBy(['up', 'pageup'].includes(key.name) ? -1 : 1, key.name.startsWith('page') ? 'viewport' : 'step'); }
    else if (frame.pageNavigation && (['up','down'].includes(key.name) || !frame.requeryOnResize && ['home','end'].includes(key.name))) finish('cursor:' + key.name);
    else if (key.name === 'up') move(this.selected - 1);
    else if (key.name === 'down') move(this.selected + 1);
    else if (key.name === 'home') { move(0); this.scroll?.scrollTo(0); }
    else if (key.name === 'end') { move(frame.choices.length - 1); if (frame.totalCells || frame.total) this.scroll?.scrollChildIntoView('total'); }
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
  private displayWidth(value: string): number {
    const buffer = TextBuffer.create(this.renderer.widthMethod), view = TextBufferView.create(buffer);
    try { buffer.setText(terminalText(value)); view.setWrapMode('none'); return view.measureForDimensions(Math.max(1, value.length * 2), 1)?.widthColsMax ?? 0; }
    finally { view.destroy(); buffer.destroy(); }
  }
  private button(parent: BoxRenderable, label: string, id: string, active: boolean, outline = false, activate = () => this.finish(id), joinBottomRule = false, disabled = false): void {
    const theme = this.theme;
    let pressed = false, hovered = false;
    const recipe = id === 'metric' ? visualStyles.metric(theme) : visualStyles.period(theme);
    const variant = active ? visualStyles.periodActive(theme) : undefined;
    const boxStyle = { ...recipe.box, ...variant?.box }, contentStyle = { ...recipe.content, ...variant?.content };
    const padding = outline && this.renderer.width >= 68 ? contentStyle.paddingLeft : 0;
    const button = this.box(parent, { id, height: outline ? 3 + contentStyle.paddingTop + contentStyle.paddingBottom : 1, width: this.displayWidth(label) + (outline ? 2 + 2 * padding : 0), border: outline ? boxStyle.border : [], borderStyle: boxStyle.borderStyle, marginBottom: joinBottomRule ? -1 : 0,
      ...(this.color ? { borderColor: outline ? boxStyle.borderColor : active ? theme.activeTabBorder : joinBottomRule ? theme.border : theme.background, backgroundColor: boxStyle.backgroundColor, focusedBorderColor: theme.focus } : {}),
      focusable: !disabled, onMouseDown: event => { pressed = !disabled && event.button === 0; }, onMouseUp: event => { if (pressed && event.button === 0) { pressed = false; event.stopPropagation(); activate(); } }, onKeyDown: key => { if (!disabled && (key.name === 'return' || key.name === 'space')) { key.preventDefault(); key.stopPropagation(); activate(); } } });
    const surface = outline ? this.box(button, { paddingX: padding, paddingTop: contentStyle.paddingTop, paddingBottom: contentStyle.paddingBottom, ...(this.color ? { backgroundColor: contentStyle.backgroundColor } : {}) }) : button;
    const caption = this.text(surface, label, { tone: id === 'metric' ? 'heading' : ['presentation', 'sort'].includes(id) ? 'tablePartForeground' : active ? outline ? 'activeControlForeground' : 'activeTabForeground' : outline ? 'controlForeground' : 'muted', bold: active && id.endsWith('-tab'), underline: active && !this.color }, `${id}-label`);
    caption.wrapMode = 'none';
    caption.height = 1;
    const repaint = () => {
      if (caption.isDestroyed || button.isDestroyed) return;
      const focus = button.focused;
      const background = disabled ? theme.background : hovered ? theme.hoverBackground : outline ? contentStyle.backgroundColor : theme.background;
      if (this.color) { button.backgroundColor = outline ? boxStyle.backgroundColor : background; surface.backgroundColor = background; button.borderColor = focus ? theme.focus : disabled ? theme.border : boxStyle.borderColor; }
      const source = this.textSources.get(caption)!;
      caption.content = this.styledContent(label, { ...source.paint, ...(disabled ? { tone: 'muted' as const } : focus ? { tone: 'focus' as const } : hovered ? { tone: 'heading' as const } : {}), underline: active && id.startsWith('step-sort:') || focus || source.paint.underline, inverse: !this.color && focus });
    };
    button.onMouseOver = () => { if (!disabled && ['metric', 'presentation', 'sort'].includes(id)) { hovered = true; repaint(); } };
    button.onMouseOut = () => { hovered = false; repaint(); };
    button.on('focused', repaint); button.on('blurred', repaint); repaint();
  }
  private table(parent: BoxRenderable, cells: TableCell[], paint: RowPaint = {}): void {
    // In compact reports, move an oversized date or model label above the
    // numeric tracks so the label remains readable and amounts stay aligned.
    let separateLabel = Boolean(cells[0]?.stackWhenLong && cells.length === 3);
    if ((cells[0]?.date || cells[0]?.stackWhenLong) && cells.length === 3) {
      const buffer = TextBuffer.create(this.renderer.widthMethod);
      const view = TextBufferView.create(buffer);
      try {
        buffer.setText(cells[0].text); view.setWrapMode('none');
        // Compact shell padding (2), row insets (3), and two column gutters.
        const available = this.renderer.width - 2 - 3 - 2 - (cells[1].width ?? 0) - (cells[2].width ?? 0);
        separateLabel ||= (view.measureForDimensions(this.renderer.width, 1)?.widthColsMax ?? 0) > available;
      } finally { view.destroy(); buffer.destroy(); }
      if (separateLabel) {
        const label = this.text(parent, cells[0].text, { ...paint, tone: cells[0].tone,
          ...(cells[0].date ? { spans: [{ start: cells[0].text.length - 1, end: cells[0].text.length, tone: 'tableMarkerForeground' as const }] } : {}) }, `${parent.id}-label`);
        if (cells[0].date) { label.wrapMode = 'none'; label.height = 1; }
      }
    }
    const grid = this.box(parent, { id: `${parent.id}-grid`, width: '100%', flexDirection: 'row', gap: 1 });
    for (let index = 0; index < cells.length; index++) {
      const cell = cells[index];
      const span = cell.date && cells.length > 3 ? 3 : 1;
      const tracks = cells.slice(index, index + span);
      const grow = tracks.reduce((sum, track) => sum + (track.grow ?? 0), 0);
      const minWidth = tracks.reduce((sum, track) => sum + (track.grow ? track.minWidth ?? 0 : track.width ?? 0), span - 1);
      const width = grow ? undefined : tracks.reduce((sum, track) => sum + (track.width ?? 0), span - 1);
      const column = this.box(grid, { id: `${parent.id}-column-${index}`, width: grow ? 0 : width, flexGrow: grow, flexBasis: grow ? cell.growBasis : undefined, flexShrink: grow ? 1 : 0, minWidth: span > 1 ? minWidth : cell.minWidth ?? 0, paddingLeft: cell.inset ?? 0 });
      const text = this.text(column, index === 0 && separateLabel ? '' : cell.text, { ...paint, ...(cell.tone ? { tone: cell.tone } : {}), ...(cell.bold != null ? { bold: cell.bold } : {}),
        ...(cell.tone === 'subtotalForeground' && cell.text.endsWith(' ›') ? { spans: [{ start: cell.text.length - 1, end: cell.text.length, tone: 'tableMarkerForeground' as const }] } : {}) });
      text.textAlign = cell.align ?? 'left';
      if (width != null) text.width = Math.max(0, width - (cell.inset ?? 0));
      if (cell.date || cell.stackWhenLong || cell.align === 'right' && cell.tone !== undefined) { text.wrapMode = 'none'; text.height = 1; }
      index += span - 1;
    }
  }
  private headline(parent: BoxRenderable, value: { label: string; amount: string }, narrow: boolean, kind?: Choice['kind']): void {
    const head = this.box(parent, { flexDirection: narrow ? 'column' : 'row', gap: narrow ? 0 : 2 });
    const label = this.box(head, { flexGrow: 1, flexShrink: 1, minWidth: 0 });
    this.text(label, value.label, { tone: kind === 'measurement' ? 'operationName' : kind === 'model' ? 'modelForeground' : kind === 'subtotal' ? 'subtotalForeground' : 'heading', bold: !['measurement', 'model'].includes(kind ?? ''), spans: /^[›⌄] /.test(value.label) ? [{ start: 0, end: 1, tone: 'disclosureMarker', bold: false }] : [] });
    const amount = this.box(head, { flexShrink: 0, maxWidth: narrow ? '100%' : '55%' });
    this.text(amount, value.amount, { tone: kind === 'model' ? 'tablePartForeground' : kind === 'subtotal' ? 'subtotalForeground' : 'number', bold: kind !== 'model' }).textAlign = narrow ? 'left' : 'right';
  }
  private distributionTracks(parent: BoxRenderable, id: string): BoxRenderable[] {
    // The source uses 1.3fr / 2fr / 9ch / 9ch. Header and records
    // share both tracks and insets, including the selection rail cell.
    const valueWidth = this.distributionValueWidth;
    const flexible = Math.min(this.renderer.width, 120) - 4 - 3 - 3 - valueWidth - this.distributionShareWidth;
    const dateWidth = Math.max(16, Math.floor(flexible * 1.3 / 3.3));
    return [
      this.box(parent, { id: id + '-date-track', width: dateWidth, flexDirection: 'row', flexWrap: 'wrap', gap: 1 }),
      this.box(parent, { id: id + '-meter-track', width: flexible - dateWidth }),
      this.box(parent, { id: id + '-value-track', width: valueWidth }),
      this.box(parent, { id: id + '-share-track', width: this.distributionShareWidth }),
    ];
  }
  private distributionRow(parent: BoxRenderable, value: NonNullable<Choice['distribution']>): TextRenderable {
    const narrow = this.renderer.width < 68;
    const row = this.box(parent, { id: parent.id + '-distribution', flexDirection: narrow ? 'column' : 'row', alignItems: narrow ? 'stretch' : 'center', gap: narrow ? 0 : 1 });
    let title: BoxRenderable, track: BoxRenderable, amountTrack: BoxRenderable, shareTrack: BoxRenderable;
    if (narrow) {
      const upper = this.box(row, { flexDirection: 'row', gap: 1 });
      title = this.box(upper, { flexDirection: 'row', gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 });
      amountTrack = this.box(upper, { width: this.distributionValueWidth });
      const lower = this.box(row, { flexDirection: 'row', gap: 1 });
      track = this.box(lower, { flexGrow: 1, flexShrink: 1, minWidth: 0 });
      shareTrack = this.box(lower, { width: this.distributionValueWidth });
    } else [title, track, amountTrack, shareTrack] = this.distributionTracks(row, parent.id);
    const label = this.text(title, value.label, { tone: 'foreground' }, parent.id + '-distribution-date');
    label.flexShrink = 1; label.minWidth = 0; label.wrapMode = 'none'; label.height = 1;
    if (value.peak) this.text(title, value.peakLabel ?? t('tui.report.peak'), { tone: 'accent' });
    // CSS centers the thin meter in the text line. A lower block (▃) has
    // the right area but paints below that center, even in an aligned box.
    // A centered heavy rule preserves alignment without a full-cell fill.
    const meterChars = { ...BorderChars.single, horizontal: '━' };
    const meter = this.box(track, { id: parent.id + '-meter', height: 1, width: '100%', flexDirection: 'row' });
    if (value.ratio != null) {
      const ratio = Math.max(0, Math.min(1, value.ratio));
      if (ratio > 0) this.box(meter, { id: parent.id + '-fill', width: `${ratio * 100}%`, height: 1, border: ['bottom'], customBorderChars: meterChars, borderColor: this.color ? value.peak ? this.theme.accent : this.theme.tablePartForeground : undefined });
      if (ratio < 1) this.box(meter, { id: parent.id + '-track', flexGrow: 1, height: 1, border: ['bottom'], customBorderChars: meterChars, borderColor: this.color ? this.theme.meterBackground : undefined });
    } else this.box(meter, { id: parent.id + '-unknown-track', width: '100%', height: 1, border: ['bottom'], customBorderChars: { ...BorderChars.single, horizontal: '┅' }, borderColor: this.color ? this.theme.meterBackground : undefined });
    const amount = this.text(amountTrack, value.value, { tone: 'heading', bold: true }, parent.id + '-distribution-value'); amount.textAlign = 'right'; amount.wrapMode = 'none'; amount.height = 1;
    const share = this.text(shareTrack, value.share, { tone: 'muted' }, parent.id + '-distribution-share'); share.textAlign = 'right'; share.wrapMode = 'none'; share.height = 1;
    return label;
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
  private clear(): void { this.redrawVersion++; this.tree?.destroyRecursively(); this.tree = undefined; this.rowNodes = []; this.selectionPaint = []; this.textSources.clear(); this.scroll = undefined; }
  private base(): BoxRenderable {
    this.clear();
    const root = new BoxRenderable(this.renderer, { id: 'wombat', width: '100%', height: '100%', alignItems: 'center', ...(this.color ? { backgroundColor: this.theme.background } : {}) });
    this.renderer.root.add(root); this.tree = root;
    return this.box(root, { id: 'content', width: '100%', maxWidth: 120, height: '100%', paddingX: this.renderer.width >= 68 ? 2 : 1, paddingTop: this.renderer.height < 30 ? 0 : 1, flexDirection: 'column' });
  }
  private header(parent: BoxRenderable, title: string, intro: string[], active: 'usage' | 'threads', navigation = true, select?: (id: string) => void, status?: string): void {
    const heading = this.box(parent, { id: 'heading', border: ['bottom'], borderColor: this.color ? this.theme.border : undefined });
    // Round the odd text/image half-cell difference consistently for both
    // the nested brand line and its sibling navigation.
    const top = this.box(heading, { id: 'brand-navigation', flexDirection: 'row', alignItems: 'flex-start', gap: 1 });
    const brand = this.box(top, { id: 'brand-lockup', flexDirection: 'row', alignItems: 'center', gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 });
    brand.add(brandMark(this.renderer, this.color ? this.theme.brand : undefined));
    this.text(brand, 'Wombat', { tone: 'brand', bold: true }, 'brand');
    this.text(brand, 'v0.3.0', { tone: 'muted' }, 'version');
    if (navigation) {
      const nav = this.box(top, { id: 'navigation', flexDirection: 'row', gap: this.renderer.width < 68 ? 1 : 3 });
      this.button(nav, t('common.usage'), 'usage-tab', active === 'usage', false, select ? () => select('usage-tab') : undefined);
      this.button(nav, t('common.threads'), 'threads-tab', active === 'threads', false, select ? () => select('threads-tab') : undefined);
    }
    const caption = this.text(heading, title.replace(/^Wombat \/ /, ''), { tone: 'pageTitle', bold: true }, 'title');
    caption.width = '100%'; caption.maxHeight = this.renderer.width < 68 ? 1 : 2;
    if (this.renderer.width < 68) { caption.wrapMode = 'none'; caption.truncate = true; }
    const meta = this.box(heading, { id: 'header-meta', flexDirection: 'row', flexWrap: 'wrap', columnGap: 2 });
    const scope = this.box(meta, { flexGrow: 1, flexShrink: 1, minWidth: Math.min(24, this.renderer.width - 4) });
    for (const line of intro) {
      const label = this.text(scope, line, { tone: 'muted' });
      if (this.renderer.width < 68) { label.height = 1; label.wrapMode = 'none'; label.truncate = true; }
    }
    if (status) { const notice = this.text(meta, status, { tone: 'warning' }, 'data-status'); notice.maxWidth = '100%'; notice.maxHeight = 2; }
  }
  private draw(reveal: boolean, initialScroll?: number): void {
    if (this.disposed || !this.frame) return;
    const saved = initialScroll ?? this.scroll?.scrollTop ?? 0;
    const frame = this.resolved(), theme = this.theme, dense = this.renderer.height < 20, short = this.renderer.height < 30;
    this.distributionValueWidth = 9;
    this.distributionShareWidth = 9;
    if (frame.distributionHeader) {
      const buffer = TextBuffer.create(this.renderer.widthMethod), view = TextBufferView.create(buffer);
      try {
        view.setWrapMode('none');
        buffer.setText(frame.distributionHeader.share);
        this.distributionShareWidth = Math.max(9, view.measureForDimensions(this.renderer.width, 1)?.widthColsMax ?? 0);
        for (const choice of frame.choices) if (choice.distribution) {
          buffer.setText(choice.distribution.value);
          this.distributionValueWidth = Math.max(this.distributionValueWidth, view.measureForDimensions(this.renderer.width, 1)?.widthColsMax ?? 0);
        }
      } finally { view.destroy(); buffer.destroy(); }
    }
    this.selected = Math.max(0, Math.min(frame.pageNavigation ? frame.selected ?? this.selected : this.selected, frame.choices.length - 1));
    const area = this.base();
    this.header(area, frame.title, dense ? frame.compactIntro ?? frame.intro.slice(0, 1) : frame.intro, frame.activeTab === t('common.2_threads') ? 'threads' : 'usage', Boolean(frame.nav), undefined, frame.status);
    const scroll = new ScrollBoxRenderable(this.renderer, { id: 'records', flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 1, scrollX: false, scrollY: true, viewportCulling: true, contentOptions: { flexDirection: 'column' }, verticalScrollbarOptions: { visible: false } });
    area.add(scroll); scroll.verticalScrollBar.visible = false; scroll.horizontalScrollBar.visible = false; this.scroll = scroll;
    if (frame.notice) {
      const notice = this.box(scroll, { id: 'read-notice', border: ['left'], paddingX: 1, marginBottom: 1, borderColor: this.color ? theme.warning : undefined });
      this.text(notice, frame.notice, { tone: 'warning' });
    }
    for (const [index, line] of (frame.context ?? []).entries()) {
      const parent = line.notice ? this.box(scroll, { id: `context-notice-${index}`, border: ['left'], paddingX: 1, marginBottom: 1, borderColor: this.color ? theme.warning : undefined }) : scroll;
      this.text(parent, line.text, { tone: line.notice ? 'warning' : line.summary ? 'summaryForeground' : 'contextForeground' }, `context-${index}`);
    }
    if (frame.controlOptions || frame.tools) {
      if (frame.controlLabel) this.text(scroll, frame.controlLabel, { tone: 'muted' }, 'controls-label').marginTop = dense ? 0 : 1;
      const available = Math.min(this.renderer.width, 120) - (this.renderer.width < 68 ? 2 : 4);
      const padding = this.renderer.width < 68 ? 0 : 2;
      const optionsWidth = (frame.controlOptions ?? []).reduce((sum, label) => sum + this.displayWidth(label) + 2 + padding + 1, 0);
      const toolsWidth = (frame.tools ?? []).reduce((sum, tool) => sum + this.displayWidth(tool.label) + (tool.id === 'metric' ? 2 + padding : 0) + 1, 0);
      const compactTools = this.renderer.width < 68 || optionsWidth + toolsWidth > available;
      const controls = this.box(scroll, { id: 'period-sort', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 1, marginTop: short ? 0 : 1 });
      const periods = this.box(controls, { flexDirection: 'row', alignItems: 'center', gap: this.renderer.width < 68 ? 0 : 1, maxWidth: '100%', flexWrap: 'wrap' });
      frame.controlOptions?.forEach((label, i) => this.button(periods, label, `${frame.controlKind ?? 'sort'}:${i}`, label === frame.activeControl?.trim(), true));
      if (frame.tools?.length) {
        const tools = this.box(controls, { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: this.renderer.width < 68 ? 0 : 1, flexGrow: 1 });
        for (const tool of frame.tools) this.button(tools, compactTools ? tool.compactLabel : tool.label, tool.id, false, tool.id === 'metric', undefined, false, tool.disabled);
      }
    }
    if (frame.peakActions?.length && this.renderer.width >= 68) {
      const peaks = this.box(scroll, { id: 'peak-shortcuts', flexDirection: 'row', flexWrap: 'wrap', gap: 1 });
      for (const peak of frame.peakActions) { const link = this.text(peaks, peak.label, { tone: 'heading', spans: [{ start: 0, end: peak.label.indexOf(' · '), tone: 'accent', bold: true }] }); link.onMouseUp = e => { if (e.button === 0) this.finish(peak.id); }; }
    }
    if (frame.distributionHeader) {
      const head = this.box(scroll, { id: 'distribution-header', flexDirection: 'row', gap: 1, paddingLeft: 2, paddingRight: 1, border: ['bottom'], borderColor: this.color ? theme.border : undefined });
      if (this.renderer.width < 68) {
        this.text(head, t('common.date'), { tone: 'muted' }).flexGrow = 1;
        this.text(head, frame.distributionHeader.metric, { tone: 'muted' }).textAlign = 'right';
      } else {
        const [date, scale, value, share] = this.distributionTracks(head, 'distribution-header');
        this.text(date, t('common.date'), { tone: 'muted' });
        scale.flexDirection = 'row'; scale.justifyContent = 'space-between';
        this.text(scale, '0', { tone: 'muted' });
        this.text(scale, frame.distributionHeader.maximum, { tone: 'muted' });
        this.text(value, frame.distributionHeader.metric, { tone: 'muted' }).textAlign = 'right';
        this.text(share, frame.distributionHeader.share, { tone: 'muted' }).textAlign = 'right';
      }
    }
    const tableHeader = (parent: BoxRenderable) => {
      const header = this.box(parent, { id: 'table-header', paddingLeft: 2, paddingRight: 1, border: [frame.tableHeaderBorder ?? 'bottom'], borderColor: this.color ? theme.border : undefined, marginTop: short ? 0 : 1 });
      if (frame.tableCells) this.table(header, frame.tableCells, { tone: 'muted' }); else this.text(header, frame.tableHeader!, { tone: 'muted' });
    };
    if (frame.tableCells || frame.tableHeader) tableHeader(scroll);
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
      const background = (selected: boolean) => choice.distribution ? selected ? theme.selectedBackground : theme.background : selected && (choice.kind === 'thread' || choice.kind === 'price') ? theme.selectedThreadBackground : selected && !['turn', 'operation', 'detail', 'control', 'measurement'].includes(choice.kind ?? '') ? theme.selectedBackground : choice.kind === 'subtotal' ? theme.subtotalBackground : choice.kind === 'detail' || choice.kind === 'measurement' && choice.expanded ? theme.detailBackground : theme.background;
      const bg = background(focused);
      if (choice.recordStart) this.box(group ?? scroll, { id: `record-rule-${index}`, height: 1, marginX: 1, border: ['top'], borderColor: this.color ? choice.kind === 'price' ? theme.priceBorder : theme.recordBorder : undefined });
      let pressed = false, hovered = false;
      let separator: BoxRenderable | undefined, separatorRail: BoxRenderable | undefined;
      let paintRow = () => {};
      const recordFocus = Boolean(choice.turnGroup && choice.kind !== 'turn');
      const pointer = {
        onMouseOver: () => { hovered = true; paintRow(); }, onMouseOut: () => { hovered = false; paintRow(); },
        onMouseDown: (event: import('@opentui/core').MouseEvent) => { pressed = event.button === 0; },
        onMouseUp: (event: import('@opentui/core').MouseEvent) => { if (pressed && event.button === 0) { pressed = false; event.stopPropagation(); this.selected = index; this.finish(choice.id); } },
      };
      // Keep the entire distribution surface in the native scroll target,
      // including the bottom inset/rule, rather than revealing only its text.
      const distributionRecord = choice.distribution && choice.separatorAfter ? this.box(group ?? scroll, { id: `distribution-record-${index}` }) : undefined;
      const row = this.box(distributionRecord ?? group ?? scroll, { id: `row-${index}`, ...(distributionRecord ? { paddingTop: 1 } : {}), ...(choice.kind === 'thread' && !dense ? { paddingBottom: 1 } : {}), paddingLeft: choice.reportGroup ? choice.kind === 'model' && !choice.cells ? 2 : 1 : choice.turnGroup ? choice.kind === 'detail' ? 3 : 1 : 1 + (choice.depth ?? 0) * 2, paddingRight: 1, marginBottom: choice.gapAfter && !dense && !choice.turnGroup && choice.kind !== 'thread' ? 1 : 0,
        ...(this.color && bg ? { backgroundColor: bg } : {}),
        border: choice.kind !== 'control' && (!key || recordFocus) ? ['left'] : [],
        borderColor: this.color ? focused ? theme.selectedBorder : choice.depth ? theme.border : theme.background : undefined,
        ...pointer });
      this.rowNodes.push(distributionRecord ?? row);
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
      const distributionDate = choice.distribution ? this.distributionRow(row, choice.distribution) : undefined;
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
        const detail = this.box(group ?? scroll, { id: `price-detail-${index}`, border: ['left'], paddingX: 1, marginTop: 1,
          ...(this.color ? { backgroundColor: theme.disclosureBackground, borderColor: theme.disclosureBorder } : {}) });
        for (const line of choice.priceDetail.lines) this.text(detail, line, { tone: 'contextForeground' });
        const source = choice.priceDetail.source;
        const link = /^https:\/\/[^\s\x00-\x1f\x7f]+$/.test(source) ? source : undefined;
        this.text(detail, link ? t("tui.components.terminal-ui.view_official_model_prices") : source, { tone: 'priceSource', underline: Boolean(link), link }, `price-source-${index}`);
      }
      if (choice.bar != null) {
        const fraction = Math.max(0, Math.min(1, choice.bar));
        const bar = this.box(row, { id: `meter-${index}`, height: 1, width: '100%', flexDirection: 'row' });
        if (fraction > 0) this.box(bar, { id: `meter-${index}-fill`, height: 1, width: `${fraction * 100}%`, border: ['bottom'], borderStyle: 'single', borderColor: this.color ? theme.meterForeground : '#888888' });
        if (fraction < 1) this.box(bar, { id: `meter-${index}-track`, height: 1, flexGrow: 1, border: ['bottom'], borderStyle: 'single', borderColor: this.color ? theme.meterBackground : '#555555' });
      }
      paintRow = () => {
        const isSelected = this.selected === index;
        if (this.color) {
          const surface = hovered && (choice.distribution || !isSelected && (choice.reportGroup || choice.kind === 'thread' || choice.kind === 'price')) ? theme.hoverBackground : background(isSelected);
          row.backgroundColor = surface;
          if (separator) separator.backgroundColor = surface;
          if (separatorRail) separatorRail.borderColor = isSelected ? theme.selectedBorder : surface;
          if (!key || recordFocus) row.borderColor = isSelected ? recordFocus ? theme.accent : choice.kind === 'price' ? theme.activeTabBorder : theme.selectedBorder : recordFocus ? theme.background : choice.depth ? theme.border : surface;
        }
        if (distributionDate) distributionDate.content = this.styledContent(choice.distribution!.label, { tone: isSelected ? 'accent' : 'foreground', inverse: !this.color && isSelected });
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
      if (choice.separatorAfter) {
        if (choice.distribution || choice.kind === 'thread') {
          separator = this.box(distributionRecord ?? group ?? scroll, { id: `row-${index}-separator`, height: 1, flexDirection: 'row', backgroundColor: this.color ? bg : undefined, ...pointer });
          separatorRail = this.box(separator, { width: 1, height: 1, border: ['left'], borderColor: this.color ? focused ? theme.selectedBorder : bg : undefined });
          this.box(separator, { flexGrow: 1, height: 1, border: ['bottom'], borderColor: this.color ? theme.border : undefined });
        } else this.box(group ?? scroll, { height: 1, border: ['bottom'], borderColor: this.color ? theme.border : undefined });
      }
    }
    if (!frame.choices.length) for (const line of frame.empty ?? [t("common.no_records")]) this.text(scroll, line, { tone: 'muted' });
    if (frame.totalCells || frame.total) {
      const total = this.box(scroll, { id: 'total', paddingLeft: 2, paddingRight: 1, border: ['top'], borderStyle: 'single', borderColor: this.color ? theme.border : undefined });
      if (frame.totalCells) this.table(total, frame.totalCells, { tone: 'pageTitle', bold: true });
      else {
        const amounts = this.box(total, { flexDirection: 'row', gap: 1 });
        if (frame.totalLabel) this.text(amounts, frame.totalLabel, { tone: 'pageTitle' }, 'total-label');
        const primary = this.text(amounts, frame.total!, { tone: 'pageTitle', bold: true }); primary.flexGrow = 1; primary.flexShrink = 1; primary.minWidth = 0;
        if (frame.totalSecondary) { const secondary = this.text(amounts, frame.totalSecondary, { tone: 'tablePartForeground' }); secondary.maxWidth = '55%'; secondary.flexShrink = 1; secondary.textAlign = 'right'; }
      }
    }
    if (frame.totalNote) this.text(scroll, frame.totalNote, { tone: 'muted' });
    if (frame.pagination) {
      const pager = this.box(scroll, { id: 'pagination', flexDirection: 'row', gap: 2, flexWrap: 'wrap' });
      this.text(pager, frame.pagination.label, { tone: 'muted' }, 'page-label');
      if (frame.pagination.previous) this.button(pager, t('tui.app.previous_page'), 'previous', false);
      if (frame.pagination.next) this.button(pager, t('tui.app.next_page'), 'next', false);
    }
    if (frame.actions) {
      const actions = this.box(scroll, { id: 'actions', flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, rowGap: 0, marginTop: short ? 0 : 1 });
      for (const label of frame.actions.split(' · ')) {
        const key = label[0].toLowerCase(), id = key === 't' ? 'theme' : key === 'b' ? 'back' : frame.shortcuts?.[key];
        const action = this.text(actions, label, { tone: 'actionForeground' });
        action.onMouseUp = event => { if (event.button !== 0) return; if (id === 'theme') { this.theme = nextTerminalTheme(theme); this.draw(false); } else if (id) this.finish(id); };
      }
    }
    const disclosure = frame.disclosureLabel || frame.disclosure ? this.box(scroll, { id: 'data-disclosure', marginTop: short ? 0 : 1,
      ...(frame.disclosure ? { border: ['left'], paddingX: 1, backgroundColor: this.color ? theme.disclosureBackground : undefined, borderColor: this.color ? theme.disclosureBorder : undefined } : {}) }) : undefined;
    if (disclosure && frame.disclosureLabel) { const link = this.text(disclosure, (frame.disclosure ? '⌄ ' : '› ') + frame.disclosureLabel, { tone: 'disclosureSummary' }, 'footer-explain'); link.onMouseUp = e => { if (e.button === 0) this.finish('explain'); }; }
    const footer = this.box(area, { id: 'footer', border: ['top'], borderColor: this.color ? theme.border : undefined, marginTop: short ? 0 : 1 });
    for (const line of (dense || this.renderer.width < 68 ? frame.compactFooter ?? frame.footer : frame.footer).split('\n')) {
      const links = this.box(footer, { flexDirection: 'row', flexWrap: 'wrap', gap: 1 });
      for (const [index, label] of line.split(' · ').entries()) {
        if (index) this.text(links, '·', { tone: 'footerForeground' });
        const key = label.split(' ')[0].toLowerCase();
        const link = this.text(links, label, { tone: 'footerForeground' });
        const id = frame.shortcuts?.[key] ?? ({ '?': 'prices', q: 'quit', esc: 'back', tab: 'tab', f: 'filters' } as Record<string, string>)[key];
        if (id) link.onMouseUp = event => { if (event.button === 0) this.finish(id); };
      }
    }
    if (frame.disclosure) {
      const notes = this.box(disclosure!, { id: 'notes', minHeight: 1 });
      for (const line of frame.disclosure) {
        const link = /^https:\/\/[^\s\x00-\x1f\x7f]+$/.test(line) ? line : undefined;
        this.text(notes, link ? t('tui.components.terminal-ui.view_official_model_prices') : line, { tone: link ? 'priceSource' : 'disclosureForeground', underline: Boolean(link), link });
      }
      if (frame.disclosureAction) {
        const action = this.text(notes, frame.disclosureAction.label, { tone: 'priceSource', underline: true }, 'disclosure-action');
        action.onMouseUp = event => { if (event.button === 0) this.finish(frame.disclosureAction!.id); };
      }
    }
    this.selectionPaint.forEach(paint => paint());
    const version = this.redrawVersion;
    this.renderer.once('frame', () => {
      if (this.disposed || version !== this.redrawVersion || this.scroll !== scroll) return;
      scroll.scrollTo(saved);
      if (reveal) this.renderer.once('frame', () => {
        if (this.disposed || version !== this.redrawVersion || this.scroll !== scroll) return;
        const row = this.rowNodes[this.selected];
        if (frame.disclosure && disclosure) scroll.scrollChildIntoView(frame.disclosureLabel ? 'footer-explain' : 'notes');
        else if (row) scroll.scrollChildIntoView(frame.choices[this.selected]?.metrics ? `breakdown-${this.selected}-0` : row.id);
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
    this.stopLoadingTimers();
    this.loadingState = { spec: { kind: 'query', message }, cancelling: false };
    this.drawLoading();
  }
  private stopLoadingTimers(): void {
    clearTimeout(this.loadingExpansion); clearInterval(this.loadingAnimation);
    this.loadingExpansion = undefined; this.loadingAnimation = undefined;
  }
  async task<T>(spec: LoadingSpec, run: (options: { signal: AbortSignal; onProgress: (stage: string) => void }) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const signal = AbortSignal.any([this.signal, controller.signal]);
    const state: LoadingState = { spec, cancelling: false };
    this.stopLoadingTimers();
    this.loadingState = state;
    this.cancelOperation = () => {
      if (signal.aborted) return;
      state.cancelling = true;
      this.stopLoadingTimers();
      controller.abort();
      this.drawLoading();
    };
    this.drawLoading();
    this.loadingExpansion = setTimeout(() => {
      if (this.loadingState !== state || signal.aborted || this.disposed) return;
      state.expanded = true; this.drawLoading();
    }, 650);
    const started = Date.now();
    this.loadingAnimation = setInterval(() => {
      if (this.loadingState !== state || signal.aborted || this.disposed) return;
      const mark = this.tree?.findDescendantById('startup-mark');
      if (mark) {
        const phase = ((Date.now() - started) % 1600) / 800;
        mark.opacity = 0.72 + (phase <= 1 ? phase : 2 - phase) * 0.28;
        this.renderer.requestRender();
      }
    }, 80);
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
      if (this.loadingState === state) { this.stopLoadingTimers(); this.loadingState = undefined; this.cancelOperation = undefined; }
    }
  }
  private drawLoading(): void {
    if (this.disposed || !this.loadingState) return;
    this.frame = undefined;
    const state = this.loadingState, content = loadingContent(state), theme = this.theme;
    const narrow = this.renderer.width < 68, dense = this.renderer.height < 20;
    const area = this.base();
    this.header(area, t(state.spec.activeTab === 'threads' ? 'common.threads' : 'common.usage'), [t('common.local_codex').replace(/ · $/, '')], state.spec.activeTab ?? 'usage');
    const navigation = this.tree?.findDescendantById('navigation');
    if (navigation) navigation.opacity = 0.5;
    const center = this.box(area, { id: 'loading-center', flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 1, justifyContent: 'center', alignItems: 'center' });
    const scene = this.box(center, { id: 'startup-scene', width: '100%', maxWidth: 60, alignItems: 'center' });
    const mark = this.box(scene, { id: 'startup-mark', alignItems: 'center', opacity: state.cancelling ? 1 : 0.85 });
    const art = narrow || dense ? ['▄██▄▄▄▄██▄','██▄████▄██','███    ███',' ▀██▄▄██▀'] : ['  ▄███▄      ▄███▄',' ▄████████████████▄','████▀▀████████▀▀████','████▄▄████████▄▄████','██████        ██████','▀██████▄▄  ▄▄██████▀','  ▀▀████████████▀▀'];
    for (const [index, line] of art.entries()) { const text = this.text(mark, line, { tone: 'brand' }, 'startup-mark-' + index); text.wrapMode = 'none'; text.height = 1; text.width = narrow || dense ? 10 : 20; }
    const heading = this.text(scene, content.heading, { tone: 'startupHeading', bold: true }, 'startup-heading'); heading.textAlign = 'center'; heading.marginTop = dense ? 0 : 2;
    const phase = this.text(scene, state.expanded ? content.detail ?? content.stages.find(stage => stage.status === 'active')?.name ?? '' : '', { tone: 'muted' }, 'startup-phase'); phase.textAlign = 'center'; phase.minHeight = 1;
    const cancel = this.text(scene, 'X ' + content.cancel, { tone: 'muted' }, 'loading-cancel');
    cancel.marginTop = dense ? 0 : 1;
    cancel.onMouseUp = event => { if (event.button === 0) this.cancelOperation?.(); };
    const footer = this.box(area, { id: 'footer', border: ['top'], borderColor: this.color ? theme.border : undefined });
    this.text(footer, t('tui.loading.footer'), { tone: 'footerForeground' });
    this.renderer.requestRender();
  }
  async form(spec: FormSpec): Promise<FormAnswer> {
    if (this.signal.aborted) return { action: 'cancel', values: spec.values, changed: [] };
    this.frame = undefined;
    const area = this.base();
    this.header(area, spec.title, spec.intro ?? [], spec.activeTab ?? 'usage', true, id => this.activeForm?.finish(id as 'usage-tab' | 'threads-tab'));
    const form = new NativeForm(this.renderer, area, spec, this.theme, this.color); this.activeForm = form;
    try { const answer = await form.run(); if (answer.action === 'theme') this.theme = nextTerminalTheme(this.theme); return answer; }
    finally { form.dispose(); this.activeForm = undefined; }
  }
  async input(config: { title: string; value: string }): Promise<string | null> {
    if (this.signal.aborted) return null;
    const area = this.base();
    this.title(area, `Wombat / ${config.title}`);
    const panel = this.box(area, { border: true, borderStyle: 'rounded', borderColor: this.theme.selectedBorder, height: 3, marginTop: 1, paddingX: 1 });
    const editor = new InputRenderable(this.renderer, { id: 'input', value: config.value, width: '100%', ...(this.color ? { textColor: this.theme.foreground, backgroundColor: this.theme.background, focusedBackgroundColor: this.theme.selectedBackground } : {}) });
    panel.add(editor); this.editor = editor;
    this.text(area, t("tui.components.terminal-ui.enter_confirm_esc_cancel_ctrl_u"), { tone: 'muted' });
    editor.focus();
    try { return await new Promise(resolve => { this.inputPending = resolve; editor.on('enter', () => resolve(terminalText(editor.value))); }); }
    finally { this.editor = undefined; this.inputPending = undefined; }
  }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true; this.stopLoadingTimers(); this.controller.abort();
    this.activeForm?.finish('cancel');
    process.removeListener('SIGINT', this.interrupt); process.removeListener('SIGTERM', this.interrupt);
    this.renderer.keyInput.off('keypress', this.key); this.renderer.off('resize', this.resize);
    this.renderer.destroy();
  }
}
export async function createTerminalUI(): Promise<TerminalUI> {
  return new TerminalUI(await createCliRenderer({ exitOnCtrlC: false, exitSignals: [], useMouse: true, screenMode: 'alternate-screen', consoleMode: 'disabled', openConsoleOnError: false }));
}
