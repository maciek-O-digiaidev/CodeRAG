export type {
  ConfluenceConfig,
  ConfluencePage,
  ConfluenceContentType,
  ConfluenceChangedItem,
  DocsProvider,
} from './confluence-provider.js';
export {
  ConfluenceError,
  ConfluenceProvider,
  confluenceStorageToPlainText,
} from './confluence-provider.js';

export type {
  SharePointConfig,
  SharePointPage,
  SharePointDocument,
  SharePointItemType,
  SharePointChangedItem,
} from './sharepoint-provider.js';
export {
  SharePointError,
  SharePointProvider,
  extractTextFromDocx,
  extractTextFromPdf,
} from './sharepoint-provider.js';
