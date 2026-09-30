export type Tone = 'disclosureMarker' | 'meterForeground' | 'startupBrief' | 'startupBorder' | 'startupSource' | 'startupHeading' | 'startupDescription' | 'startupRule' | 'startupWaiting' | 'startupActive' | 'startupDone' | 'startupMarker' | 'startupActiveMarker' | 'startupState' | 'startupActiveState' | 'startupAssurance' | 'startupDestination' | 'priceSource' | 'priceModel' | 'priceNumber' | 'priceUnavailable' | 'summaryForeground' | 'contextForeground' | 'breakdownForeground' | 'brand' | 'pageTitle' | 'titleDivider' | 'footerForeground' | 'disclosureForeground' | 'disclosureSummary' | 'actionForeground' | 'foreground' | 'muted' | 'border' | 'controlBorder' | 'selectedBorder' | 'accent' | 'selectedForeground' | 'heading' | 'number' | 'subtotalForeground' | 'modelForeground' | 'controlForeground' | 'activeControlForeground' | 'activeTabForeground' | 'operationTime' | 'operationName' | 'operationResult' | 'tablePartForeground' | 'tableMarkerForeground';
export interface TextStyle { link?: string; tone?: Tone; bold?: boolean; underline?: boolean; inverse?: boolean; background?: 'background' | 'selectedBackground' | 'subtotalBackground' | 'detailBackground'; }
export interface Span extends TextStyle { start: number; end: number; }
export interface RowPaint extends TextStyle { spans?: Span[]; }
export interface Choice {
  id: string;
  lines: string[];
  cells?: TableCell[];
  headline?: { label: string; amount: string };
  operation?: { time: string; name: string; result: string };
  bar?: number;
  metrics?: Array<{ label: string; value: string; amount?: string }>;
  controls?: Array<{ id: string; label: string; active: boolean }>;
  group?: string;
  reportGroup?: string;
  turnGroup?: string;
  recordStart?: boolean;
  pricePairs?: Array<{ label: string; value: string }>;
  priceDetail?: { lines: string[]; source: string };
  expanded?: boolean;
  separatorAfter?: boolean;
  kind?: 'subtotal' | 'model' | 'thread' | 'turn' | 'measurement' | 'operation' | 'detail' | 'control' | 'price';
  depth?: number;
  paint?: RowPaint[];
  gapAfter?: boolean;
}
export interface Frame {
  title: string;
  intro: string[];
  compactIntro?: string[];
  compactFooter?: string;
  choices: Choice[];
  footer: string;
  selected?: number;
  pageNavigation?: boolean;
  viewportStart?: number;
  shortcuts?: Record<string, string>;
  nav?: string;
  activeTab?: string;
  tableHeader?: string;
  tableCells?: TableCell[];
  totalCells?: TableCell[];
  controls?: string;
  controlOptions?: string[];
  controlKind?: 'group' | 'sort';
  activeControl?: string;
  context?: Array<{ text: string; summary?: boolean }>;
  total?: string;
  status?: string;
  actions?: string;
  disclosure?: string[];
  disclosureAction?: { label: string; id: string };
  empty?: string[];
  layout?: (width: number) => Partial<Frame>;
}
export function inlineValue(text: string, value: string, style: TextStyle = { tone: 'number', bold: true }): Span[] {
  const start = text.indexOf(value);
  return start < 0 || !value ? [] : [{ start, end: start + value.length, ...style }];
}
export interface TableCell { text: string; width?: number; grow?: number; align?: 'left' | 'right'; tone?: Tone; bold?: boolean; growBasis?: number; minWidth?: number; inset?: number; date?: boolean; stackWhenLong?: boolean; }
