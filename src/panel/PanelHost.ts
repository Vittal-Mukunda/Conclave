import { ProviderStatusView } from '../providers/ProviderService';

/** What the webview can ask the extension host to do. Keys never cross this
 * boundary — only presence flags and friendly messages. */
export interface PanelHost {
  getProviderStatus(): Promise<ProviderStatusView[]>;
  addOrUpdateKey(providerId: string): Promise<void>;
  clearKey(providerId: string): Promise<void>;
  testConnection(providerId: string): Promise<{ ok: boolean; message: string }>;
}
