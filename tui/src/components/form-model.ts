export interface FormField {
  id: string;
  label: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
}
export interface FormSpec {
  title: string;
  heading?: string;
  intro?: string[];
  activeTab: 'usage' | 'threads';
  values: Record<string, string>;
  fields: FormField[];
  advancedFields?: FormField[];
  advancedOpen?: boolean;
  focusId?: string;
  error?: string;
}
export interface FormAnswer {
  action: 'apply' | 'cancel' | 'change' | 'toggle' | 'usage-tab' | 'threads-tab' | 'language' | 'theme';
  values: Record<string, string>;
  changed: string[];
  focusId?: string;
}
