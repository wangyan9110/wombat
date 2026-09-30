import { t } from '@wombat/client/locale';
export interface TerminalTheme {
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
export const terminalThemes = {
  forest: { id: 'forest', startupBorder: '#4a6b51', startupSource: '#849e8c', startupHeading: '#e5f1e8', startupDescription: '#a8c0ae', startupRule: '#2c4634', startupWaiting: '#839c8a', startupActive: '#e0eee3', startupDone: '#a7cbb1', startupMarker: '#698c73', startupActiveMarker: '#a9deb3', startupState: '#8fa997', startupActiveState: '#bce2c5', startupAssurance: '#88a391', startupDestination: '#b4d5bd', priceSource: '#a7d4b2', priceModel: '#dbeee0', priceNumber: '#c2d9c9', priceUnavailable: '#829a88', priceBorder: '#2d4534', summaryForeground: '#e1eee3', contextForeground: '#9db6a6', breakdownForeground: '#b5cab9', fieldLabel: '#b6cdbd', fieldBorder: '#60866b', fieldBackground: '#203d2c', fieldForeground: '#d9eddf', pageTitle: '#dbe9df', titleDivider: '#65836c', footerForeground: '#9bb5a5', disclosureForeground: '#9db6a6', disclosureBackground: '#1a2e20', disclosureBorder: '#56765c', disclosureSummary: '#a8c8b0', actionForeground: '#a8c3b0', get name() { return t("tui.themes.index.forest"); }, meterBackground: '#31513b', meterForeground: '#86c59a', turnBorder: '#35513e', recordBorder: '#344b3a', operationTime: '#91aa98', operationName: '#d4e7d9', operationResult: '#92aa99', hoverBackground: '#294632', subtotalForeground: '#d4e6da', modelForeground: '#c3d8ca', tablePartForeground: '#a8c1b0', tableMarkerForeground: '#91b49c', selectedThreadBackground: '#223b2b', controlForeground: '#9eb8a5', activeControlForeground: '#e1f2e5', activeTabForeground: '#d7e9dc', activeTabBorder: '#8bb99a', controlBorder: '#3d5a45', selectedBorder: '#71997c', heading: '#e1f0e5', number: '#d9f1dd', brand: '#a9d6b3', detailBackground: '#21392a', background: '#142820', foreground: '#d4e2d8', muted: '#91a897', border: '#34513d', accent: '#90dfad', selectedBackground: '#2b4a35', selectedForeground: '#e7f6ea', subtotalBackground: '#1d3628' },
  paper: { id: 'paper', startupBorder: '#a0b3a6', startupSource: '#54685e', startupHeading: '#193527', startupDescription: '#54685e', startupRule: '#a0b3a6', startupWaiting: '#708078', startupActive: '#193527', startupDone: '#427652', startupMarker: '#708078', startupActiveMarker: '#246640', startupState: '#54685e', startupActiveState: '#427652', startupAssurance: '#54685e', startupDestination: '#427652', priceSource: '#246640', priceModel: '#193527', priceNumber: '#243c31', priceUnavailable: '#708078', priceBorder: '#a0b3a6', summaryForeground: '#193527', contextForeground: '#54685e', breakdownForeground: '#427652', fieldLabel: '#54685e', fieldBorder: '#a0b3a6', fieldBackground: '#eef2ec', fieldForeground: '#243c31', pageTitle: '#193527', titleDivider: '#708078', footerForeground: '#54685e', disclosureForeground: '#54685e', disclosureBackground: '#eef2ec', disclosureBorder: '#a0b3a6', disclosureSummary: '#427652', actionForeground: '#427652', get name() { return t("tui.themes.index.light"); }, meterBackground: '#d7e8dc', meterForeground: '#427652', turnBorder: '#a0b3a6', recordBorder: '#a0b3a6', operationTime: '#54685e', operationName: '#243c31', operationResult: '#54685e', hoverBackground: '#e4ede4', subtotalForeground: '#193527', modelForeground: '#243c31', tablePartForeground: '#54685e', tableMarkerForeground: '#427652', selectedThreadBackground: '#e4ede4', controlForeground: '#54685e', activeControlForeground: '#183a26', activeTabForeground: '#193527', activeTabBorder: '#427652', controlBorder: '#a0b3a6', selectedBorder: '#427652', heading: '#193527', number: '#204a33', brand: '#246640', detailBackground: '#eef2ec', background: '#fafaf7', foreground: '#243c31', muted: '#54685e', border: '#a0b3a6', accent: '#1b6846', selectedBackground: '#d7e8dc', selectedForeground: '#183a26', subtotalBackground: '#eef2ec' },
  graphite: { id: 'graphite', startupBorder: '#5a6575', startupSource: '#a4aebc', startupHeading: '#f0f3f7', startupDescription: '#a4aebc', startupRule: '#5a6575', startupWaiting: '#778497', startupActive: '#f0f3f7', startupDone: '#a9c7ef', startupMarker: '#778497', startupActiveMarker: '#a9c7ef', startupState: '#a4aebc', startupActiveState: '#c2cedd', startupAssurance: '#a4aebc', startupDestination: '#c2cedd', priceSource: '#a9c7ef', priceModel: '#f0f3f7', priceNumber: '#c2cedd', priceUnavailable: '#778497', priceBorder: '#5a6575', summaryForeground: '#f0f3f7', contextForeground: '#a4aebc', breakdownForeground: '#c2cedd', fieldLabel: '#a4aebc', fieldBorder: '#5a6575', fieldBackground: '#272f39', fieldForeground: '#e1e5ea', pageTitle: '#f0f3f7', titleDivider: '#778497', footerForeground: '#a4aebc', disclosureForeground: '#a4aebc', disclosureBackground: '#272f39', disclosureBorder: '#5a6575', disclosureSummary: '#a9c7ef', actionForeground: '#a9c7ef', get name() { return t("tui.themes.index.graphite"); }, meterBackground: '#303a48', meterForeground: '#a9c7ef', turnBorder: '#5a6575', recordBorder: '#5a6575', operationTime: '#a4aebc', operationName: '#e1e5ea', operationResult: '#a4aebc', hoverBackground: '#303a48', subtotalForeground: '#f0f3f7', modelForeground: '#e1e5ea', tablePartForeground: '#a4aebc', tableMarkerForeground: '#a9c7ef', selectedThreadBackground: '#303a48', controlForeground: '#a4aebc', activeControlForeground: '#f2f6fc', activeTabForeground: '#f0f3f7', activeTabBorder: '#a9c7ef', controlBorder: '#5a6575', selectedBorder: '#a9c7ef', heading: '#f0f3f7', number: '#d5e4f7', brand: '#a9c7ef', detailBackground: '#272f39', background: '#1d2025', foreground: '#e1e5ea', muted: '#a4aebc', border: '#5a6575', accent: '#a9c7ef', selectedBackground: '#354254', selectedForeground: '#f2f6fc', subtotalBackground: '#292f38' },
} satisfies Record<string, TerminalTheme>;
export type TerminalThemeId = keyof typeof terminalThemes;
export function terminalTheme(name = process.env.WOMBAT_THEME): TerminalTheme {
  return name && Object.hasOwn(terminalThemes, name) ? terminalThemes[name as TerminalThemeId] : terminalThemes.forest;
}
export function nextTerminalTheme(theme: TerminalTheme): TerminalTheme {
  const themes = Object.values(terminalThemes);
  return themes[(themes.findIndex(candidate => candidate.id === theme.id) + 1) % themes.length];
}
