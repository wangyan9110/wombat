import { t } from '@wombat/client/locale';
export interface TerminalTheme {
  focus: string;
  warning: string;
  startupActivity: string;
  startupTrack: string;
  startupBrief: string;
  startupBorder: string;
  startupSource: string;
  startupHeading: string;
  startupDescription: string;
  startupRule: string;
  startupWaiting: string;
  startupActive: string;
  startupDone: string;
  startupMarker: string;
  startupActiveMarker: string;
  startupState: string;
  startupActiveState: string;
  startupAssurance: string;
  startupDestination: string;

  summaryForeground: string;
  contextForeground: string;
  breakdownForeground: string;
  priceSource: string;
  priceModel: string;
  priceNumber: string;
  priceUnavailable: string;
  priceBorder: string;
  id: string;
  name: string;
  background: string;
  foreground: string;
  heading: string;
  number: string;
  brand: string;
  fieldLabel: string;
  fieldBorder: string;
  fieldBackground: string;
  fieldForeground: string;
  pageTitle: string;
  titleDivider: string;
  footerForeground: string;
  disclosureForeground: string;
  disclosureBackground: string;
  disclosureBorder: string;
  disclosureSummary: string;
  disclosureMarker: string;
  actionForeground: string;
  detailBackground: string;
  muted: string;
  border: string;
  controlBorder: string;
  selectedBorder: string;
  accent: string;
  selectedBackground: string;
  selectedForeground: string;
  subtotalBackground: string;
  meterBackground: string;
  meterForeground: string;
  turnBorder: string;
  recordBorder: string;
  operationTime: string;
  operationName: string;
  operationResult: string;
  hoverBackground: string;
  subtotalForeground: string;
  modelForeground: string;
  tablePartForeground: string;
  tableMarkerForeground: string;
  selectedThreadBackground: string;
  controlForeground: string;
  activeControlForeground: string;
  activeTabForeground: string;
  activeTabBorder: string;
}
interface Palette { background:string;surface:string;hover:string;selected:string;detail:string;text:string;heading:string;muted:string;secondary:string;accent:string;marker:string;border:string;strong:string;warning:string;brand:string;focus:string;link:string;track:string; }
function theme(id: string, name: () => string, p: Palette): TerminalTheme {
 return { id, focus:p.focus, warning:p.warning, get name() { return name(); }, background:p.background, foreground:p.text, heading:p.heading, number:p.heading, brand:p.brand,
 startupActivity:p.brand,startupTrack:p.track,startupBrief:p.muted,startupBorder:p.border,startupSource:p.muted,startupHeading:p.heading,startupDescription:p.muted,startupRule:p.border,startupWaiting:p.muted,startupActive:p.heading,startupDone:p.accent,startupMarker:p.marker,startupActiveMarker:p.accent,startupState:p.muted,startupActiveState:p.secondary,startupAssurance:p.muted,startupDestination:p.muted,
 summaryForeground:p.heading,contextForeground:p.muted,breakdownForeground:p.secondary,priceSource:p.link,priceModel:p.heading,priceNumber:p.secondary,priceUnavailable:p.muted,priceBorder:p.border,
 fieldLabel:p.muted,fieldBorder:p.strong,fieldBackground:p.surface,fieldForeground:p.heading,pageTitle:p.heading,titleDivider:p.marker,footerForeground:p.muted,disclosureForeground:p.muted,disclosureBackground:p.detail,disclosureBorder:p.strong,disclosureSummary:p.link,disclosureMarker:p.marker,actionForeground:p.secondary,detailBackground:p.detail,muted:p.muted,border:p.border,controlBorder:p.border,selectedBorder:p.strong,accent:p.accent,selectedBackground:p.selected,selectedForeground:p.heading,subtotalBackground:p.surface,meterBackground:p.track,meterForeground:p.accent,turnBorder:p.border,recordBorder:p.border,operationTime:p.muted,operationName:p.heading,operationResult:p.muted,hoverBackground:p.hover,subtotalForeground:p.heading,modelForeground:p.secondary,tablePartForeground:p.secondary,tableMarkerForeground:p.marker,selectedThreadBackground:p.selected,controlForeground:p.muted,activeControlForeground:p.heading,activeTabForeground:p.heading,activeTabBorder:p.accent,
 };
}
export const terminalThemes = {
  forest: theme('forest', () => t('tui.themes.index.forest'), {"background":"#142820","surface":"#1d3628","hover":"#243f30","selected":"#2b4a35","detail":"#1a2e20","text":"#c9dfcf","heading":"#e5f1e8","muted":"#9bb6a4","secondary":"#b7cebe","accent":"#a9d6b3","marker":"#86ad93","border":"#3c5b49","strong":"#71997c","warning":"#e2c88d","brand":"#a9d6b3","focus":"#a9e0b6","link":"#b6e4c0","track":"#38513f"}),
  midnight: theme('midnight', () => t('tui.themes.index.midnight'), {"background":"#111c2d","surface":"#1b2b42","hover":"#20354d","selected":"#29435f","detail":"#172437","text":"#cad9ec","heading":"#edf3fb","muted":"#a8bdd6","secondary":"#b8cce5","accent":"#91c4ee","marker":"#8bb0d4","border":"#344b69","strong":"#678bab","warning":"#efd098","brand":"#91c4ee","focus":"#aacffd","link":"#b1d8ff","track":"#304966"}),
  paper: theme('paper', () => t('tui.themes.index.light'), {"background":"#f5f3ed","surface":"#eeece3","hover":"#e7ede7","selected":"#d9e4df","detail":"#ece8de","text":"#33433b","heading":"#21372e","muted":"#52635a","secondary":"#475c4f","accent":"#2f6b52","marker":"#607d6c","border":"#ccd1c7","strong":"#7f9283","warning":"#865611","brand":"#294a36","focus":"#226348","link":"#2b674e","track":"#cbd5ca"}),
  amber: theme('amber', () => t('tui.themes.index.amber'), {"background":"#241d13","surface":"#30271b","hover":"#3b301f","selected":"#493b26","detail":"#2b2318","text":"#dfceb0","heading":"#f7e5c0","muted":"#c5b08c","secondary":"#d2bc96","accent":"#e3bb70","marker":"#bd985f","border":"#5c4a32","strong":"#9d7b49","warning":"#f0c078","brand":"#e3bb70","focus":"#f4d399","link":"#eed09b","track":"#615034"}),
};
export type TerminalThemeId = keyof typeof terminalThemes;
export function terminalTheme(name = process.env.WOMBAT_THEME): TerminalTheme {
  if (name === 'graphite') return terminalThemes.midnight;
  return name && Object.hasOwn(terminalThemes, name) ? terminalThemes[name as TerminalThemeId] : terminalThemes.forest;
}
export function nextTerminalTheme(theme: TerminalTheme): TerminalTheme {
  const themes = Object.values(terminalThemes);
  return themes[(themes.findIndex(candidate => candidate.id === theme.id) + 1) % themes.length];
}
